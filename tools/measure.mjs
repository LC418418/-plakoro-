/* 量度爬塔通關率
   用法：node tools/measure.mjs [局數] [難度] [世代]
     局數 預設 1200（越大越準，但唔會用多咗 AI usage，淨係行耐啲）
     難度 0 = 困難（預設）、1 = 魔鬼
     世代 0 = 關都（預設）、1 = 城都、2 = 豐緣
   例：node tools/measure.mjs 3000 0 1     ← 城都・困難
*/
import { boot } from './_boot.mjs';

const N    = +(process.argv[2] || 1200);
const DIFF = +(process.argv[3] || 0);
const GEN  = +(process.argv[4] || 0);

const { browser, page, errors } = await boot();
const t0 = Date.now();
const res = await page.evaluate(([n,d,g]) => __SIM.measure(d, n, g), [N, DIFF, GEN]);
await browser.close();

const name = DIFF === 1 ? '魔鬼' : '困難';
console.log(`\n世代：${res.genName}　難度：${name}　局數：${N}　用時：${((Date.now()-t0)/1000).toFixed(0)}s\n`);
console.log('章節   行到    打低    通關率   遺物/章');
res.clearRate.forEach((r,i)=>{
  console.log(`第 ${i+1} 館  ${String(res.reach[i]).padStart(5)}  ${String(res.clear[i]).padStart(5)}   ` +
              `${String(r+'%').padStart(5)}    ${res.relicPerAct[i]}`);
});
console.log(`\n四天王  ${String(res.e4Reach).padStart(5)}  ${String(res.e4Clear).padStart(5)}   ` +
            `${String(res.e4Rate+'%').padStart(5)}    （4 連戰 + 冠軍）`);
console.log(`\n${res.clearRate.length} 館全通：${res.gymAll}%　真・全通（連冠軍）：${res.fullClear}%`);
if(res.e4Reach){
  const lbl = ['天王1','天王2','天王3','天王4','冠軍'];
  console.log(`\n四天王入場：${res.e4Gold} 金・${res.e4Relics} 件遺物・平均買 ${res.e4Buys} 次補給`);
  console.log('陣亡位置：' + res.e4Fell.map((n,i)=>`${lbl[i]} ${n}`).join('　'));
}
/* 目標範圍（見 docs/八館改版計劃.md）。
   ⚠ 城都豐緣仲未校過平衡（三世代改版計劃嘅階段 3 先做），
     所以嗰兩個世代啲數唔會入到呢個範圍，正常。 */
console.log(DIFF === 1
  ? '\n目標（魔鬼）：第 1-2 館 35-50 / 第 3-5 館 25-40 / 第 6-8 館 20-35 / 四天王 ≤50'
  : '\n目標（困難）：第 1-2 館 55-70 / 第 3-5 館 45-60 / 第 6-8 館 40-55 / 四天王 ≤50');
if(GEN !== 0) console.log('⚠ ' + res.genName + ' 仲未校平衡（階段 3 先做），啲數歪咗係預期之內。');
if(errors.length) console.log('\n⚠ 有錯誤：\n' + errors.slice(0,5).join('\n'));
