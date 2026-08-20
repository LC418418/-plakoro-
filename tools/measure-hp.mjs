/* 量「每章開頭玩家出戰三隻嘅平均最大 HP」
   用法：node tools/measure-hp.mjs [局數] [難度]

   呢個數係 test-features.mjs 嘅 HP_AT 用嘅 —— 佢確保敵人最大一擊唔會大過玩家血量
   （唔係就變「一炮清枱」，玩家連反應機會都冇）。
   ⚠ 每次調完平衡（敵人強度、徽章加血、遺物）都要重新跑呢個，再更新 HP_AT。
*/
import { boot } from './_boot.mjs';

const N    = +(process.argv[2] || 400);
const DIFF = +(process.argv[3] || 0);

const { browser, page, errors } = await boot();
const rows = await page.evaluate(([n,d])=>{
  const sum = Array(ACTS).fill(0), cnt = Array(ACTS).fill(0);
  DIFF = d;                                     // 敵人數值跟難度，同 __SIM.measure 一樣
  for(let k=0;k<n;k++){
    const r = newRun(__SIM.draftParty());
    r.diff = d;
    __SIM.bumpEpoch();
    for(let act=1; act<=ACTS; act++){
      r.act = act;
      const live = activeParty(r);
      sum[act-1] += live.reduce((x,m)=>x+m.maxHp,0) / live.length;
      cnt[act-1]++;
      if(!__SIM.runAct(r).cleared) break;
    }
  }
  return sum.map((s,i)=>cnt[i] ? Math.round(s/cnt[i]) : 0);
}, [N, DIFF]);
await browser.close();

console.log(`\n難度：${DIFF===1?'魔鬼':'困難'}　局數：${N}`);
console.log('每章開頭出戰三隻嘅平均最大 HP：');
rows.forEach((v,i)=>console.log(`  第 ${i+1} 章  ${v}`));
console.log('\n貼落 tools/test-features.mjs 嘅 HP_AT：');
console.log(`const HP_AT = [${rows.join(', ')}];`);
if(errors.length) console.log('\n⚠ 有錯誤：\n' + errors.slice(0,5).join('\n'));
