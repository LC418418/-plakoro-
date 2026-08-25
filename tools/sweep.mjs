/* 一次過試幾組數值，比較邊組啱 —— 唔使改 index.html 就試到。
   用法：N=800 node tools/sweep.mjs '[{...}, {...}]'

   每組設定可以有：
     curve   {gym:{hp1:1300}}     敵人強度曲線嘅端點（hp0/hp1/nm0/nm1），**調平衡行呢個**
     actTune {hp:[…8 格…]}        逐章微調旋鈕（ACT_TUNE），dmg 同樣寫法
     dmg     {all:1.2}            敵人傷害倍率（可以逐個 tier 寫：{mob:1.1, gym:1.3}）
     hp      {all:1.2}            敵人血量倍率
     dmgAct  [1, 1.2, …]          再按章節乘一次（ACTS 格）
     hpAct   [1, 1.1, …]
     post    0.10                 每場勝利回幾多血（最大HP 百分比）
     e4heal  0.15                 四天王連戰之間回幾多血
     rest    0.35                 篝火回血
     badgeHeal 0.45               拎徽章回血
     badgeHp   10                 每個徽章 +最大HP
     diff0   {heal:0.9}           覆蓋「困難」難度嘅倍率
     diff1   {hp:[1,1,1.3,…]}     覆蓋「魔鬼」難度（hp/dmg 可以寫 ACTS 格陣列逐章唔同）

   ⚠ curve 嘅 gym.hp0 / gym.hp1 係**成隊道館主嘅總血量**，唔係單隻 ——
     單隻血由遊戲自己除返嗰章帶幾多隻。

   量城都／豐緣要開埋 GEN（0 關都・預設、1 城都、2 豐緣）：
     GEN=1 N=3000 node tools/sweep.mjs '[{}]'

   量魔鬼要開埋 DIFF=1：
     DIFF=1 N=6000 node tools/sweep.mjs '[{"diff1":{"hp":[0.93,0.93,0.93,0.93,1,1.02,1.04,1.06]}}]'

   例（試三組唔同嘅第 4 章強度 —— 郁 ACT_TUNE，唔好再寫死數字表）：
     N=3000 node tools/sweep.mjs '[
       {},
       {"actTune":{"hp":[0.92,1,1.08,1.20,1.12,1.06,1,0.94]}},
       {"actTune":{"hp":[0.92,1,1.08,1.32,1.12,1.06,1,0.94]}}
     ]'
   `{}`（乜都唔寫）就係 index.html 而家嘅數值。
*/
import { boot } from './_boot.mjs';

const N = +(process.env.N || 800);
const configs = JSON.parse(process.argv[2] || '[{}]');

const { browser, page, errors } = await boot();

await page.evaluate(()=>{
  window.__TIERS = ['mob','elite','gym','e4','champ'];
  window.__ORIG = { curve:{},
    actTune: { hp: ACT_TUNE.hp.slice(), dmg: ACT_TUNE.dmg.slice() },
    post: POST_FIGHT_HEAL, rest: REST_HEAL, e4heal: E4_HEAL,
    badgeHeal: BADGE_HEAL, badgeHp: BADGE_HP,
    diff0: {...DIFFS[0]}, diff1: {...DIFFS[1]} };
  __TIERS.forEach(k=>{
    const T = TIER[k];
    __ORIG.curve[k] = { hp0:T.hp0, hp1:T.hp1, nm0:T.nm0, nm1:T.nm1 };
  });
  window.__applyTune = cfg=>{
    /* 先返返 index.html 嘅曲線 + ACT_TUNE，再叫遊戲自己重新生成逐章嘅數字，
       之後先至喺上面乘倍率 —— 咁每組設定都係由同一個起點度出發 */
    __TIERS.forEach(k=>Object.assign(TIER[k], __ORIG.curve[k], (cfg.curve||{})[k] || {}));
    ACT_TUNE = {
      hp:  ((cfg.actTune||{}).hp  || __ORIG.actTune.hp ).slice(),
      dmg: ((cfg.actTune||{}).dmg || __ORIG.actTune.dmg).slice(),
    };
    buildTiers();

    const perAct   = cfg.dmgAct || [];
    const perActHp = cfg.hpAct  || [];
    __TIERS.forEach(k=>{
      const dm = (cfg.dmg && (cfg.dmg[k] ?? cfg.dmg.all)) ?? 1;
      const hp = (cfg.hp  && (cfg.hp[k]  ?? cfg.hp.all))  ?? 1;
      TIER[k].nm = TIER[k].nm.map((v,i)=>+(v*dm*(perAct[i]??1)).toFixed(4));
      TIER[k].hp = TIER[k].hp.map((v,i)=>Math.round(v*hp*(perActHp[i]??1)));
    });
    /* 直接寫死某個 tier 嘅陣列，用嚟單獨郁一章（gym 嘅 hp 係成隊總血量）：
       {"set":{"gym":{"nm":[…8 格…],"hp":[…8 格…]}}} */
    Object.entries(cfg.set || {}).forEach(([k,v])=>{
      if(v.nm) TIER[k].nm = v.nm.slice();
      if(v.hp) TIER[k].hp = v.hp.slice();
    });
    POST_FIGHT_HEAL = cfg.post      ?? __ORIG.post;
    E4_HEAL         = cfg.e4heal    ?? __ORIG.e4heal;
    REST_HEAL       = cfg.rest      ?? __ORIG.rest;
    BADGE_HEAL      = cfg.badgeHeal ?? __ORIG.badgeHeal;
    BADGE_HP        = cfg.badgeHp   ?? __ORIG.badgeHp;
    Object.assign(DIFFS[0], __ORIG.diff0, cfg.diff0 || {});
    Object.assign(DIFFS[1], __ORIG.diff1, cfg.diff1 || {});
    __SIM.bumpEpoch();
  };
});

const D = +(process.env.DIFF || 0);
const G = +(process.env.GEN  || 0);
/* 八館嘅目標（見 docs/八館改版計劃.md 階段 2）：第 1-2 館 / 第 3-5 館 / 第 6-8 館 */
console.log(`每組 ${N} 局・難度 ${D===1?'魔鬼':'困難'}・世代 ${G}。目標：` +
  (D===1 ? '35-50 ×2 / 25-40 ×3 / 20-35 ×3' : '55-70 ×2 / 45-60 ×3 / 40-55 ×3') + '\n');
for(const cfg of configs){
  const res = await page.evaluate(([c,n,d,g])=>{ __applyTune(c); return __SIM.measure(d, n, g); }, [cfg, N, D, G]);
  console.log(res.genName + '　' + JSON.stringify(cfg));
  console.log(`   通關率 ${JSON.stringify(res.clearRate)}　四天王 ${res.e4Rate}% (n=${res.e4Reach})` +
              `　全通 ${res.fullClear}%　遺物 ${JSON.stringify(res.relicPerAct)}　樣本 ${JSON.stringify(res.reach)}\n`);
}
if(errors.length) console.log('⚠ 有錯誤：\n' + errors.slice(0,5).join('\n'));
await browser.close();
