/* 階段 1 驗收：三個世代 386 隻資料 + 圖 + 圖鑑畫面。

   重點唔淨係「加到嘢」，仲要證明**玩法一個字都冇改** ——
   `DEX` 由 151 條變 386 條，抽卡池／敵人池／捕捉池好易靜靜哋跟住變大，
   而通關率呢啲嘢係要到階段 3 先量得返，中間出咗事冇人知。

   用法：node tools/test-dex.mjs
*/
import { boot } from './_boot.mjs';

const { browser, page, errors } = await boot();
const out = [];
const t = (name, ok, extra='') => { out.push([ok, name, extra]); };

/* ---------- 1. 資料齊唔齊 ---------- */
const data = await page.evaluate(()=>{
  const miss = [], badType = [], badStage = [];
  const TY = Object.keys(TYPES);
  for(let n=1;n<=386;n++){
    const d = DEX[n];
    if(!d || !d.name){ miss.push(n); continue; }
    if(!TY.includes(d.type)) badType.push(n);
    if(![1,2,3,4].includes(d.s)) badStage.push(n);
    if(!d.weak || !TY.includes(d.weak)) badType.push(n);
  }
  /* 進化鏈唔可以跨世代 —— 決定 2 揀咗 A（三個池唔溝埋），
     一跨咗就即係關都局會進化出城都寶可夢 */
  const cross = [];
  Object.keys(EVO).forEach(k=>{
    const from = genOf(+k);
    (Array.isArray(EVO[k]) ? EVO[k] : [EVO[k]]).forEach(v=>{
      if(genOf(v) !== from) cross.push(k+'→'+v);
    });
  });
  return { total:Object.keys(DEX).length, miss, badType, badStage, cross };
});
t('386 隻齊晒', data.total === 386 && !data.miss.length, `${data.total} 隻`);
t('屬性同弱點全部合法', !data.badType.length, data.badType.slice(0,5).join(','));
t('階級全部 1-4', !data.badStage.length, data.badStage.slice(0,5).join(','));
t('進化鏈唔會跨世代', !data.cross.length, data.cross.slice(0,5).join(' '));

/* ---------- 2. 招式生成器食唔食得落 386 隻 ---------- */
const gen = await page.evaluate(()=>{
  const bad = [];
  for(let n=1;n<=386;n++){
    try{
      const c = cardFor(n), mv = c.sets[0].moves;
      const dice = buildDice(c.id, defaultLoadout());
      if(!c.name || mv.length < 4 || dice.length !== 3) bad.push(n);
      /* 每隻都要有得出招 —— 招式冇名或者冇 cost 就係生成器炒咗 */
      if(mv.some(m=>!m.name || !m.cost)) bad.push(n);
    }catch(e){ bad.push(n + ':' + e.message); }
  }
  return bad;
});
t('386 隻都生成到招式同骰組', !gen.length, gen.slice(0,5).join(' '));

/* ---------- 3. 圖 ---------- */
const spr = await page.evaluate(async()=>{
  const before = Object.keys(window.DEXSPR).length;
  await loadDexSpr(1); await loadDexSpr(2);
  const after = Object.keys(window.DEXSPR).length;
  const miss = [];
  for(let n=1;n<=386;n++) if(!DEXSPR[n]) miss.push(n);
  return { before, after, miss };
});
t('開機只落關都嗰 151 張', spr.before === 151, `${spr.before} 張`);
t('城都豐緣落到 386 張', spr.after === 386 && !spr.miss.length,
  `${spr.after} 張` + (spr.miss.length ? '，缺 '+spr.miss.slice(0,5) : ''));

/* 真係解得開？（base64 爛咗嘅話畫面出唔到，但 JS 唔會報錯） */
const decode = await page.evaluate(()=>Promise.all(
  [1, 152, 251, 252, 386].map(n=>new Promise(ok=>{
    const im = new Image();
    im.onload = ()=>ok(n + ':' + im.naturalWidth + 'x' + im.naturalHeight);
    im.onerror = ()=>ok(n + ':壞');
    im.src = dexURL(n);
  }))));
t('每個世代抽驗嘅圖解得開', decode.every(s=>/\d+x\d+$/.test(s)), decode.join(' '));

/* ---------- 4. 圖鑑畫面 ---------- */
const ui = await page.evaluate(async()=>{
  openDex();
  const tabs = document.querySelectorAll('#dexTab .btn').length;
  const kanto = document.querySelectorAll('#dexBody .dexC').length;

  /* 撳去城都：圖係嗰陣先落，所以要等 */
  document.querySelector('#dexTab .btn[data-t="1"]').click();
  await new Promise(r=>setTimeout(r, 300));
  const johto = document.querySelectorAll('#dexBody .dexC').length;

  /* 撳一隻城都嘅，睇下開唔開到詳情、有冇招式 */
  document.querySelector('#dexBody .dexC[data-dx="152"]').click();
  const moves = document.querySelectorAll('#dexBody .mv').length;
  const named = (document.querySelector('#dexBody .dexh b')||{}).textContent;
  document.querySelector('#dexBack').click();
  const backOk = document.querySelectorAll('#dexBody .dexC').length === johto;

  document.querySelector('#dexTab .btn[data-t="3"]').click();
  const official = document.querySelectorAll('#dexBody .dexh').length;
  sheetClose();
  return { tabs, kanto, johto, moves, named, backOk, official };
});
t('圖鑑有四頁（三代 + 官方卡）', ui.tabs === 4, `${ui.tabs} 頁`);
t('關都頁 151 格', ui.kanto === 151, `${ui.kanto} 格`);
t('城都頁 100 格', ui.johto === 100, `${ui.johto} 格`);
t('撳落去有詳情同招式', ui.moves >= 4 && ui.named === '菊草葉', `${ui.named}・${ui.moves} 招`);
t('返得返上一頁', ui.backOk);
/* 18 唔係 12：官方 12 隻入面有幾隻仲有 A/B 分身，ROSTER 攤開就係 18 條 */
t('官方卡表嗰頁仲喺度', ui.official === 18, `${ui.official} 張`);

/* ---------- 5. ⚠ 玩法一個字都唔准改 ---------- */
const play = await page.evaluate(()=>{
  const outOfKanto = x => x > 151;

  /* 抽卡：唔可以抽到城都豐緣 */
  RT.round = 1; RT.seen = []; rollCands();
  const draftBad = RT.cands.filter(outOfKanto);

  /* 敵人池 */
  const poolBad = dexPool([1,2,3]).map(d=>d.n).filter(outOfKanto);

  /* 神獸挑戰 */
  const legBad = genPool().filter(d=>d.s===4).map(d=>d.n).filter(outOfKanto);

  /* 真係行一局，睇下八個章嘅敵人有冇二三代溜入去 */
  const run = newRun(__SIM.draftParty());
  const seen = new Set();
  for(let a=0;a<ACTS;a++)
    for(let i=0;i<40;i++)
      buildEnemy(run, {kind:i%7===0?'gym':'mob'}, a).party
        .forEach(m=>seen.add(m.spec.dex));
  return { draftBad, poolBad, legBad,
           fightBad:[...seen].filter(outOfKanto), seen:seen.size };
});
t('抽卡淨係出關都', !play.draftBad.length, play.draftBad.slice(0,5).join(','));
t('敵人池淨係關都', !play.poolBad.length, play.poolBad.slice(0,5).join(','));
t('神獸池淨係關都', !play.legBad.length, play.legBad.slice(0,5).join(','));
t('打足八章都撞唔到二三代', !play.fightBad.length,
  `見過 ${play.seen} 隻` + (play.fightBad.length ? '，混入 '+play.fightBad.slice(0,5) : ''));

/* ---------- 埋數 ---------- */
console.log('');
out.forEach(([ok,name,extra])=>console.log(`${ok?'✅':'❌'} ${name}${extra?'　'+extra:''}`));
const bad = out.filter(r=>!r[0]).length;
console.log(`\n${out.length - bad}/${out.length} 過關`);
if(errors.length) console.log('\n⚠ 頁面錯誤：\n' + errors.slice(0,8).join('\n'));
await browser.close();
process.exit(bad || errors.length ? 1 : 0);
