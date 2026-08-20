/* 一次過試幾組數值，比較邊組啱 —— 唔使改 index.html 就試到。
   用法：N=800 node tools/sweep.mjs '[{...}, {...}]'

   每組設定可以有：
     dmg     {all:1.2}            敵人傷害倍率（可以逐個 tier 寫：{mob:1.1, gym:1.3}）
     hp      {all:1.2}            敵人血量倍率
     dmgAct  [1, 1.2, 1.3, 1.5]   再按章節乘一次（第 1-4 章）
     hpAct   [1, 1.1, 1.2, 1.3]
     post    0.10                 每場勝利回幾多血（最大HP 百分比）
     e4heal  0.15                 四天王連戰之間回幾多血
     rest    0.35                 篝火回血
     badgeHeal 0.45               拎徽章回血
     badgeHp   20                 每個徽章 +最大HP
     diff0   {heal:0.9}           覆蓋「困難」難度嘅倍率

   例（試三組唔同嘅第 4 章強度）：
     N=800 node tools/sweep.mjs '[
       {"dmg":{"all":1.0}},
       {"dmg":{"all":1.0},"dmgAct":[1,1,1,1.1]},
       {"dmg":{"all":1.0},"dmgAct":[1,1,1,1.2]}
     ]'
   倍率 1.0 就係 index.html 而家嘅數值。
*/
import { boot } from './_boot.mjs';

const N = +(process.env.N || 800);
const configs = JSON.parse(process.argv[2] || '[{}]');

const { browser, page, errors } = await boot();

await page.evaluate(()=>{
  window.__ORIG = { nm:{}, hp:{},
    post: POST_FIGHT_HEAL, rest: REST_HEAL, e4heal: E4_HEAL,
    badgeHeal: BADGE_HEAL, badgeHp: BADGE_HP,
    diff0: {...DIFFS[0]} };
  ['mob','elite','gym','e4','champ'].forEach(k=>{
    __ORIG.nm[k] = TIER[k].nm.slice();
    __ORIG.hp[k] = TIER[k].hp.slice();
  });
  window.__applyTune = cfg=>{
    const perAct   = cfg.dmgAct || [1,1,1,1];
    const perActHp = cfg.hpAct  || [1,1,1,1];
    ['mob','elite','gym','e4','champ'].forEach(k=>{
      const dm = (cfg.dmg && (cfg.dmg[k] ?? cfg.dmg.all)) ?? 1;
      const hp = (cfg.hp  && (cfg.hp[k]  ?? cfg.hp.all))  ?? 1;
      TIER[k].nm = __ORIG.nm[k].map((v,i)=>+(v*dm*(perAct[i]??1)).toFixed(4));
      TIER[k].hp = __ORIG.hp[k].map((v,i)=>Math.round(v*hp*(perActHp[i]??1)));
    });
    /* 直接寫死某個 tier 嘅陣列，用嚟單獨郁一章：
       {"set":{"gym":{"nm":[1.48,2.2,2.45,2.79],"hp":[143,204,190,210]}}} */
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
    __SIM.bumpEpoch();
  };
});

console.log(`每組 ${N} 局。目標（困難）：35-50 / 30-45 / 30-45 / 30-45，遺物每章 2-3 件\n`);
for(const cfg of configs){
  const res = await page.evaluate(([c,n])=>{ __applyTune(c); return __SIM.measure(0, n); }, [cfg, N]);
  console.log(JSON.stringify(cfg));
  console.log(`   通關率 ${JSON.stringify(res.clearRate)}　四天王 ${res.e4Rate}% (n=${res.e4Reach})` +
              `　全通 ${res.fullClear}%　遺物 ${JSON.stringify(res.relicPerAct)}　樣本 ${JSON.stringify(res.reach)}\n`);
}
if(errors.length) console.log('⚠ 有錯誤：\n' + errors.slice(0,5).join('\n'));
await browser.close();
