/* 階段 1 + 2 驗收：三個世代 386 隻資料 + 圖 + 圖鑑畫面 + 世代化架構。

   重點唔係「加到嘢」，係證明**三個世代唔會撈埋一齊** ——
   抽卡池／敵人池／捕捉池／道館／存檔／名人堂任何一樣溝咗世代都唔會報錯，
   而通關率要到階段 3 先量得返，中間出咗事冇人知。

   用法：node tools/test-dex.mjs
*/
import { boot } from './_boot.mjs';

const { browser, page, errors } = await boot();
const out = [];
const t = (name, ok, extra='') => { out.push([ok, name, extra]); };
/* 三個世代第 1 個道館主 —— 用嚟證明 setGen 真係換咗成套道館，
   唔係淨係改咗個 ACTIVE_GEN 數字 */
const REGION_GYM1 = ['小剛', '阿速', '千里'];

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

/* ---------- 5. ⚠ 三個世代唔可以撈亂 ----------
   階段 1 呢節係「淨係關都」，階段 2 之後變成「揀邊個世代就淨係嗰個世代」。
   撈咗世代唔會報錯，通關率要到階段 3 先量得返 —— 中間出咗事冇人知。 */
const play = await page.evaluate(()=>{
  const out = [];
  for(let g=0; g<REGIONS.length; g++){
    setGen(g);
    const { lo, hi } = DEX_GENS[g];
    const off = x => x < lo || x > hi;

    /* 抽卡（第 1 抽御三家、之後基礎精靈） */
    RT.round = 0; RT.seen = []; rollCands();
    const draftBad = RT.cands.filter(off);
    RT.round = 1; RT.seen = []; rollCands();
    draftBad.push(...RT.cands.filter(off));

    /* 敵人池、神獸池 */
    const poolBad = dexPool([1,2,3]).map(d=>d.n).filter(off);
    const legBad  = genPool().filter(d=>d.s===4).map(d=>d.n).filter(off);

    /* 真係行一局，逐章叫返 buildEnemy。
       ⚠ 簽名係 buildEnemy(run, kind)，章數睇 run.act —— 之前呢度寫成
         buildEnemy(run, {kind:…}, a)，個物件永遠唔等於 'boss'，
         所以八章都行咗雜魚嗰條路、而且永遠停喺第 1 章。 */
    const run = newRun(__SIM.draftParty());
    const seen = new Set();
    for(let a=1; a<=ACTS; a++){
      run.act = a;
      for(const kind of ['mob','mob','mob','elite','boss','legend'])
        buildEnemy(run, kind).party.forEach(m=>seen.add(m.spec.dex));
    }
    /* 四天王同冠軍 */
    for(run.e4=0; run.e4<ELITE4.length; run.e4++)
      buildEnemy(run, 'e4').party.forEach(m=>seen.add(m.spec.dex));
    buildEnemy(run, 'champ').party.forEach(m=>seen.add(m.spec.dex));

    out.push({ g, name:genName(g), draftBad, poolBad, legBad,
               fightBad:[...seen].filter(off), seen:seen.size });
  }
  setGen(0);
  return out;
});
play.forEach(p=>{
  t(`${p.name}：抽卡唔會出別代`, !p.draftBad.length, p.draftBad.slice(0,5).join(','));
  t(`${p.name}：敵人池同神獸池唔會出別代`, !p.poolBad.length && !p.legBad.length,
    [...p.poolBad, ...p.legBad].slice(0,5).join(','));
  t(`${p.name}：打足八章 + 四天王 + 冠軍都撞唔到別代`, !p.fightBad.length,
    `見過 ${p.seen} 隻` + (p.fightBad.length ? '，混入 '+p.fightBad.slice(0,5) : ''));
});

/* ---------- 6. 階段 2：REGIONS 資料 ---------- */
const reg = await page.evaluate(()=>{
  const bad = [], shape = [], dup = [];
  REGIONS.forEach((r,g)=>{
    const { lo, hi } = DEX_GENS[g];
    if(r.gyms.length !== 8 || r.e4.length !== 4 || r.starters.length !== 3)
      shape.push(`${r.name} 館${r.gyms.length}/天王${r.e4.length}/御三家${r.starters.length}`);
    r.gyms.forEach(x=>{ if(x.team.length !== 4) shape.push(`${r.name}・${x.name} ${x.team.length} 隻`); });
    r.e4.forEach(x=>{ if(x.team.length !== 2) shape.push(`${r.name}・${x.name} ${x.team.length} 隻`); });
    if(r.champ.team.length !== 3) shape.push(`${r.name}・冠軍 ${r.champ.team.length} 隻`);

    /* 每個世代嘅演員表都只准用自己嗰段編號（決定 2） */
    const cast = [...r.gyms.flatMap(x=>x.team), ...r.e4.flatMap(x=>x.team),
                  ...r.champ.team, ...r.starters];
    cast.forEach(n=>{ if(n<lo || n>hi || !DEX[n]) bad.push(`${r.name}:${n}`); });
    /* 同一隻唔好喺兩個道館出現 —— 唔係一局入面會見到同一隻館主寵物兩次 */
    const seen = new Set();
    cast.forEach(n=>{ if(seen.has(n)) dup.push(`${r.name}:${n}(${(DEX[n]||{}).name||''})`); seen.add(n); });

    /* 館主／天王／冠軍嘅屬性同 TYPE_FOCUS 都要係合法屬性，
       而且每個道館屬性都要喺 focus 度有得查（查唔到就當 0，會靜靜雞冇焦點） */
    const TY = Object.keys(TYPES);
    [...r.gyms, ...r.e4, r.champ].forEach(x=>{
      if(!TY.includes(x.type)) bad.push(`${r.name}:${x.name} 屬性 ${x.type}`);
    });
    TY.forEach(ty=>{ if(r.focus[ty] == null) shape.push(`${r.name} focus 冇 ${ty}`); });

    /* 階段 3：逐個世代嘅逐章修正。格數唔夠嘅話 genAt 會咬住最後一格，
       唔會報錯，但打後幾章就靜靜雞用緊第 N 格嘅數 */
    ['hp','dmg'].forEach(k=>{
      const v = (r.tune||{})[k];
      if(!Array.isArray(v) || v.length !== ACTS) shape.push(`${r.name} tune.${k} 唔係 ${ACTS} 格`);
      else if(v.some(x=>!(typeof x === 'number' && x > 0))) shape.push(`${r.name} tune.${k} 有非正數`);
    });
  });
  return { bad, shape, dup };
});
t('三個世代都係 8 館 + 4 天王 + 冠軍 + 3 御三家', !reg.shape.length, reg.shape.slice(0,4).join('　'));
t('館主／天王／冠軍／御三家全部係自己世代嘅編號', !reg.bad.length, reg.bad.slice(0,5).join(' '));
t('同一世代入面冇重複用同一隻', !reg.dup.length, reg.dup.slice(0,5).join(' '));

/* ---------- 7. setGen 一次過換齊 ---------- */
const bind = await page.evaluate(()=>{
  const snap = [];
  for(let g=0; g<REGIONS.length; g++){
    setGen(g);
    snap.push({
      g, active: ACTIVE_GEN,
      gym1: GYMS[0].name, e41: ELITE4[0].name, champ: CHAMPION.name,
      st: STARTERS.slice(), focusIsRegion: TYPE_FOCUS === REGIONS[g].focus,
      tuneIsRegion: GEN_TUNE === REGIONS[g].tune,
      /* window.__rogue 要係 getter，唔係凍住開機嗰份 */
      hookGym1: window.__rogue.GYMS[0].name,
    });
  }
  setGen(0);
  /* 亂數／越界要跌返關都，唔可以爆 */
  const fallback = [setGen(9), setGen(-1), setGen(null)];
  setGen(0);
  return { snap, fallback };
});
t('setGen 同時換齊 GYMS/ELITE4/CHAMPION/STARTERS/TYPE_FOCUS/GEN_TUNE',
  bind.snap.every((s,i)=>s.active===i && s.gym1===REGION_GYM1[i] && s.focusIsRegion && s.tuneIsRegion),
  bind.snap.map(s=>`${s.gym1}/${s.e41}/${s.champ}`).join('　'));
t('__rogue 攞到嘅係現行世代（getter 唔係快照）',
  bind.snap.every((s)=>s.hookGym1===s.gym1), bind.snap.map(s=>s.hookGym1).join(','));
t('setGen 收到爛值會跌返關都', bind.fallback.every(v=>v===0), bind.fallback.join(','));

/* ---------- 7b. 階段 3：世代修正（GEN_TUNE）真係落到敵人身上 ----------
   呢個係「校完平衡但線冇接好」嘅守門測試：REGIONS[g].tune 郁咗而 genMon 冇跟，
   通關率完全唔會變，而三個世代嘅數要成日跑先發現。 */
const gtune = await page.evaluate(()=>{
  const A = 4;                                   // 第 5 章（0 起）
  const R = REGIONS[1], keep = { hp:R.tune.hp.slice(), dmg:R.tune.dmg.slice() };
  /* 招式模板係隨機抽 4 款，所以傷害睇「抽好多次入面最勁嗰招」先穩定 */
  const maxDmg = (dex, tier) => Math.max(...Array.from({length:60},
    ()=>Math.max(...genMon(dex, tier, A).deck.map(m=>m.dmg||0))));
  const sample = (g, dex) => { setGen(g); return {
    mobHp: genMon(dex,'mob',A).maxHp, gymHp: genMon(dex,'gym',A).maxHp,
    e4Hp:  genMon(dex,'e4', A).maxHp,
    mobDmg: maxDmg(dex,'mob'), e4Dmg: maxDmg(dex,'e4') }; };
  const before = sample(1, 155), kBefore = sample(0, 4);
  /* 淨係郁城都第 5 章嗰格 */
  R.tune.hp  = R.tune.hp .map((v,i)=> i===A ? 0.5 : v);
  R.tune.dmg = R.tune.dmg.map((v,i)=> i===A ? 2   : v);
  const after = sample(1, 155), kAfter = sample(0, 4);
  R.tune.hp = keep.hp; R.tune.dmg = keep.dmg;
  const restored = sample(1, 155);
  setGen(0);
  return { before, after, kBefore, kAfter, restored };
});
const near = (a,b) => Math.abs(a-b) <= 2;
t('世代修正落到雜魚同館主嘅血度（hp×0.5）',
  near(gtune.after.mobHp, gtune.before.mobHp*0.5) && near(gtune.after.gymHp, gtune.before.gymHp*0.5),
  `雜魚 ${gtune.before.mobHp}→${gtune.after.mobHp}　館主 ${gtune.before.gymHp}→${gtune.after.gymHp}`);
t('世代修正落到敵人傷害度（dmg×2）',
  gtune.after.mobDmg >= gtune.before.mobDmg*1.5,
  `${gtune.before.mobDmg}→${gtune.after.mobDmg}`);
t('四天王／冠軍（flat）唔食世代修正',
  gtune.after.e4Hp === gtune.before.e4Hp && gtune.after.e4Dmg === gtune.before.e4Dmg,
  `血 ${gtune.before.e4Hp}→${gtune.after.e4Hp}　傷 ${gtune.before.e4Dmg}→${gtune.after.e4Dmg}`);
t('郁一個世代唔會影響第二個世代',
  gtune.kAfter.mobHp === gtune.kBefore.mobHp && gtune.kAfter.gymHp === gtune.kBefore.gymHp,
  `關都雜魚 ${gtune.kBefore.mobHp}→${gtune.kAfter.mobHp}`);
t('改返原值就返返原樣', gtune.restored.mobHp === gtune.before.mobHp,
  `${gtune.before.mobHp}→${gtune.restored.mobHp}`);

/* ---------- 8. 階段 2：存檔記住世代 ---------- */
const save = await page.evaluate(()=>{
  /* 喺城都開一局，然後**返返關都**先讀 —— 呢個就係最易出事嗰個情況：
     存檔畫面／PvP 會喺另一個世代度讀第二個世代嗰格。 */
  setGen(1);
  const run = newRun(__SIM.draftParty());
  run.act = 3;
  const raw = serializeRun(run);
  setGen(0);
  const back = deserializeRun(raw);

  /* 舊 v4 存檔（冇 gen 呢個欄位）要當關都 */
  setGen(0);
  const raw0 = serializeRun(newRun(__SIM.draftParty()));
  const old = Object.assign({}, raw0, { v:4 });
  delete old.gen;
  const backOld = deserializeRun(old);

  return {
    ver: raw.v, savedGen: raw.gen,
    gen: back.gen,
    gym1: back.gymOrder[0].name, gym8: back.gymOrder[7].name,
    activeAfter: ACTIVE_GEN,                 // 讀存檔唔應該偷偷改咗現行世代
    oldGen: backOld ? backOld.gen : null,
    oldGym1: backOld ? backOld.gymOrder[0].name : null,
    partyOk: back.party.every(m=>inGen(m.baseDex, 1)),
  };
});
t('SAVE_VER 升到 5 而且存檔記住 gen', save.ver === 5 && save.savedGen === 1,
  `v${save.ver}・gen ${save.savedGen}`);
t('喺關都讀城都存檔，道館仲係城都',
  save.gen === 1 && save.gym1 === '阿速' && save.gym8 === '小椿',
  `${save.gym1}→${save.gym8}`);
t('讀存檔唔會偷偷改咗現行世代', save.activeAfter === 0, `ACTIVE_GEN ${save.activeAfter}`);
t('城都存檔嘅隊伍全部係城都', save.partyOk);
t('舊 v4 存檔（冇 gen）當關都', save.oldGen === 0 && save.oldGym1 === '小剛',
  `gen ${save.oldGen}・${save.oldGym1}`);

/* ---------- 9. 階段 2：名人堂分世代 + 舊格式搬得返 ---------- */
const hof = await page.evaluate(()=>{
  for(let g=0; g<REGIONS.length; g++)
    for(let i=0;i<HOF_SLOTS;i++) localStorage.removeItem(HOF_KEY(g,i));
  for(let i=0;i<HOF_SLOTS;i++) localStorage.removeItem(HOF_KEY0(i));

  /* 舊格式：plakoro.hof.<i>，冇世代（嗰陣得關都） */
  localStorage.setItem(HOF_KEY0(1), JSON.stringify({ won:true, ts:1, party:[{dex:1}] }));
  hofMigrateLocal();
  const moved = JSON.parse(localStorage.getItem(HOF_KEY(0,1)) || 'null');
  const gone  = localStorage.getItem(HOF_KEY0(1));

  /* 再搬多次唔可以整爛啱啱搬好嗰份 */
  hofMigrateLocal();
  const stillThere = !!localStorage.getItem(HOF_KEY(0,1));

  /* 三個世代各自一格，唔會互相覆蓋 */
  localStorage.setItem(HOF_KEY(1,1), JSON.stringify({ won:false, ts:2, party:[{dex:152}] }));
  localStorage.setItem(HOF_KEY(2,1), JSON.stringify({ won:false, ts:3, party:[{dex:252}] }));
  const each = [0,1,2].map(g=>(hofLoadLocal(g,1)||{}).party[0].dex);

  /* hofEntry 要記低係邊個世代（存入邊三格靠佢） */
  setGen(2);
  const run = newRun(__SIM.draftParty());
  const e = hofEntry(run, false);
  setGen(0);
  return { moved:!!(moved && moved.won), gone:gone===null, stillThere, each, entryGen:e.gen };
});
t('舊名人堂（冇世代）搬入關都嗰三格', hof.moved && hof.gone);
t('搬多次都唔會整爛', hof.stillThere);
t('三個世代嘅名人堂各自獨立', hof.each.join(',') === '1,152,252', hof.each.join(','));
t('hofEntry 記住係邊個世代', hof.entryGen === 2, `gen ${hof.entryGen}`);

/* ---------- 10. 階段 2：進化唔到嘅 baby 唔會喺開局三選一出 ---------- */
const baby = await page.evaluate(()=>{
  const dead = [...DEAD_END_BASIC].sort((a,b)=>a-b);
  const inDraft = [];
  for(let g=0; g<REGIONS.length; g++){
    setGen(g);
    const { lo, hi } = DEX_GENS[g];
    for(let n=lo;n<=hi;n++) if(canDraft(n) && DEAD_END_BASIC.has(n)) inDraft.push(n);
  }
  setGen(0);
  /* 但佢哋照要留喺野外池同圖鑑度 —— 排除嘅只係開局抽卡 */
  setGen(1);
  const wild = dexPool([1,2,3]).map(d=>d.n).includes(172);
  setGen(0);
  return { dead, inDraft, wild, hasDex: !!DEX[172] };
});
t('進化唔到嘅 baby 全部捉得返', baby.dead.join(',') === '172,173,174,238,239,240,298,360',
  baby.dead.join(','));
t('開局三選一唔會出佢哋', !baby.inDraft.length, baby.inDraft.join(','));
t('但野外同圖鑑照有', baby.wild && baby.hasDex);

/* ---------- 埋數 ---------- */
console.log('');
out.forEach(([ok,name,extra])=>console.log(`${ok?'✅':'❌'} ${name}${extra?'　'+extra:''}`));
const bad = out.filter(r=>!r[0]).length;
console.log(`\n${out.length - bad}/${out.length} 過關`);
if(errors.length) console.log('\n⚠ 頁面錯誤：\n' + errors.slice(0,8).join('\n'));
await browser.close();
process.exit(bad || errors.length ? 1 : 0);
