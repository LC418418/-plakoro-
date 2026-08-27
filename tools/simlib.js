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
   （遊戲自己嗰個 enemyChoose 有兩成隨機，唔啱用嚟扮識玩嘅人）
   ⚠ 角色骰嗰下值幾多，一律借遊戲嗰個 faceEV()，唔好喺呢度另寫一份 ——
     遊戲加咗新 op 而呢邊唔識睇，模擬器就會當新招冇價值永遠唔揀，
     量出嚟嘅通關率偏低而且唔會報錯（CLAUDE.md：simlib 要跟住遊戲改）。 */
function playerChoose(g){
  const me = g.p[0], op = g.p[1];
  const rates = hitRates(me);
  let best = 0, bestEv = -1;
  me.deck.forEach((m,i)=>{
    if(me.lastMove && me.lastMove.name === m.name) return;
    if(me.pendingLock === m.name) return;
    const ev = (rates[i]||0) * ((m.dmg||0) + faceEV(m, op)
                                + (m.type === op.spec.weak ? 20 : 0));
    if(ev > bestEv){ bestEv = ev; best = i; }
  });
  return best;
}

/* 打低對手一隻、佢仲有後備上場 —— 遊戲會彈個**免費**換人機會（offerFoeDownSwitch）。
   模擬器唔跟住做嘅話，量出嚟嘅通關率就會低過真人玩到嘅
   （見 CLAUDE.md：simlib 要跟住遊戲改，唔係「改工具去遷就測試」）。
   扮嘅係一個唔貪心嘅玩家：上場嗰隻血仲夠就唔換，血少過六成先趁免費換返隻精神啲嘅。 */
function freeSwitchIfFoeDown(g, L){
  if(g.over || !L || !(L.faint||[]).some(f=>f.side===1)) return;
  const sd = g.sides[0], m = sd.party[sd.active];
  if(aliveOf(sd).length < 2 || m.hp/m.maxHp > 0.6) return;
  let best = -1, bestScore = m.hp/m.maxHp;
  sd.party.forEach((x,i)=>{
    if(i!==sd.active && x.hp>0 && x.hp/x.maxHp > bestScore){ bestScore = x.hp/x.maxHp; best = i; }
  });
  if(best >= 0) partySwitch(g, 0, best, true);   // forceFree：唔消耗回合、唔使交換球
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
        if(alt >= 0 && Math.random() < 0.7){
          /* 同遊戲入面 doSwitch 一樣：有「交換球」消耗品就用一個，換人唔使回合 */
          const useTok = !g.rs.freeSwap && (run.swapTokens||0) > 0;
          if(useTok) run.swapTokens--;
          partySwitch(g,0,alt,useTok); t++; continue;
        }
      }
      if(g.rs.dice) g.p[0].pendingDiceMod += g.rs.dice;
      freeSwitchIfFoeDown(g, partyTurn(g, playerChoose(g), null, newSeed()));
    } else {
      const sw = enemyMaybeSwitch(g);
      if(sw >= 0){ partySwitch(g,1,sw); t++; continue; }
      /* 對手自傷打死自己嗰隻都算「打低咗一隻」，遊戲嗰邊一樣會彈換人 */
      freeSwitchIfFoeDown(g, partyTurn(g, enemyChoose(g), null, newSeed()));
    }
    t++;
  }
  return { win: g.winner === 0, fought: [...(g.fought||[])], turns: t };
}

/* 拎遺物。真人滿咗會彈個「掉邊件」嘅畫面，headless 度冇人撳得 ——
   所以喺呢度直接做返個決定：掉最冇稀有度嗰件，新嗰件唔夠好就索性唔換。
   回傳有冇拎到（商店要靠佢決定收唔收錢，同遊戲入面一樣）。 */
function simRelic(run, r){
  if(run.relics.length >= RELIC_MAX){
    let worst = 0;
    run.relics.forEach((o,i)=>{ if((o.rare||0) < (run.relics[worst].rare||0)) worst = i; });
    if((run.relics[worst].rare||0) >= (r.rare||0)) return false;
    dropRelic(run, worst);
  }
  addRelic(run, r);
  return true;
}

/* 攞獎勵：遺物 > 招式強化 > 新招 > 晶片 */
const RW_RANK = { relic:0, up:1, move:1, add:2, chip:3 };
function takeReward(run, kind){
  const rank = k => (RW_RANK[k] == null ? 9 : RW_RANK[k]);
  let rw = rollRewards(run, kind);
  if(!rw.length) return null;
  rw.sort((a,b)=>rank(a.kind) - rank(b.kind));
  /* 三個都係最尾嗰檔（晶片）而又仲有重置券，就重骰一次 —— 真人都會咁做 */
  if(rank(rw[0].kind) >= RW_RANK.chip && (run.reroll||0) > 0){
    run.reroll--;
    const again = rollRewards(run, kind);
    if(again.length){ again.sort((a,b)=>rank(a.kind) - rank(b.kind)); rw = again; }
  }
  const pick = rw[0];
  try{
    if(pick.kind === 'relic')    simRelic(run, pick.relic);
    else if(pick.kind === 'chip')pick.apply(run, {die:rnd(3), slot:rnd(4)});
    else if(pick.kind === 'add') pick.apply(run, {slot: rnd(MOVE_MAX)});
    else                         pick.apply(run);
  }catch(e){}
  if(pick.kind === 'chip' || pick.kind === 'add') bumpEpoch();
  return pick.kind;
}

/* 進化 / 特訓。進化唔到嘅（to 係 null）就特訓，血同傷害隨機揀一樣。 */
function doEvolutions(run){
  for(let guard=0; guard<6; guard++){
    const list = pendingEvolutions(run);
    if(!list.length) return;
    const one = list[0];
    if(!one.to){ trainMon(one.mon, Math.random()<0.5 ? 'hp' : 'dmg'); continue; }
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
  items.push({ kind:'swap', cost:Math.round((110+rnd(30))*disc),
    apply(run){ run.swapTokens=(run.swapTokens||0)+3; } });
  /* 道具袋嗰三款（同 openShop 一樣）。買咗擺入袋，doItems 先決定幾時用 */
  items.push({ kind:'potion', cost:Math.round((150+rnd(30))*disc),
    apply(run){ giveItem(run,'potion',1); } });
  items.push({ kind:'revive', cost:Math.round((175+rnd(40))*disc),
    apply(run){ giveItem(run,'revive',1); } });
  items.push({ kind:'skill',  cost:Math.round((120+rnd(30))*disc),
    apply(run){ giveItem(run,'skill',1); } });

  const hurt = run.party.slice(0, ACTIVE_N).some(m=>m.hp>0 && m.hp/m.maxHp < 0.7);
  const down = run.party.some(m=>m.hp<=0);
  /* 買嘢次序：遺物 > 招式 > 有人倒咗就買復活 > 傷藥 > 交換球 > 厲害傷藥 > 升級器。
     ⚠ 道具唔可以排太前 —— 佢哋貴，排頭位就會將啲錢食晒，遺物反而買唔起。 */
  const rank = k => ({relic:0, move:1, revive: down?2:9, heal: hurt?3:9,
                      swap:4, potion:5, skill:6}[k] ?? 9);
  items.sort((a,b)=>rank(a.kind) - rank(b.kind));
  for(const it of items){
    if(run.gold < it.cost) continue;
    try{
      /* 遺物換唔成就唔收錢，同遊戲入面一樣 */
      if(it.kind === 'relic'){ if(simRelic(run, it.relic)) run.gold -= it.cost; continue; }
      run.gold -= it.cost;
      it.apply(run);
    }catch(e){}
  }
}

function doChest(run){
  run.gold += 40+rnd(60);
  const rel = rnd(100) < CHEST_RELIC_CHANCE ? relicRewards(run,1)[0] : null;
  if(rel) simRelic(run, rel.relic);
  else {
    const loot = pickLoot();          // 用返 index.html 嗰張 CHEST_LOOT，唔好另寫一份
    loot.give(run, loot.amt());
    run.gold += 25+rnd(35);
  }
}

/* 用道具（🧪 厲害傷藥 / 💊 復活藥丸 / 📘 技能升級器）。
   真人喺地圖或者四天王開戰前撳「🎒 道具」用，所以模擬器都係每場開打之前決定一次。
   ⚠ 呢段唔跟住遊戲改嘅話，寶箱同商店派出嚟嘅道具會變成死貨，
     量出嚟嘅通關率就會偏低，而且唔會報錯。 */
function doItems(run){
  const have = id => ((run.items ? run.items[id] : 0)|0) > 0;
  const take = id => { run.items[id]--; };
  /* 升級器冇理由留喺袋：即刻用，揀出戰三隻入面傷害最高嗰招（真人都係咁揀） */
  while(have('skill')){
    const ups = moveUpgrades(run).filter(u=>u.pi < ACTIVE_N);
    if(!ups.length) break;
    let best = ups[0], bestDmg = -1;
    ups.forEach(u=>{
      const mv = run.party[u.pi].deck[u.mi];
      const d = (mv.dmg||0) + faceEV(mv);
      if(d > bestDmg){ bestDmg = d; best = u; }
    });
    take('skill'); best.apply(run);
  }
  /* 復活藥丸：出戰嗰三隻有人倒咗就即刻救 —— 得兩隻打落去係最容易死嘅狀態 */
  while(have('revive')){
    const i = run.party.findIndex((m,idx)=>idx < ACTIVE_N && m.hp<=0);
    if(i < 0) break;
    take('revive');
    run.party[i].hp = Math.max(1, Math.round(run.party[i].maxHp * ITEM_REVIVE_HP));
  }
  /* 厲害傷藥：出戰三隻平均血低過 55% 先用，唔好一拎到就掟 */
  while(have('potion')){
    const act = run.party.slice(0, ACTIVE_N).filter(m=>m.hp>0);
    if(!act.length) break;
    if(act.reduce((a,m)=>a+m.hp/m.maxHp, 0)/act.length > 0.55) break;
    take('potion');
    run.party.forEach(m=>{ if(m.hp>0) m.hp = Math.min(m.maxHp, m.hp + Math.round(m.maxHp*ITEM_HEAL)); });
  }
}

function doRest(run){
  run.party.forEach(m=>{
    m.hp = m.hp<=0 ? Math.round(m.maxHp*0.5) : Math.min(m.maxHp, m.hp+restHeal(m));
  });
}

/* 同 enterNode 入面「未知」節點嘅分配一致 */
function resolveUnknown(run){
  const roll = rnd(100);
  if(run.act>=2 && roll<12) return 'legend';
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
      doItems(run);                       // 地圖上面用道具，唔會用掉節點
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
   亦都冇篝火商店可以行，所以係一場消耗戰 ——
   唯一嘅補給就係開戰前用金幣買，價錢每用一次就貴一級。 */
function buyE4Heal(run){
  const cost = e4HealCost(run);
  if(run.gold < cost) return;
  if(!run.party.slice(0, ACTIVE_N).some(m=>m.hp>0 && m.hp/m.maxHp < 0.75)) return;
  run.gold -= cost;
  run.e4Heals = (run.e4Heals||0) + 1;
  run.party.forEach(m=>{ if(m.hp>0) m.hp = Math.min(m.maxHp, m.hp + Math.round(m.maxHp*E4_BUY_HEAL)); });
}
function runE4(run){
  run.stage = 'e4';
  run.e4 = 0;
  run.e4Heals = 0;
  DIAG.e4Gold.push(run.gold);
  DIAG.e4Relics.push(run.relics.length);
  while(run.e4 < ELITE4.length){
    buyE4Heal(run);
    doItems(run);                         // 四天王開戰前個彈框都用得道具
    const res = fight(run, 'e4');
    if(!res.win){ DIAG.e4Fell[run.e4]++; DIAG.e4Buys.push(run.e4Heals||0); return false; }
    afterWin(run, res.fought);
    doEvolutions(run);
    run.party.forEach(m=>{ if(m.hp>0) m.hp = Math.min(m.maxHp, m.hp + Math.round(m.maxHp*E4_HEAL)); });
    run.gold += goldFor('e4', run.act) + (relicSum(run).gold||0);
    run.e4++;
    takeReward(run, 'boss');
  }
  buyE4Heal(run);
  doItems(run);
  const fin = fight(run, 'champ');
  if(!fin.win) DIAG.e4Fell[4]++;
  DIAG.e4Buys.push(run.e4Heals||0);
  return fin.win;
}

/* 開局抽卡：同真人一樣，第 1 抽御三家，之後兩抽基礎精靈。
   ⚠ 三世代改版之後唔可以再寫死 1-151 —— 要行返遊戲嗰個 ACTIVE_GEN 嘅範圍，
     同埋行 canDraft()（唔係 isBasic()），咁先同 rollCands 一樣會排除
     嗰批「進化型喺上一代」嘅 baby。唔跟就等於量緊一個玩家玩唔到嘅池。 */
const bfCache = {};
const bestFourCached = dex => (bfCache[dex] || (bfCache[dex] = bestFour(dex)));
function draftParty(){
  const picks = [], seen = new Set();
  const first = STARTERS[rnd(STARTERS.length)];
  picks.push({ dex:first, setIdx:0, deckIdx:bestFourCached(first), loadout:defaultLoadout() });
  seen.add(first);
  const pool = [];
  const { lo, hi } = DEX_GENS[ACTIVE_GEN];
  for(let n=lo;n<=hi;n++) if(canDraft(n) && !STARTERS.includes(n)) pool.push(n);
  while(picks.length < 3){
    const d = pool[rnd(pool.length)];
    if(seen.has(d)) continue;
    seen.add(d);
    picks.push({ dex:d, setIdx:0, deckIdx:bestFourCached(d), loadout:defaultLoadout() });
  }
  return picks;
}

/* 調數值嗰陣想睇嘅零碎統計（四天王段落點解輸） */
const DIAG = { e4Gold:[], e4Relics:[], e4Buys:[], e4Fell:[0,0,0,0,0] };
const avg = a => a.length ? +(a.reduce((x,y)=>x+y,0)/a.length).toFixed(1) : 0;

/* 跑 N 局，記低每章嘅道館主通關率（條件機率：行到嗰章先計）。
   gen = 0 關都 / 1 城都 / 2 豐緣。三個世代嘅池、道館、TYPE_FOCUS 都唔同，
   所以每個世代要各自量一次（計劃書階段 3）。 */
function measure(diff, N, gen){
  const saveDiff = DIFF, saveGen = ACTIVE_GEN;
  DIFF = diff;
  /* ⚠ 一定要行 setGen()，唔可以直接寫 ACTIVE_GEN ——
     GYMS／ELITE4／CHAMPION／STARTERS／TYPE_FOCUS 都要跟住換。 */
  setGen(gen == null ? saveGen : gen);
  /* 換咗世代即係換咗成批寶可夢，命中率 cache 要清 */
  bumpEpoch();
  DIAG.e4Gold=[]; DIAG.e4Relics=[]; DIAG.e4Buys=[]; DIAG.e4Fell=[0,0,0,0,0];
  /* 章數跟返遊戲嘅 ACTS（八館改版之後係 8），唔好再寫死 4 */
  const reach = Array(ACTS).fill(0), clear = Array(ACTS).fill(0);
  /* 輸咗係輸喺館主度定係未見到館主就俾雜魚打死 —— 兩樣要分開睇先知調邊個掣：
     館主嗰場輸得多 = 嗰個館主本身太硬（例：階段 3 發現「無」系館主永遠唔會
     能量不足，一館就凹低成十幾點）；雜魚輸得多 = 成章嘅曲線太高。 */
  const bossFail = Array(ACTS).fill(0), mobFail = Array(ACTS).fill(0);
  const relicsAt = Array.from({length:ACTS}, ()=>[]);
  let gymAll = 0, e4Clear = 0;
  for(let k=0;k<N;k++){
    const run = newRun(draftParty());
    run.diff = diff;
    bumpEpoch();
    for(let act=1; act<=ACTS; act++){
      run.act = act;
      reach[act-1]++;
      const before = run.relics.length;
      const res = runAct(run);
      relicsAt[act-1].push(run.relics.length - before);
      if(!res.cleared){ (res.atBoss ? bossFail : mobFail)[act-1]++; break; }
      clear[act-1]++;
      if(act===ACTS){ run.stage='e4'; gymAll++; if(runE4(run)) e4Clear++; }
    }
  }
  const ranGen = ACTIVE_GEN;
  DIFF = saveDiff; setGen(saveGen); bumpEpoch();
  const pct = (a,b) => b ? Math.round(a/b*100) : 0;
  return {
    gen: ranGen, genName: genName(ranGen),
    reach, clear,
    clearRate: clear.map((c,i)=>pct(c, reach[i])),
    /* bossRate：見到館主嗰批局入面打得低嘅比率（＝館主本身有幾硬）
       mobDeath：連館主都未見到就死嘅比率（＝成章嘅雜魚曲線有幾高） */
    bossRate: clear.map((c,i)=>pct(c, c + bossFail[i])),
    mobDeath: mobFail.map((m,i)=>pct(m, reach[i])),
    bossFail, mobFail,
    relicPerAct: relicsAt.map(a=>a.length ? +(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2) : 0),
    /* 四天王：打低全部館主嘅局數入面，有幾多完成 4 連戰 + 冠軍 */
    e4Reach: gymAll, e4Clear, e4Rate: pct(e4Clear, gymAll),
    gymAll: pct(gymAll, N),          // 全部道館通關（未計四天王）
    fullClear: pct(e4Clear, N),      // 真・全通：連冠軍都打低
    e4Gold: avg(DIAG.e4Gold), e4Relics: avg(DIAG.e4Relics), e4Buys: avg(DIAG.e4Buys),
    e4Fell: DIAG.e4Fell.slice(),     // 喺第幾場（0-3 四天王、4 冠軍）陣亡
  };
}

return { measure, runAct, runE4, fight, draftParty, bumpEpoch };
})();
