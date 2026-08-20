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

console.log([...ok, ...bad].join('\n'));
console.log(`\n${ok.length}/${ok.length+bad.length} 過關`);
if(errors.length) console.log('\n⚠ page errors:\n' + errors.slice(0,6).join('\n'));
await browser.close();
process.exit(bad.length ? 1 : 0);
