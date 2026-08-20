/* 一次過試幾組數值，比較邊組啱 —— 唔使改 index.html 就試到。
   用法：N=800 node tools/sweep.mjs '[{...}, {...}]'

   每組設定可以有：
     curve   {gym:{hp1:1100}}     ★ 主力旋鈕：改敵人強度曲線嘅起點／終點
                                    每個 tier 得四個掣：hp0 hp1 nm0 nm1
                                    （第 1 章 / 第 8 章嘅血同傷，中間等比內插）
                                    gym 嘅 hp 係**成隊總血**，唔係單隻
     actTune {hp:[...8格...],nm:[...]}  覆蓋 index.html 嘅逐章微調（第 4 章嗰個進化跳升）
     dmg     {all:1.2}            喺曲線之上再乘嘅傷害倍率（可逐 tier：{mob:1.1, gym:1.3}）
     hp      {all:1.2}            同上，血量
     dmgAct  [1,1,1,1,1,1,1.2,1.3]  再按章節乘一次（八格，第 1-8 章）
     hpAct   [1,1,1,1,1,1,1.1,1.2]
     post    0.10                 每場勝利回幾多血（最大HP 百分比）
     e4heal  0.15                 四天王連戰之間回幾多血
     rest    0.35                 篝火回血
     badgeHeal 0.45               拎徽章回血
     badgeHp   20                 每個徽章 +最大HP
     diff0   {heal:0.9}           覆蓋「困難」難度嘅倍率
     diff1   {hp:[1,1,1.3,1.3]}   覆蓋「魔鬼」難度（hp/dmg 可以寫 8 格陣列逐章唔同）

   量魔鬼要開埋 DIFF=1：
     DIFF=1 N=2000 node tools/sweep.mjs '[{"diff1":{"hp":0.93}}]'

   例（試三條唔同斜度嘅曲線）：
     N=3000 node tools/sweep.mjs '[
       {},
       {"curve":{"gym":{"hp1":1100},"mob":{"hp1":330}}},
       {"curve":{"gym":{"hp1":1200},"mob":{"hp1":360}}}
     ]'
   空 object {} 就係 index.html 而家嘅數值。
   ⚠ 一次塞 6-8 組落去 —— 跑幾多局唔影響 AI 用量，淨係部電腦行耐幾十秒。
*/
import { boot } from './_boot.mjs';

const N = +(process.env.N || 800);
const configs = JSON.parse(process.argv[2] || '[{}]');

const { browser, page, errors } = await boot();

await page.evaluate(()=>{
  window.__ORIG = { curve:{},
    actTune: { hp: ACT_TUNE.hp.slice(), nm: ACT_TUNE.nm.slice() },
    post: POST_FIGHT_HEAL, rest: REST_HEAL, e4heal: E4_HEAL,
    badgeHeal: BADGE_HEAL, badgeHp: BADGE_HP,
    diff0: {...DIFFS[0]}, diff1: {...DIFFS[1]} };
  Object.keys(CURVE).forEach(k=>{ __ORIG.curve[k] = {...CURVE[k]}; });
  window.__applyTune = cfg=>{
    /* ① 先擺返原本嘅曲線同逐章微調，再蓋上今次要試嗰幾個掣，然後重新攤開逐章嘅表 */
    Object.keys(CURVE).forEach(k=>{
      Object.assign(CURVE[k], __ORIG.curve[k], (cfg.curve || {})[k] || {});
    });
    ACT_TUNE.hp = ((cfg.actTune || {}).hp || __ORIG.actTune.hp).slice();
    ACT_TUNE.nm = ((cfg.actTune || {}).nm || __ORIG.actTune.nm).slice();
    rebuildTiers();
    /* ② 曲線攤完之後先至乘倍率（所以 dmg/hp 係「喺曲線之上」再乘） */
    const perAct   = cfg.dmgAct || [];
    const perActHp = cfg.hpAct  || [];
    Object.keys(TIER).forEach(k=>{
      const dm = (cfg.dmg && (cfg.dmg[k] ?? cfg.dmg.all)) ?? 1;
      const hp = (cfg.hp  && (cfg.hp[k]  ?? cfg.hp.all))  ?? 1;
      TIER[k].nm = TIER[k].nm.map((v,i)=>+(v*dm*(perAct[i]??1)).toFixed(4));
      TIER[k].hp = TIER[k].hp.map((v,i)=>Math.round(v*hp*(perActHp[i]??1)));
    });
    /* ③ 直接寫死某個 tier 嘅陣列，用嚟單獨郁一章（八格）：
       {"set":{"gym":{"hp":[125,140,...]}}}　⚠ gym 呢度寫嘅係**單隻**血量 */
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
/* 八館改版之後嘅目標（見 docs/八館改版計劃.md 階段 2）：第 1-2 / 3-5 / 6-8 館 + 四天王 */
console.log(`每組 ${N} 局・難度 ${D===1?'魔鬼':'困難'}。目標：` +
  (D===1 ? '35-50 / 25-40 / 20-35 / 四天王 ≤50' : '55-70 / 45-60 / 40-55 / 四天王 ≤50') + '\n');
for(const cfg of configs){
  const res = await page.evaluate(([c,n,d])=>{ __applyTune(c); return __SIM.measure(d, n); }, [cfg, N, D]);
  console.log(JSON.stringify(cfg));
  console.log(`   通關率 ${JSON.stringify(res.clearRate)}　四天王 ${res.e4Rate}% (n=${res.e4Reach})` +
              `　全通 ${res.fullClear}%　遺物 ${JSON.stringify(res.relicPerAct)}　樣本 ${JSON.stringify(res.reach)}\n`);
}
if(errors.length) console.log('⚠ 有錯誤：\n' + errors.slice(0,5).join('\n'));
await browser.close();
