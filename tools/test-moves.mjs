/* 階段 4（新技能）嘅回歸測試。
   守住嘅係「加咗招之後最容易靜靜哋壞、又冇人發覺」嗰幾樣：

     1. util 嗰格真係出得街（以前俾副屬性招踩咗，四個輔助模板等於唔存在）
     2. 每個模板喺十個屬性都有名、每個角色骰面都有描述
        （flavor / opText 漏咗一個都唔會報錯，玩家淨係見到空白同 undefined）
     3. 五種新效果真係做到嘢：連續技、援護、反擊、賭命、追擊
     4. 援護唔可以令倒低咗嘅隊友翻生（同抗性遺物撞過嗰個坑）
     5. faceEV 識睇晒新 op —— 唔識就等於「加咗招冇人肯揀」
     6. 敵人冇 ×2（tameAdd 壓唔住，會變成後期一擊清枱）

   用法：node tools/test-moves.mjs
*/
import { boot } from './_boot.mjs';

const { browser, page, errors } = await boot();
const out = [];
const t = (name, ok, extra='') => { out.push([ok, name, extra]); };

/* ---------- 1. 招式生成 ---------- */
const gen = await page.evaluate(()=>{
  const NEWK = ['snipe','counter','combo','gamble','mend','evade'];
  const counts = {}, keyHit = {};
  NEWK.forEach(k=>keyHit[k]=0);
  const noName = [], noText = [];
  /* 三個世代 386 隻全部生成一次 —— 世代唔同，屬性分佈都唔同 */
  const allNames = {};
  Object.keys(TYPE_FLAVOR).forEach(ty=>NEWK.forEach(k=>{
    allNames[TYPE_FLAVOR[ty][k]] = k;
  }));
  for(let n=1;n<=386;n++){
    if(!DEX[n] || officialPkIdx(n)>=0) continue;      // 官方 12 隻用原裝卡表
    const moves = genPlayable(n).sets[0].moves;
    counts[moves.length] = (counts[moves.length]||0) + 1;
    moves.forEach(m=>{
      if(!m.name || /undefined/.test(m.name)) noName.push(n+'：'+m.name);
      (m.faces||[]).forEach(f=>{ if(!f.t) noText.push(n+'：'+m.name); });
      const k = allNames[m.name.replace(/[·+\d]+$/,'')];
      if(k) keyHit[k]++;
    });
  }
  /* util 模板（屏障／療愈／迴避／集氣）真係攞得到 —— 以前呢四個由頭到尾冇人有 */
  const utilNames = new Set();
  PMV.util.forEach(tm=>Object.keys(TYPE_FLAVOR).forEach(ty=>{
    utilNames.add(flavor(ty, tmplKey(tm)) || tm.n);
  }));
  let utilSeen = 0;
  for(let n=1;n<=386;n++){
    if(!DEX[n] || officialPkIdx(n)>=0) continue;
    if(genPlayable(n).sets[0].moves.some(m=>utilNames.has(m.name.replace(/[·+\d]+$/,'')))) utilSeen++;
  }
  /* 十個屬性 × 每個模板都要有名（靠 fallback 執到嗰啲唔算數）。
     模板清單由 PMV + MV_T 自己夾出嚟，唔另外維護一份名單 */
  const keys = new Set(MV_T.map(m=>m.k));
  Object.values(PMV).forEach(list=>list.forEach(tm=>keys.add(tmplKey(tm))));
  const missing = [];
  Object.keys(TYPE_FLAVOR).forEach(ty=>{
    keys.forEach(k=>{ if(!TYPE_FLAVOR[ty][k]) missing.push(ty+'.'+k); });
  });
  return { counts, keyHit, noName:noName.slice(0,5), noNameN:noName.length,
           noText:noText.slice(0,5), noTextN:noText.length, utilSeen, missing };
});
t('每隻生成角色有 8 招', Object.keys(gen.counts).length===1 && gen.counts['8']>0,
  JSON.stringify(gen.counts));
t('util 模板真係攞得到', gen.utilSeen > 100, `${gen.utilSeen} 隻有輔助招`);
t('冇招式名係 undefined', gen.noNameN===0, gen.noName.join('・'));
t('每個角色骰面都有描述', gen.noTextN===0, gen.noText.join('・'));
t('十個屬性 × 每個模板都有名', gen.missing.length===0, gen.missing.slice(0,6).join('・'));
Object.entries(gen.keyHit).forEach(([k,n])=>t(`新模板「${k}」出得到`, n>0, `${n} 招`));

/* ---------- 2. 效果真係做到嘢 ----------
   角色骰用 CHAR_WEIGHTS 夾死一個面，先至測得準（唔係要撞彩） */
const fx = await page.evaluate(()=>{
  const force = f => { CHAR_WEIGHTS = {}; ORIENT.forEach(o=>CHAR_WEIGHTS[o] = o===f ? 1 : 0); };
  /* 造一場「一定擲得到能量」嘅對局：兩邊骰面全部係要用嗰隻能量 */
  const rig = (deck, type) => {
    const p = newPlayer(0, 0, deck, '測試', defaultLoadout());
    p.dice = [0,1,2].map(()=>Array.from({length:6},()=>[type,type,type,type]));
    p.hp = p.maxHp = 500;
    /* 弱點要夾死一個唔會撞到嘅屬性，唔係「命中弱點 +20」會扮咗係模板嘅功勞 */
    p.spec = {...p.spec, weak:'——'};
    return p;
  };
  const mk = (tmpl, type) => mkPlayMove(type, tmpl, false);
  const find = (slot, k) => PMV[slot].find(x=>x.k===k);
  const res = {};

  /* 連續技：擲兩次角色骰、兩次都加傷 */
  {
    const mv = mk(find('strong','combo'), '草');
    const a = rig([mv], '草'), b = rig([mv], '草');
    const g = newGame(a, b, 0); g.turnNo = 1;          // 唔好食「先攻首回合少一粒」
    force('上');
    const L = takeTurn(g, 0, null);
    res.comboRolls = L.charRolls.length;
    res.comboDmg = L.dmg;                              // 20 基本 + 兩次 20
    res.comboSaysRolls = /2次角色骰/.test(mv.baseT||'');
  }
  /* 援護：後備回血、倒低咗嘅唔會翻生、上場嗰隻唔關事 */
  {
    const mv = mk(find('util','mend'), '草');
    const mine = [rig([mv],'草'), rig([mv],'草'), rig([mv],'草')];
    mine[1].hp = 100; mine[2].hp = 0;
    const foe = [rig([mv],'草')];
    const g = newGame(mine[0], foe[0], 0); g.turnNo = 1;
    g.sides = [{party:mine, active:0}, {party:foe, active:0}];
    mine[0].hp = 200;
    force('上');
    takeTurn(g, 0, null);
    res.benchHealed = mine[1].hp;      // 100 + 30
    res.faintedStays = mine[2].hp;     // 一定要係 0
    res.activeSame  = mine[0].hp;      // 200（援護唔回自己）
  }
  /* 援護喺經典 1v1（冇 sides）唔會炸 */
  {
    const mv = mk(find('util','mend'), '草');
    const g = newGame(rig([mv],'草'), rig([mv],'草'), 0); g.turnNo = 1;
    force('上');
    let ok = true;
    try{ const L = takeTurn(g, 0, null); ok = L.success; }catch(e){ ok = 'throw:'+e.message; }
    res.mendSolo = ok;
  }
  /* 反擊：還返對手上一招卡面寫住嘅傷害 */
  {
    const mv = mk(find('mid','counter'), '草');
    const a = rig([mv],'草'), b = rig([mv],'草');
    const g = newGame(a, b, 0); g.turnNo = 1;
    b.lastMove = { name:'假招', dmg:70 };
    force('上');
    const L = takeTurn(g, 0, null);
    res.counterDmg = L.dmg;            // 10 基本 + 70 反射
  }
  /* 賭命：上 = ×2、下 = 失敗、右 = 照原數 */
  {
    const mv = mk(find('heavy','gamble'), '草');
    const run3 = face => {
      const g = newGame(rig([mv],'草'), rig([mv],'草'), 0); g.turnNo = 1;
      force(face);
      return takeTurn(g, 0, null);
    };
    res.gambleUp = run3('上').dmg;     // 50 × 2
    const dn = run3('下');
    res.gambleDown = dn.dmg; res.gambleDownOk = dn.success;
    res.gambleFlat = run3('右').dmg;   // 50
  }
  /* 追擊：對手上回合失敗先加傷 */
  {
    const mv = mk(find('cheap','snipe'), '草');
    const shot = failed => {
      const a = rig([mv],'草'), b = rig([mv],'草');
      const g = newGame(a, b, 0); g.turnNo = 1;
      b.lastSuccess = failed ? false : true;
      force('上');
      return takeTurn(g, 0, null).dmg;
    };
    res.snipeHit = shot(true);         // 10 + 40
    res.snipeMiss = shot(false);       // 10
  }
  CHAR_WEIGHTS = null;
  return res;
});
t('連續技擲兩次角色骰', fx.comboRolls===2, `${fx.comboRolls} 次`);
t('連續技兩次都計數', fx.comboDmg===60, `${fx.comboDmg} 傷（20+20+20）`);
t('連續技招式卡有講擲幾多次', fx.comboSaysRolls);
t('援護回後備隊友嘅血', fx.benchHealed===130, `100 → ${fx.benchHealed}`);
t('援護唔會令倒下嘅翻生', fx.faintedStays===0, `HP ${fx.faintedStays}`);
t('援護唔回上場嗰隻', fx.activeSame===200, `HP ${fx.activeSame}`);
t('經典 1v1 用援護唔會炸', fx.mendSolo===true, String(fx.mendSolo));
t('反擊還返對手上一招嘅傷害', fx.counterDmg===80, `${fx.counterDmg} 傷（10+70）`);
t('賭命「上」傷害 ×2', fx.gambleUp===100, `${fx.gambleUp} 傷`);
t('賭命「下」直接失敗', fx.gambleDown===0 && fx.gambleDownOk===false, `${fx.gambleDown} 傷`);
t('賭命「右」照原數', fx.gambleFlat===50, `${fx.gambleFlat} 傷`);
t('追擊：對手上回合失敗就加傷', fx.snipeHit===50, `${fx.snipeHit} 傷`);
t('追擊：對手冇失敗就唔加', fx.snipeMiss===10, `${fx.snipeMiss} 傷`);

/* ---------- 3. faceEV 識睇晒新 op ---------- */
const ev = await page.evaluate(()=>{
  const mk = (slot,k,ty) => mkPlayMove(ty, PMV[slot].find(x=>x.k===k), false);
  const v = {};
  ['snipe','counter','combo','gamble','mend'].forEach(k=>{
    const slot = {snipe:'cheap', counter:'mid', combo:'strong', gamble:'heavy', mend:'util'}[k];
    v[k] = +faceEV(mk(slot,k,'草')).toFixed(2);
  });
  /* 賭命有「失敗」嗰面，扣分要真係扣到 */
  const g = mk('heavy','gamble','草');
  v.gambleNet = +faceEV(g).toFixed(2);
  /* 連續技擲兩次 = 期望值要係擲一次嘅兩倍 */
  const one = mk('strong','combo','草');
  const two = JSON.parse(JSON.stringify(one)); delete two.charRolls;
  v.comboX = +(faceEV(one)/faceEV(two)).toFixed(2);
  return v;
});
['snipe','counter','combo','gamble','mend'].forEach(k=>
  t(`faceEV 睇得到「${k}」`, ev[k] > 0, `${ev[k]} 分`));
t('連續技嘅期望值 = 兩倍', ev.comboX===2, `×${ev.comboX}`);

/* ---------- 4. 敵人嗰邊 ---------- */
const foe = await page.evaluate(()=>{
  const tiers = Object.keys(TIER);
  /* 敵人唔可以有 ×2 / 失敗 —— 佢哋嘅基本傷害本身已經乘咗成局倍率 */
  const banned = [];
  tiers.forEach(k=>TIER[k].mv.forEach(key=>{
    const tm = MV_T.find(m=>m.k===key);
    if(!tm) return banned.push(`${k}：冇 ${key} 呢個模板`);
    const ops = [tm.op, tm.alt && tm.alt.op].filter(Boolean);
    if(ops.some(o=>o.t==='x2' || o.t==='fail')) banned.push(`${k}：${key}`);
  }));
  /* 援護淨係應該落喺一定有後備隊友嗰幾個 tier */
  const mendIn = tiers.filter(k=>TIER[k].mv.includes('mend'));
  /* 每個 tier 抽得到嘅招都要有名有描述、cnt 唔可以多過池 */
  const bad = [];
  tiers.forEach(k=>{
    if(TIER[k].mv.length < TIER[k].cnt) bad.push(`${k} 池得 ${TIER[k].mv.length} 招`);
    for(let a=0;a<ACTS;a++){
      for(let i=0;i<25;i++){
        genMon(1+Math.floor(Math.random()*386), k, a).deck.forEach(m=>{
          if(!m.name) bad.push(`${k}/${a}：冇名`);
          (m.faces||[]).forEach(f=>{ if(!f.t) bad.push(`${k}/${a}：${m.name} 冇描述`); });
        });
      }
    }
  });
  /* 敵人最大一擊（連新模板嘅連續技一齊計）唔可以大過玩家血量 */
  let worst = 0, worstAt = '';
  ['gym','e4','champ'].forEach(k=>{
    for(let i=0;i<600;i++){
      const m = genMon(1+Math.floor(Math.random()*386), k, ACTS-1);
      m.deck.forEach(mv=>{
        const per = (mv.faces||[]).reduce((s,f)=>
          Math.max(s, (f.ops.find(o=>o.t==='add')||{}).v||0), 0);
        const hit = (mv.dmg||0) + per*(mv.charRolls||1);
        if(hit > worst){ worst = hit; worstAt = `${k}・${mv.name}`; }
      });
    }
  });
  return { banned, mendIn, bad:[...new Set(bad)].slice(0,5), badN:bad.length, worst, worstAt };
});
t('敵人冇 ×2 / 自動失敗嘅招', foe.banned.length===0, foe.banned.join('・'));
t('援護淨係落有隊友嘅 tier',
  foe.mendIn.length>0 && foe.mendIn.every(k=>['gym','e4','champ'].includes(k)),
  foe.mendIn.join('・') || '（冇 tier 用緊）');
t('敵人招式冚唪唥有名有描述', foe.badN===0, foe.bad.join('・'));
/* 第 8 章玩家出戰三隻嘅平均最大 HP（同 test-features.mjs 嗰行一樣） */
t(`敵人最大一擊 ${foe.worst} < 第 8 章血量 317`, foe.worst < 317, foe.worstAt);

/* ---------- 5. 升級同存檔 ---------- */
const keep = await page.evaluate(()=>{
  const run = newRun(__SIM.draftParty());
  /* 逐個新模板塞一招落隊，再出入一次存檔 */
  const mine = run.party[0];
  ['snipe','counter','combo','gamble','mend'].forEach(k=>{
    const slot = {snipe:'cheap', counter:'mid', combo:'strong', gamble:'heavy', mend:'util'}[k];
    mine.deck.push(mkPlayMove('草', PMV[slot].find(x=>x.k===k), false));
  });
  const before = mine.deck.map(m=>`${m.name}|${m.dmg}|${m.charRolls||1}|${(m.faces||[]).map(f=>f.f+f.t).join('')}`);
  const back = deserializeRun(serializeRun(run));
  const after = back.party[0].deck.map(m=>`${m.name}|${m.dmg}|${m.charRolls||1}|${(m.faces||[]).map(f=>f.f+f.t).join('')}`);

  /* 招式升級：partyHeal 都要升得（唔係升極都一樣） */
  const mend = mkPlayMove('草', PMV.util.find(x=>x.k==='mend'), false);
  const v0 = mend.faces[0].ops[0].v;
  upgradeMove(mend);
  return { same: JSON.stringify(before)===JSON.stringify(after),
           n: before.length, v0, v1: mend.faces[0].ops[0].v };
});
t('新招入得存檔又出得返', keep.same, `${keep.n} 招`);
t('援護升級加得到數值', keep.v1 === keep.v0 + 10, `${keep.v0} → ${keep.v1}`);

/* ---------- 6. 三個畫面都要畫齊粒粒角色骰 ----------
   以前三處都寫死 charRolls[0]。連續技擲兩次，畫面得一粒骰、
   結算文字卻話追加咗兩次 —— 玩家會以為計錯數。 */
const draw = await page.evaluate(async ()=>{
  /* 造一份「擲咗兩次角色骰」嘅結算 log（唔使真係打一場） */
  const L = { move:{name:'連斬', type:'草'}, moveIdx:0, attacker:0,
              steps:[], energyRolls:[[{die:0,face:['草','草']}]],
              charRolls:['上','右'], charVoid:false,
              success:true, dmg:60, selfDmg:0, heal:0, weak:false, blocked:0, final:60, extra:[] };
  const count = sel => document.querySelectorAll(sel + ' .cdie').length;
  const res = {};
  /* (1) 爬塔／經典嘅擲骰動畫 */
  const box = document.createElement('div'); document.body.appendChild(box);
  await rollDiceAnim(box, '', L, null);
  res.anim = box.querySelectorAll('.cdie').length;
  res.animFace = (box.querySelector('.dsFace')||{}).textContent || '';
  box.remove();
  /* (2) 擲骰結果面板 */
  const panel = document.createElement('div'); panel.id='tmPanel';
  document.body.appendChild(panel);
  renderDicePanel(L, '#tmPanel');
  res.panel = count('#tmPanel');
  panel.remove();
  /* (3) 隊伍 PvP 嘅全螢幕擲骰畫面 */
  diceStageRolling(L.move.name, '你出招', 2, L.charRolls.length);
  res.stageRolling = count('#diceStageIn');
  diceStageResult(L, '你出招');
  res.stageResult = count('#diceStageIn');
  diceStageHide();
  return res;
});
t('擲骰動畫畫齊兩粒角色骰', draw.anim===2, `${draw.anim} 粒`);
t('兩粒骰嘅字擺埋一齊', draw.animFace==='上・右', draw.animFace);
t('結果面板畫齊兩粒', draw.panel===2, `${draw.panel} 粒`);
t('全螢幕擲骰畫面轉緊都係兩粒', draw.stageRolling===2, `${draw.stageRolling} 粒`);
t('全螢幕擲骰畫面落定都係兩粒', draw.stageResult===2, `${draw.stageResult} 粒`);

/* ---------- 埋數 ---------- */
console.log('');
out.forEach(([ok,name,extra])=>console.log(`${ok?'✅':'❌'} ${name}${extra?'　'+extra:''}`));
const bad = out.filter(r=>!r[0]).length;
console.log(`\n${out.length - bad}/${out.length} 過關`);
if(errors.length) console.log('\n⚠ 頁面錯誤：\n' + errors.slice(0,8).join('\n'));
await browser.close();
process.exit(bad || errors.length ? 1 : 0);
