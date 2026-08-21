/* 匿名登入 + 新手引導 + 綁定嘅回歸測試。
   用法：node tools/test-auth.mjs

   ⚠ 呢個測試唔會連真嘅 Firebase（sandbox 出唔到街，而且都唔應該用真 project 嚟試）。
     fbstub.js 會喺載入 index.html 之前塞個假 firebase 落 window，
     入面係一個記憶體 RTDB + 一個夠用嘅 auth，專登用嚟行嗰幾條路：
       匿名登入 → 問名 → 拎徽章 → 綁定 → 撞到舊帳戶 → 登出
     所以佢驗到嘅係**我哋自己嘅邏輯**，唔係 Firebase 本身。 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { findChrome, ROOT } from './_boot.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const exe = findChrome();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if(m.type()==='error' && !m.text().includes('ERR_')) errors.push('CONSOLE: '+m.text().slice(0,200)); });
await page.addInitScript({ path: path.join(HERE, 'fbstub.js') });
await page.goto('file://' + path.join(ROOT, 'index.html'));
await page.waitForFunction(()=>window.__plk && window.__plk.ready, null, {timeout:30000});
await page.addScriptTag({ path: path.join(HERE, 'simlib.js') });
await page.waitForFunction(()=>window.__plk.FB.user, null, {timeout:10000});

const ok = [], bad = [];
const chk = (name, cond, extra='') => (cond?ok:bad).push(`${cond?'✅':'❌'} ${name}${extra?'　'+extra:''}`);

// 1. 一入 game 就有匿名 uid + profile
let r = await page.evaluate(()=>({ uid: FB.user.uid, anon: FB.user.isAnonymous,
  nick: myNick(), auto: FB.profile && FB.profile.auto, title: document.querySelector('#whoami').textContent }));
chk('一入 game 已經匿名登入', r.anon && !!r.uid, r.uid);
chk('自動生成 profile 同暱稱', /^訓練家\d{4}$/.test(r.nick) && r.auto === true, r.nick);
chk('主頁標示「未綁定」', r.title.includes('未綁定'), r.title);

// 2. 打贏第一場 → 問名
r = await page.evaluate(()=>{
  const run = newRun(__SIM.draftParty());
  R.run = run; run.act = 1; run.map = genMap(1);
  R.kind = 'mob';
  advanceAfterNode();
  const sheet = document.querySelector('#sheet');
  return { open: sheet.classList.contains('on'), html: document.querySelector('#sheetIn').textContent.slice(0,20) };
});
chk('贏第一場之後彈「你叫咩名」', r.open && r.html.includes('你叫咩名'), r.html);

r = await page.evaluate(async ()=>{
  document.querySelector('#onbNick').value = '阿明';
  document.querySelector('#onbNickGo').click();
  await new Promise(s=>setTimeout(s,120));
  return { nick: myNick(), auto: FB.profile.auto, closed: !document.querySelector('#sheet').classList.contains('on'),
           board: __STUB.get('board/'+FB.user.uid) };
});
chk('改到名 + 個框閂返', r.nick==='阿明' && r.closed && r.auto===false, r.nick);
chk('個名即刻寫上排行榜', !!(r.board && r.board.nick==='阿明'), JSON.stringify(r.board&&r.board.nick));

// 3. 同一局再贏一場 → 唔會再問
r = await page.evaluate(()=>{ R.kind='mob'; advanceAfterNode();
  return document.querySelector('#sheet').classList.contains('on'); });
chk('第二場之後唔會再問名', r===false);

// 4. 打低第一個道館主 → 問綁定
r = await page.evaluate(()=>{ R.kind='boss'; advanceAfterNode();
  return { open: document.querySelector('#sheet').classList.contains('on'),
           html: document.querySelector('#sheetIn').textContent, act: R.run.act }; });
chk('拎到第一個徽章之後彈綁定', r.open && r.html.includes('儲存進度'), '第 '+r.act+' 章');
chk('綁定框冇亂寫「解鎖三格」之類', !r.html.includes('三格') && !r.html.includes('對戰'));

// 5. 撳「遲啲先」→ 唔會再彈
r = await page.evaluate(()=>{ document.querySelector('#onbLater').click();
  R.kind='boss'; advanceAfterNode();
  return document.querySelector('#sheet').classList.contains('on'); });
chk('撳咗「遲啲先」就唔會再彈', r===false);

// 6. Google 綁定：uid 唔變、雲端嘢仲喺度
r = await page.evaluate(async ()=>{
  const before = FB.user.uid;
  await FB.db.ref('users/'+before+'/runs/0').set({v:4, ts:Date.now(), act:3});
  const mode = await fbLinkGoogle();
  await new Promise(s=>setTimeout(s,120));
  return { mode, before, after: FB.user.uid, anon: isAnon(),
           save: __STUB.get('users/'+FB.user.uid+'/runs/0'), nick: myNick() };
});
chk('Google 綁定：uid 唔變', r.mode==='link' && r.before===r.after, r.after);
chk('綁定之後唔再係匿名', r.anon===false);
chk('雲端存檔原封不動', !!(r.save && r.save.act===3));
chk('個名跟得住過去', r.nick==='阿明', r.nick);

// 7. 帳戶畫面：綁定咗嗰個 state
r = await page.evaluate(()=>{ renderAccount(); return document.querySelector('#accBody').textContent; });
chk('帳戶畫面顯示已綁定', r.includes('登出') && r.includes('阿明'), r.slice(0,40).replace(/\s+/g,' '));

// 8. 登出 → 自動變返新嘅匿名身份（唔會變成「統計唔到」）
r = await page.evaluate(async ()=>{ await fbSignOut(); await new Promise(s=>setTimeout(s,150));
  return { uid: FB.user && FB.user.uid, anon: isAnon() }; });
chk('登出之後自動開返匿名身份', r.anon===true && !!r.uid, r.uid);

// 9. 綁定撞到「已經存在嘅帳戶」→ 登入返舊嗰個 + 搬本機進度
r = await page.evaluate(async ()=>{
  __STUB.linkFails = true;
  try{ localStorage.setItem('plakoro.run.1', JSON.stringify({v:4, ts:Date.now(), act:5})); }catch(e){}
  const mode = await fbLinkGoogle();
  await new Promise(s=>setTimeout(s,200));
  return { mode, uid: FB.user.uid, moved: __STUB.get('users/'+FB.user.uid+'/runs/1') };
});
chk('撞到舊帳戶會登入返舊嗰個', r.mode==='switch' && r.uid==='existing-google', r.uid);
chk('本機進度搬咗過去', !!(r.moved && r.moved.act===5), JSON.stringify(r.moved));

// 10. 匿名登入開唔到嘅時候唔會爆
const p2 = await browser.newPage();
const err2 = []; p2.on('pageerror', e=>err2.push(e.message));
await p2.addInitScript({ path: path.join(HERE, 'fbstub.js') });
/* 扮「Console 未開匿名登入」：signInAnonymously 會 throw operation-not-allowed */
await p2.addInitScript(()=>{ const t=setInterval(()=>{ if(window.__STUB){ window.__STUB.anonFails=true; clearInterval(t); } },1); });
await p2.goto('file://' + path.join(ROOT, 'index.html'));
await p2.waitForFunction(()=>window.__plk && window.__plk.ready, null, {timeout:30000});
await p2.waitForTimeout(500);
r = await p2.evaluate(()=>{ renderAccount(); return { user: !!FB.user, body: document.querySelector('#accBody').textContent.slice(0,30) }; });
chk('匿名登入開唔到都唔會爆', err2.length===0 && r.user===false, r.body.replace(/\s+/g,' '));

/* ---- 11-13. Kill app 再開：**唔可以**開多個新匿名帳戶 ----
   呢組係一個真 bug 嘅回歸測試：之前 fbInit 直接讀 FB.auth.currentUser 就決定
   使唔使 signInAnonymously()，但 Firebase 係非同步咁還原 session 嘅，
   嗰下讀一定係 null → 每次冷啟動都開多個新匿名帳戶，
   連綁咗 Google 嘅人 kill app 再開都會變返「訓練家1234」。 */
async function coldStart(persisted){
  const p = await browser.newPage();
  const errs = []; p.on('pageerror', e=>errs.push(e.message));
  await p.addInitScript({ path: path.join(HERE, 'fbstub.js') });
  if(persisted) await p.addInitScript(`window.__PERSISTED = ${JSON.stringify(persisted)};`);
  await p.goto('file://' + path.join(ROOT, 'index.html'));
  await p.waitForFunction(()=>window.__plk && window.__plk.ready, null, {timeout:30000});
  await p.waitForTimeout(400);
  const out = await p.evaluate(()=>({ uid: FB.user && FB.user.uid, anon: isAnon(),
    made: __STUB.anonMade(), title: document.querySelector('#whoami').textContent }));
  await p.close();
  return Object.assign(out, { errs });
}

r = await coldStart({ uid:'anon-old', anon:true });
chk('匿名 session 還原得返，唔會開多個', r.uid==='anon-old' && r.made===0, r.uid+'・開咗 '+r.made+' 個新匿名');

r = await coldStart({ uid:'g-uid', email:'me@example.com' });
chk('綁咗 Google 嘅人 kill app 再開仲係佢', r.uid==='g-uid' && r.anon===false && r.made===0, r.uid);
chk('主頁唔會再顯示「未綁定」', !r.title.includes('未綁定'), r.title.replace(/\s+/g,' '));

r = await coldStart(null);
chk('真係第一次入嚟先開匿名帳戶', r.anon===true && r.made===1, r.uid+'・開咗 '+r.made+' 個');

/* ---- 14-17. 排行榜嘅進度數字要自己夾得返 ----
   舊 bug：best 係歷來嘅（喺 rogue 度累積），badges 同 act 係「呢一局」嘅，
   溝埋一行就會出現「最遠 第 3 道館」配「🏅 1」—— 打到第 3 個道館
   即係已經打低咗 2 個，冇可能得 1 個徽章。 */
const p3 = await browser.newPage();
const err3 = []; p3.on('pageerror', e=>err3.push(e.message));
await p3.addInitScript({ path: path.join(HERE, 'fbstub.js') });
await p3.goto('file://' + path.join(ROOT, 'index.html'));
await p3.waitForFunction(()=>window.__plk && window.__plk.ready, null, {timeout:30000});
await p3.addScriptTag({ path: path.join(HERE, 'simlib.js') });
await p3.waitForFunction(()=>window.__plk.FB.user, null, {timeout:10000});

r = await p3.evaluate(async ()=>{
  /* 扮「上一局打到第 3 個道館第 2 關先死」*/
  FB.rogue = { runs:1, wins:0, best:3, bestFloor:2, bestBadges:2 };
  /* 而家新開一局，啱啱行到第 1 個道館第 1 關 */
  const run = newRun(__SIM.draftParty());
  R.run = run; run.act = 1; run.map = genMap(1); run.map.cur = run.map.rows[0][0];
  boardPush(run, null, true);
  await new Promise(s=>setTimeout(s,150));
  return __STUB.get('board/'+FB.user.uid);
});
chk('新開一局唔會拉低「最遠」', r.best===3 && r.bestFloor===2, `第 ${r.best} 道館 第 ${r.bestFloor} 關`);
chk('徽章數同「最遠」夾得返', r.badges===2, '🏅 '+r.badges);
/* act 而家特登同 best 一致 —— 成行都係講緊「最遠嗰次」，唔再溝住「呢一局」 */
chk('act 同 best 一致，唔會溝住呢一局', r.act===r.best, 'act '+r.act+'・best '+r.best);

r = await p3.evaluate(async ()=>{
  /* 行到第 3 個道館第 4 關 —— 比歷來遠，要更新 */
  const run = R.run;
  run.act = 3; run.map = genMap(3); run.map.cur = run.map.rows[3][0];
  boardPush(run, null, true);
  await new Promise(s=>setTimeout(s,150));
  return { rec: __STUB.get('board/'+FB.user.uid),
           rogue: __STUB.get('users/'+FB.user.uid+'/rogue') };
});
chk('行遠咗會更新關數，同時寫返落 rogue',
  r.rec.bestFloor===4 && r.rogue.bestFloor===4 && r.rec.badges===2,
  `榜 第 ${r.rec.best} 道館 第 ${r.rec.bestFloor} 關・🏅 ${r.rec.badges}`);
await p3.close();
if(err3.length) errors.push(...err3);

/* ---- 18-19. 榜上面嗰三隻頭像要係「最遠嗰次」嗰隊 ----
   舊 bug：best/badges 係歷來嘅，但 team/power/diff 係而家呢局嘅，
   所以行到第 7 個道館之後新開一局，個榜會顯示「第 7 道館」配住
   新一局嗰三隻初階寶可夢。 */
const p4 = await browser.newPage();
const err4 = []; p4.on('pageerror', e=>err4.push(e.message));
await p4.addInitScript({ path: path.join(HERE, 'fbstub.js') });
await p4.goto('file://' + path.join(ROOT, 'index.html'));
await p4.waitForFunction(()=>window.__plk && window.__plk.ready, null, {timeout:30000});
await p4.addScriptTag({ path: path.join(HERE, 'simlib.js') });
await p4.waitForFunction(()=>window.__plk.FB.user, null, {timeout:10000});

r = await p4.evaluate(async ()=>{
  /* 歷來最遠：第 7 道館，用妙蛙花／蚊香泳士／暴鯉龍 */
  FB.rogue = { runs:2, wins:0, best:7, bestFloor:6, bestBadges:6,
               bestTeam:[3,62,130], bestPower:1973, bestDiff:0 };
  await FB.db.ref('users/'+FB.user.uid+'/rogue').set(FB.rogue);
  /* 而家新開一局，第 1 道館，隊伍完全唔同 */
  const run = newRun(__SIM.draftParty());
  R.run = run; run.act = 1; run.map = genMap(1); run.map.cur = run.map.rows[0][0];
  boardPush(run, null, true);
  await new Promise(s=>setTimeout(s,150));
  return { rec: __STUB.get('board/'+FB.user.uid),
           rogue: __STUB.get('users/'+FB.user.uid+'/rogue') };
});
chk('榜顯示紀錄嗰隊，唔係新一局嗰隊',
  JSON.stringify(r.rec.team)==='[3,62,130]' && r.rec.power===1973,
  '隊伍 '+JSON.stringify(r.rec.team)+'・戰力 '+r.rec.power);
chk('新一局唔會蓋咗紀錄嗰隊', JSON.stringify(r.rogue.bestTeam)==='[3,62,130]');

/* ---- 20. 名人堂揀得後備 ---- */
r = await p4.evaluate(()=>{
  const run = R.run;
  /* 塞夠 6 隻，扮全隊滿員 */
  while(run.party.length < 6) run.party.push(JSON.parse(JSON.stringify(run.party[0])));
  /* battleSnapshot 讀嘅係 m.dex（唔係 m.spec.dex），所以要改呢個先分得出邊隻 */
  run.party.forEach((m,i)=>{ m.dex = 10+i; m.spec = Object.assign({}, m.spec, { dex: 10+i }); });
  R.hofWon = false;
  const snap = hofEntry(run, false, [5,3,1]);      // 揀第 6、4、2 隻（全部後備／非頭三）
  return snap.party.map(m=>m.dex);
});
chk('名人堂揀得後備嗰幾隻', JSON.stringify(r)==='[15,13,11]', JSON.stringify(r));

/* ---- 21. 能量不足要講埋要乜、擲到乜 ---- */
r = await p4.evaluate(()=>{
  /* 直接砌一場：招式要 3 粒草，隻寶可夢一粒草都擲唔到 */
  const mine = mkBattler(genMon(1,'mob',0));
  const foe  = mkBattler(genMon(4,'mob',0));
  mine.deck = [mkMove('草', MV_T.find(m=>m.k==='heavy'), 1)];
  mine.dice = [0,1,2].map(()=>Array.from({length:6},()=>['空']));   // 六面全部係空
  const g = { p:[mine,foe], turn:0, turnNo:5, first:1,
              sides:[{party:[mine],active:0},{party:[foe],active:0}] };
  const L = takeTurn(g, 0, null);
  return (L.steps.find(s=>s.fail)||{}).msg || '(冇失敗)';
});
chk('能量不足會講埋要乜、擲到乜', /要 草草草/.test(r) && /擲到 空/.test(r), r);
await p4.close();
if(err4.length) errors.push(...err4);

console.log([...ok, ...bad].join('\n'));
console.log(`\n${ok.length}/${ok.length+bad.length} 過關`);
if(errors.length) console.log('\n⚠ page errors:\n' + errors.slice(0,6).join('\n'));
await browser.close();
process.exit(bad.length ? 1 : 0);
