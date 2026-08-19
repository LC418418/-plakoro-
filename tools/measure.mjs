/* 量度爬塔通關率
   用法：node tools/measure.mjs [局數] [難度]
     局數 預設 1200（越大越準，但唔會用多咗 AI usage，淨係行耐啲）
     難度 0 = 困難（預設）、1 = 魔鬼
   例：node tools/measure.mjs 1400 0
*/
import { boot } from './_boot.mjs';

const N    = +(process.argv[2] || 1200);
const DIFF = +(process.argv[3] || 0);

const { browser, page, errors } = await boot();
const t0 = Date.now();
const res = await page.evaluate(([n,d]) => __SIM.measure(d, n), [N, DIFF]);
await browser.close();

const name = DIFF === 1 ? '魔鬼' : '困難';
console.log(`\n難度：${name}　局數：${N}　用時：${((Date.now()-t0)/1000).toFixed(0)}s\n`);
console.log('章節   行到    打低    通關率   遺物/章');
res.clearRate.forEach((r,i)=>{
  console.log(`第 ${i+1} 館  ${String(res.reach[i]).padStart(5)}  ${String(res.clear[i]).padStart(5)}   ` +
              `${String(r+'%').padStart(5)}    ${res.relicPerAct[i]}`);
});
console.log(`\n四天王  ${String(res.e4Reach).padStart(5)}  ${String(res.e4Clear).padStart(5)}   ` +
            `${String(res.e4Rate+'%').padStart(5)}    （4 連戰 + 冠軍）`);
console.log(`\n四館全通：${res.gymAll}%　真・全通（連冠軍）：${res.fullClear}%`);
console.log(DIFF === 1
  ? '\n目標（魔鬼）：25-40 / 20-35 / 20-35 / 20-35 / 四天王 15-30；遺物每章 2-3 件'
  : '\n目標（困難）：35-50 / 30-45 / 30-45 / 30-45 / 四天王 25-40；遺物每章 2-3 件');
if(errors.length) console.log('\n⚠ 有錯誤：\n' + errors.slice(0,5).join('\n'));
