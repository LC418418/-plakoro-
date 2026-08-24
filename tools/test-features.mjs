/* 驗證新加嘅四樣嘢喺真畫面度行得通：
     1. 遺物上限 —— 滿咗會彈「揀掉邊件」，換完數目唔會超額，效果會回收
     2. 特訓     —— 進化唔到嘅寶可夢夠場數會彈特訓選擇
     3. 四天王補給 —— 買得起就撳得，扣錢、回血、價錢升級
     4. 傷害尾巴 —— 敵人最大一擊唔會再超過玩家血量

   用法：node tools/test-features.mjs
*/
import { boot } from './_boot.mjs';

const { browser, page, errors } = await boot();
const out = [];
const t = (name, ok, extra='') => { out.push([ok, name, extra]); };

/* ---------- 1. 遺物上限 ---------- */
const relic = await page.evaluate(()=>{
  const run = newRun(__SIM.draftParty());
  R.run = run;
  const pool = ALL_RELICS.slice(0, RELIC_MAX + 1);
  pool.slice(0, RELIC_MAX).forEach(r=>addRelic(run, r));
  const hpBefore = run.party[0].maxHp;
  const capped = run.relics.length;

  /* 滿咗 → 應該彈個 sheet 出嚟，數目暫時唔變 */
  let afterCalled = 0;
  gainRelic(run, pool[RELIC_MAX], ()=>afterCalled++);
  const sheetUp = !!document.querySelector('#sheetIn [data-drop]');
  const stillCapped = run.relics.length;

  /* 撳第一個「掉呢件」 */
  const gone = run.relics[0].id;
  document.querySelector('#sheetIn [data-drop]').click();
  const swapped = run.relics.length;
  const droppedGone = !run.relics.some(r=>r.id === gone);
  const gotNew = run.relics.some(r=>r.id === pool[RELIC_MAX].id);

  /* 加血遺物嘅 maxHp 要跟住加減，唔可以留低 */
  const hpRelic = ALL_RELICS.find(r=>r.on && r.on.maxHp);
  const hp0 = run.party[0].maxHp;
  addRelic(run, hpRelic); const hp1 = run.party[0].maxHp;
  dropRelic(run, run.relics.length-1); const hp2 = run.party[0].maxHp;

  return { capped, sheetUp, stillCapped, swapped, droppedGone, gotNew, afterCalled,
           hpBefore, hpDelta: hp1-hp0, hpBack: hp2===hp0, maxHpGain: hpRelic.on.maxHp };
});
t('遺物加到上限', relic.capped === 8, `${relic.capped} 件`);
t('滿咗彈揀掉邊件', relic.sheetUp && relic.stillCapped === 8);
t('揀完照樣係上限', relic.swapped === 8);
t('舊嗰件真係走咗', relic.droppedGone);
t('新嗰件真係入咗袋', relic.gotNew);
t('揀完先行 after', relic.afterCalled === 1, `行咗 ${relic.afterCalled} 次`);
t('加血遺物即時生效', relic.hpDelta === relic.maxHpGain, `+${relic.hpDelta}`);
t('掉咗會回收返血', relic.hpBack);

/* ---------- 2. 特訓 ---------- */
const train = await page.evaluate(()=>{
  const run = newRun(__SIM.draftParty());
  R.run = run;
  /* 129 鯉魚王進化到，132 百變怪進化唔到 */
  const noEvo = [...Array(151).keys()].map(i=>i+1).find(n=>isBasic(n) && !nextEvo(n));
  const mon = run.party[0];
  mon.dex = noEvo;
  mon.spec = {...mon.spec, dex:noEvo, name:DEX[noEvo].name};
  mon.wins = EVO_WINS[0]; mon.evoStage = 0;

  const list = pendingEvolutions(run);
  const isTrain = list.length === 1 && list[0].to === null;

  const hp0 = mon.maxHp, dmg0 = mon.deck.find(m=>m.dmg!=null);
  let done = false;
  runEvolutions(()=>{ done = true; });
  const sheetUp = !!document.querySelector('#sheetIn [data-tr]');
  document.querySelector('#sheetIn [data-tr="hp"]').click();

  return { noEvo, name:DEX[noEvo].name, isTrain, sheetUp, done,
           hpGain: mon.maxHp - hp0, stage: mon.evoStage,
           again: pendingEvolutions(run).length };
});
t('進化唔到嘅會排隊特訓', train.isTrain, `${train.name}（#${train.noEvo}）`);
t('特訓彈得出揀嘅畫面', train.sheetUp);
t('揀體質真係加血', train.hpGain === 50, `+${train.hpGain}`);
t('特訓計埋階級、唔會無限特訓', train.stage === 1 && train.again === 0);
t('特訓完會行返 after', train.done);

/* ---------- 3. 四天王補給 ---------- */
const e4 = await page.evaluate(()=>{
  const run = newRun(__SIM.draftParty());
  R.run = run; run.act = ACTS; run.stage='e4'; run.e4 = 0; run.e4Heals = 0;
  run.gold = 5000;
  run.party.forEach(m=>{ m.hp = Math.round(m.maxHp*0.3); });
  const hp0 = run.party[0].hp;

  startE4();
  const btn = document.querySelector('#e4heal');
  const cost0 = e4HealCost(run);
  const enabled = btn && !btn.disabled;
  btn.click();
  const hp1 = run.party[0].hp;
  const spent = 5000 - run.gold;
  const cost1 = e4HealCost(run);

  /* 冇錢就要撳唔到 */
  run.gold = 0; startE4();
  const broke = document.querySelector('#e4heal').disabled;
  /* 滿血都要撳唔到 */
  run.gold = 5000; run.party.forEach(m=>{ m.hp = m.maxHp; }); startE4();
  const full = document.querySelector('#e4heal').disabled;
  sheetClose();

  return { enabled, cost0, cost1, spent, healed: hp1-hp0,
           want: Math.round(run.party[0].maxHp*E4_BUY_HEAL), broke, full,
           heals: run.e4Heals };
});
t('四天王有補給掣、買得起撳得', e4.enabled, `${e4.cost0} 金`);
t('補給扣返啱錢', e4.spent === e4.cost0, `扣咗 ${e4.spent}`);
t('補給真係回血', e4.healed > 0, `+${e4.healed} HP`);
t('用完價錢會升', e4.cost1 > e4.cost0, `${e4.cost0} → ${e4.cost1}`);
t('冇錢撳唔到', e4.broke);
t('滿血撳唔到', e4.full);

/* 存檔要記得買咗幾多次 */
const persist = await page.evaluate(()=>{
  const run = newRun(__SIM.draftParty());
  run.stage='e4'; run.e4 = 2; run.e4Heals = 3;
  const back = deserializeRun(serializeRun(run));
  return { e4: back.e4, heals: back.e4Heals, stage: back.stage };
});
t('存檔記得四天王進度', persist.e4 === 2 && persist.stage === 'e4');
t('存檔記得買過幾多次補給', persist.heals === 3, `${persist.heals} 次`);

/* ---------- 4. 傷害尾巴 ---------- */
const dmg = await page.evaluate(()=>{
  const rows = [];
  const acts = Array.from({length:ACTS}, (_,i)=>i);
  ['gym','e4','champ'].forEach(tier=>{
    acts.forEach(a=>{
      if(tier!=='gym' && a) return;
      let worst = 0;
      for(let k=0;k<400;k++){
        const m = genMon(1+Math.floor(Math.random()*151), tier, a);
        m.deck.forEach(mv=>{
          const add = ((mv.faces[0].ops.find(o=>o.t==='add')||{}).v)||0;
          worst = Math.max(worst, (mv.dmg||0) + add);
        });
      }
      rows.push({ tier, act:a+1, worst });
    });
  });
  return rows;
});
/* 每章開頭玩家出戰三隻嘅平均最大 HP（八章制，用模擬器跑 400 局量返嚟）。
   一擊唔可以大過呢個數 —— 唔係就會變成「一炮清枱」，玩家連反應機會都冇。
   平衡改完（階段 2）記得重新量過呢一行。 */
const HP_AT = [120, 143, 183, 223, 252, 274, 298, 317];
dmg.forEach(r=>{
  const hp = HP_AT[r.tier==='gym' ? r.act-1 : HP_AT.length-1];
  t(`${r.tier} 第 ${r.act} 章最大一擊 ${r.worst} < 血量 ${hp}`, r.worst < hp);
});

/* ---------- 5. 道具袋 ---------- */
const bag = await page.evaluate(()=>{
  const run = newRun(__SIM.draftParty());
  R.run = run;
  /* 三款道具都要有得攞：寶箱 + 商店 */
  const ids = ['potion','revive','skill'];
  const inChest = ids.filter(id=>CHEST_LOOT.some(l=>l.id===id)).length;
  openShop();
  const inShop = R.shop.filter(it=>it.kind==='item').length;

  giveItem(run,'potion',1); giveItem(run,'revive',1); giveItem(run,'skill',1);
  const n0 = itemCount(run);
  const saved = itemCount(deserializeRun(serializeRun(run)));   // 存檔記唔記得

  /* 厲害傷藥：活住嘅回 50%，倒下嘅唔會就咁翻生（嗰個係復活藥丸嘅工作） */
  run.party.forEach(m=>{ m.hp = Math.round(m.maxHp*0.2); });
  run.party[2].hp = 0;
  const hp0 = run.party[0].hp, want = hp0 + Math.round(run.party[0].maxHp*ITEM_HEAL);
  openItems();
  document.querySelector('#sheetIn [data-it="potion"]').click();
  const healed = run.party[0].hp, deadStill = run.party[2].hp, potionLeft = run.items.potion|0;

  /* 復活藥丸：要揀邊隻，揀完先復活 */
  document.querySelector('#sheetIn [data-it="revive"]').click();
  const rvPick = !!document.querySelector('#sheetIn [data-rv]');
  document.querySelector('#sheetIn [data-rv]').click();
  const revived = run.party[2].hp, reviveWant = Math.round(run.party[2].maxHp*ITEM_REVIVE_HP);

  /* 技能升級器：揀一個招式升一級 */
  const plus0 = run.party[0].deck[0].plus|0;
  document.querySelector('#sheetIn [data-it="skill"]').click();
  const upPick = !!document.querySelector('#sheetIn [data-up]');
  document.querySelector('#sheetIn [data-up]').click();
  const plus1 = run.party[0].deck[0].plus|0;

  /* 用完就冇，撳極都唔會再有效果 */
  const left = itemCount(run);
  sheetClose();
  return { inChest, inShop, n0, saved, healed, want, deadStill, potionLeft,
           rvPick, revived, reviveWant, upPick, plus0, plus1, left };
});
t('三款道具寶箱派得到', bag.inChest === 3, `${bag.inChest}/3 款`);
t('三款道具商店買得到', bag.inShop === 3, `${bag.inShop}/3 款`);
t('存檔記得道具', bag.saved === bag.n0, `${bag.saved}/${bag.n0} 件`);
t('厲害傷藥回 50%', bag.healed === bag.want, `${bag.healed} HP`);
t('厲害傷藥唔會令倒下嘅翻生', bag.deadStill === 0);
t('用完會扣數', bag.potionLeft === 0 && bag.left === 0);
t('復活藥丸要揀邊隻', bag.rvPick);
t('復活藥丸真係復活', bag.revived === bag.reviveWant, `${bag.revived} HP`);
t('技能升級器揀得招式', bag.upPick);
t('技能升級器真係升一級', bag.plus1 === bag.plus0 + 1, `+${bag.plus1}`);

/* ---------- 6. 打低對手一隻 → 免費換人 ---------- */
const fdown = await page.evaluate(async ()=>{
  const run = newRun(__SIM.draftParty());
  R.run = run; run.act = 1; run.map = genMap(1);
  run.swapTokens = 2;
  startRogueBattle('boss');                 // 道館主一定唔止一隻
  const g = R.g;
  const foeN = g.sides[1].party.length;
  const turnNo0 = g.turnNo, turn0 = g.turn, act0 = g.sides[0].active;

  R.foeDown = true;
  const wait = offerFoeDownSwitch();
  const sheetUp = !!document.querySelector('#sheetIn [data-sw]');
  document.querySelector('#sheetIn [data-sw]').click();
  await wait;
  const after = { active:g.sides[0].active, turnNo:g.turnNo, turn:g.turn, tok:run.swapTokens };

  /* 冇隊友換得（其餘全部倒下）就唔應該彈 */
  run.party.forEach((m,i)=>{ if(i!==g.sides[0].active) m.hp = 0; });
  R.foeDown = true;
  const none = await offerFoeDownSwitch();
  return { foeN, sheetUp, switched: after.active !== act0,
           freeTurn: after.turnNo === turnNo0 && after.turn === turn0,
           tokKept: after.tok === 2, flagCleared: R.foeDown === false, none };
});
t('道館主隊伍多過一隻', fdown.foeN > 1, `${fdown.foeN} 隻`);
t('打低一隻之後彈換人', fdown.sheetUp);
t('揀咗真係換人', fdown.switched);
t('免費換人唔消耗回合', fdown.freeTurn);
t('免費換人唔食交換球', fdown.tokKept);
t('彈完會清返個旗標', fdown.flagCleared);
t('冇人換得就唔會彈', fdown.none === false);

/* ---------- 7. 四天王之間換人 / 用道具 ---------- */
const e4sw = await page.evaluate(()=>{
  const run = newRun(__SIM.draftParty());
  R.run = run; run.act = ACTS; run.stage='e4'; run.e4 = 1; run.gold = 0;
  run.party.push(JSON.parse(JSON.stringify(run.party[0])));   // 一隻後備
  run.party[0].hp = 0;                                        // 出戰有一隻已經陣亡
  startE4();
  const hasParty = !!document.querySelector('#e4party');
  const hasItems = !!document.querySelector('#e4items');
  document.querySelector('#e4party').click();
  const mgrUp = !!document.querySelector('#sheetIn .pcardm');
  /* 撳倒下嗰隻、再撳後備 → 換位 */
  document.querySelectorAll('#sheetIn .pcardm')[0].click();
  document.querySelectorAll('#sheetIn .pcardm')[3].click();
  const swapped = run.party[0].hp > 0 && run.party[3].hp === 0;
  document.querySelector('#pmClose').click();
  const backToE4 = !!document.querySelector('#e4go');
  sheetClose();
  return { hasParty, hasItems, mgrUp, swapped, backToE4 };
});
t('四天王開戰前有「換人上陣」', e4sw.hasParty);
t('四天王開戰前有道具袋', e4sw.hasItems);
t('撳得開隊伍管理', e4sw.mgrUp);
t('後備真係換得上正選', e4sw.swapped);
t('閂咗隊伍會彈返開戰嗰張紙', e4sw.backToE4);

/* ---------- 埋數 ---------- */
console.log('');
out.forEach(([ok,name,extra])=>console.log(`${ok?'✅':'❌'} ${name}${extra?'　'+extra:''}`));
const bad = out.filter(r=>!r[0]).length;
console.log(`\n${out.length - bad}/${out.length} 過關`);
if(errors.length) console.log('\n⚠ 頁面錯誤：\n' + errors.slice(0,8).join('\n'));
await browser.close();
process.exit(bad || errors.length ? 1 : 0);
