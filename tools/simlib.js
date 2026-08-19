/* ============================================================
   POKE TOWER 爬塔模擬器
   ------------------------------------------------------------
   喺 headless 瀏覽器度載入 index.html 之後注入呢個檔案，
   就可以用遊戲本身嘅引擎跑成千上萬局爬塔，量度真實通關率。

   模擬嘅係一個「識玩但唔會神操作」嘅玩家：
     - 每回合揀期望值最高嗰招（命中率 × 傷害，打弱點加權）
     - 上場嗰隻血少過兩成、而有健康隊友就換人
     - 獎勵優先攞遺物 > 招式強化 > 新招 > 骰晶片
     - 商店有錢就買（遺物行先，血少先買傷藥）
     - 走地圖時隨機揀下一個節點

   量度出嚟嘅「通關率」＝ 行到嗰章嘅局數入面，成功打低道館主嘅比率。
   （途中俾雜魚打死都算冇通關，因為咁樣一樣打唔到道館主）
   ============================================================ */
window.__SIM = (function(){

/* ---------- 命中率快取 ----------
   一招打唔打得出，只係睇「骰組」同「招式嘅能量需求」，兩樣喺一場戰鬥入面都唔會變，
   所以每隻寶可夢淨係計一次就夠，唔使每個回合重新擲幾百次。
   只有換骰晶片（改骰組）同學新招（改能量需求）先要重新計 ——
   進化、招式強化只係加傷害，命中率一樣，唔使清 cache。 */
let EPOCH = 0;
const bumpEpoch = () => { EPOCH++; };
const HIT_SAMPLES = 1200;

function hitRates(mon){
  if(mon.__epoch === EPOCH && mon.__hit && mon.__hit.length === mon.deck.length) return mon.__hit;
  const out = mon.deck.map(m=>{
    let ok = 0;
    for(let k=0;k<HIT_SAMPLES;k++){
      const e=[]; for(let d=0;d<3;d++) e.push(...mon.dice[d][Math.floor(Math.random()*6)]);
      if(payCost(m.cost, e)) ok++;
    }
    return ok/HIT_SAMPLES;
  });
  mon.__epoch = EPOCH; mon.__hit = out;
  return out;
}

/* 玩家揀招：永遠揀期望值最高嗰張
   （遊戲自己嗰個 enemyChoose 有兩成隨機，唔啱用嚟扮識玩嘅人） */
function playerChoose(g){
  const me = g.p[0], op = g.p[1];
  const rates = hitRates(me);
  let best = 0, bestEv = -1;
  me.deck.forEach((m,i)=>{
    if(me.lastMove && me.lastMove.name === m.name) return;
    if(me.pendingLock === m.name) return;
    const face = (m.faces && m.faces[0]) || {f:'', ops:[]};
    const add  = (face.ops.find(o=>o.t==='add') ||{}).v || 0;
    const heal = (face.ops.find(o=>o.t==='heal')||{}).v || 0;
    const ev = (rates[i]||0) * ((m.dmg||0) + add*(face.f.length/6) + heal*0.5
                                + (m.type === op.spec.weak ? 20 : 0));
    if(ev > bestEv){ bestEv = ev; best = i; }
  });
  return best;
}

function fight(run, kind){
  const enemy = buildEnemy(run, kind);
  const g = battleStart(run, enemy);
  let t = 0;
  while(!g.over && t < 400){
    if(g.turn === 0){
      const sd = g.sides[0], m = sd.party[sd.active];
      if(m.hp/m.maxHp < 0.22 && aliveOf(sd).length > 1){
        const alt = sd.party.findIndex((x,i)=> i!==sd.active && x.hp>0 && x.hp/x.maxHp > 0.55);
        if(alt >= 0 && Math.random() < 0.7){ partySwitch(g,0,alt); t++; continue; }
      }
      if(g.rs.dice) g.p[0].pendingDiceMod += g.rs.dice;
      partyTurn(g, playerChoose(g), null, newSeed());
    } else {
      const sw = enemyMaybeSwitch(g);
      if(sw >= 0){ partySwitch(g,1,sw); t++; continue; }
      partyTurn(g, enemyChoose(g), null, newSeed());
    }
    t++;
  }
  return { win: g.winner === 0, fought: [...(g.fought||[])], turns: t };
}

/* 攞獎勵：遺物 > 招式強化 > 新招 > 晶片 */
const RW_RANK = { relic:0, up:1, move:1, add:2, chip:3 };
function takeReward(run, kind){
  const rw = rollRewards(run, kind);
  if(!rw.length) return null;
  const rank = k => (RW_RANK[k] == null ? 9 : RW_RANK[k]);
  rw.sort((a,b)=>rank(a.kind) - rank(b.kind));
  const pick = rw[0];
  try{
    if(pick.kind === 'chip')     pick.apply(run, {die:rnd(3), slot:rnd(4)});
    else if(pick.kind === 'add') pick.apply(run, {slot: rnd(MOVE_MAX)});
    else                         pick.apply(run);
  }catch(e){}
  if(pick.kind === 'chip' || pick.kind === 'add') bumpEpoch();
  return pick.kind;
}

function doEvolutions(run){
  for(let guard=0; guard<6; guard++){
    const list = pendingEvolutions(run);
    if(!list.length) return;
    const one = list[0];
    const to = Array.isArray(one.to) ? one.to[rnd(one.to.length)] : one.to;
    evolveMon(one.mon, to);
  }
}

function doShop(run){
  const rs = relicSum(run);
  const disc = 1-(rs.discount||0);
  const items = [];
  relicRewards(run,5).filter(r=>!SHOP_BAN_RELIC.has(r.relic.id)).slice(0,1)
    .forEach(r=>items.push({...r, cost:Math.round((70+(r.relic.rare||0)*45+rnd(50))*disc)}));
  const mu = moveUpgrades(run);
  if(mu.length) items.push({...mu[rnd(mu.length)], cost:Math.round((70+rnd(40))*disc)});
  items.push({ kind:'heal', cost:Math.round(60*disc),
    apply(run){ run.party.forEach(m=>{ if(m.hp>0) m.hp=Math.min(m.maxHp,m.hp+40); }); } });

  const hurt = run.party.slice(0, ACTIVE_N).some(m=>m.hp>0 && m.hp/m.maxHp < 0.7);
  const rank = k => ({relic:0, move:1, heal: hurt?2:9}[k] ?? 9);
  items.sort((a,b)=>rank(a.kind) - rank(b.kind));
  for(const it of items){
    if(run.gold < it.cost) continue;
    run.gold -= it.cost;
    try{ it.apply(run); }catch(e){}
  }
}

function doChest(run){
  run.gold += 40+rnd(60);
  const rel = rnd(100) < CHEST_RELIC_CHANCE ? relicRewards(run,1)[0] : null;
  if(rel) rel.apply(run);
  else { run.chipTokens=(run.chipTokens||0)+1+rnd(2); run.gold += 25+rnd(35); }
}

function doRest(run){
  run.party.forEach(m=>{
    m.hp = m.hp<=0 ? Math.round(m.maxHp*0.5) : Math.min(m.maxHp, m.hp+restHeal(m));
  });
}

/* 同 enterNode 入面「未知」節點嘅分配一致 */
function resolveUnknown(run){
  const roll = rnd(100);
  if(run.act>=2 && roll<8) return 'legend';
  if(roll<48) return 'mob';
  if(roll<66) return 'chest';
  if(roll<86) return 'rest';
  return 'shop';
}

/* 行一章：由第 1 層行到道館主 */
function runAct(run){
  run.map = genMap(run.act);
  const rows = run.map.rows;
  let node = rows[0][rnd(rows[0].length)];
  for(let step=0; step<40; step++){
    let kind = node.type;
    if(kind === 'unknown') kind = resolveUnknown(run);

    if(kind==='mob' || kind==='elite' || kind==='boss' || kind==='legend'){
      const res = fight(run, kind);
      if(!res.win) return { cleared:false, wiped:true, atBoss:kind==='boss' };
      afterWin(run, res.fought);
      doEvolutions(run);
      if(kind==='boss'){
        earnBadge(run);
        run.gold += goldFor('boss', run.act);
        takeReward(run, 'boss');
        return { cleared:true, wiped:false };
      }
      postFightRecover(run);
      run.gold += goldFor(kind==='legend'?'elite':kind, run.act) + (relicSum(run).gold||0);
      takeReward(run, kind==='legend'?'elite':kind);
    }
    else if(kind==='rest')  doRest(run);
    else if(kind==='shop')  doShop(run);
    else if(kind==='chest') doChest(run);

    if(!node.next || !node.next.length) break;
    node = node.next[rnd(node.next.length)];
  }
  return { cleared:false, wiped:false };
}

/* 四天王 4 連戰 + 冠軍。
   同章節唔同：贏完淨係回 E4_HEAL（15%），冇 postFightRecover，
   亦都冇篝火商店可以行，所以係一場消耗戰。 */
function runE4(run){
  run.stage = 'e4';
  run.e4 = 0;
  while(run.e4 < ELITE4.length){
    const res = fight(run, 'e4');
    if(!res.win) return false;
    afterWin(run, res.fought);
    doEvolutions(run);
    run.party.forEach(m=>{ if(m.hp>0) m.hp = Math.min(m.maxHp, m.hp + Math.round(m.maxHp*E4_HEAL)); });
    run.gold += goldFor('e4', run.act) + (relicSum(run).gold||0);
    run.e4++;
    takeReward(run, 'boss');
  }
  const fin = fight(run, 'champ');
  return fin.win;
}

/* 開局抽卡：同真人一樣，第 1 抽御三家，之後兩抽基礎精靈 */
const bfCache = {};
const bestFourCached = dex => (bfCache[dex] || (bfCache[dex] = bestFour(dex)));
function draftParty(){
  const picks = [], seen = new Set();
  const first = STARTERS[rnd(STARTERS.length)];
  picks.push({ dex:first, setIdx:0, deckIdx:bestFourCached(first), loadout:defaultLoadout() });
  seen.add(first);
  const pool = [];
  for(let n=1;n<=151;n++) if(isBasic(n) && !STARTERS.includes(n)) pool.push(n);
  while(picks.length < 3){
    const d = pool[rnd(pool.length)];
    if(seen.has(d)) continue;
    seen.add(d);
    picks.push({ dex:d, setIdx:0, deckIdx:bestFourCached(d), loadout:defaultLoadout() });
  }
  return picks;
}

/* 跑 N 局，記低每章嘅道館主通關率（條件機率：行到嗰章先計） */
function measure(diff, N){
  const saveDiff = DIFF;
  DIFF = diff;
  const reach = [0,0,0,0], clear = [0,0,0,0];
  const relicsAt = [[],[],[],[]];
  let gymAll = 0, e4Clear = 0;
  for(let k=0;k<N;k++){
    const run = newRun(draftParty());
    run.diff = diff;
    bumpEpoch();
    for(let act=1; act<=4; act++){
      run.act = act;
      reach[act-1]++;
      const before = run.relics.length;
      const res = runAct(run);
      relicsAt[act-1].push(run.relics.length - before);
      if(!res.cleared) break;
      clear[act-1]++;
      if(act===4){ gymAll++; if(runE4(run)) e4Clear++; }
    }
  }
  DIFF = saveDiff;
  const pct = (a,b) => b ? Math.round(a/b*100) : 0;
  return {
    reach, clear,
    clearRate: clear.map((c,i)=>pct(c, reach[i])),
    relicPerAct: relicsAt.map(a=>a.length ? +(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2) : 0),
    /* 四天王：打低四館主嘅局數入面，有幾多完成 4 連戰 + 冠軍 */
    e4Reach: gymAll, e4Clear, e4Rate: pct(e4Clear, gymAll),
    gymAll: pct(gymAll, N),          // 四館全通（未計四天王）
    fullClear: pct(e4Clear, N),      // 真・全通：連冠軍都打低
  };
}

return { measure, runAct, runE4, fight, draftParty, bumpEpoch };
})();
