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
console.log('章節   行到    打低    通關率   館主場勝率  未見館主就死  遺物/章');
res.clearRate.forEach((r,i)=>{
  console.log(`第 ${i+1} 館  ${String(res.reach[i]).padStart(5)}  ${String(res.clear[i]).padStart(5)}   ` +
              `${String(r+'%').padStart(5)}    ${String(res.bossRate[i]+'%').padStart(7)}` +
              `${String(res.mobDeath[i]+'%').padStart(12)}      ${res.relicPerAct[i]}`);
});
/* 通關率低嘅時候要分開睇：館主場勝率低 = 嗰個館主太硬（調 GEN_TUNE 嗰格），
   未見館主就死高 = 成章雜魚太強（調曲線 / ACT_TUNE） */
console.log(`\n四天王  ${String(res.e4Reach).padStart(5)}  ${String(res.e4Clear).padStart(5)}   ` +
            `${String(res.e4Rate+'%').padStart(5)}    （4 連戰 + 冠軍）`);
console.log(`\n${res.clearRate.length} 館全通：${res.gymAll}%　真・全通（連冠軍）：${res.fullClear}%`);
if(res.e4Reach){
  const lbl = ['天王1','天王2','天王3','天王4','冠軍'];
  console.log(`\n四天王入場：${res.e4Gold} 金・${res.e4Relics} 件遺物・平均買 ${res.e4Buys} 次補給`);
  console.log('陣亡位置：' + res.e4Fell.map((n,i)=>`${lbl[i]} ${n}`).join('　'));
}
/* 目標範圍（見 docs/八館改版計劃.md）。三個世代嘅困難都校完（階段 3）。 */
console.log(DIFF === 1
  ? '\n目標（魔鬼）：第 1-2 館 35-50 / 第 3-5 館 25-40 / 第 6-8 館 20-35 / 四天王 ≤50'
  : '\n目標（困難）：第 1-2 館 55-70 / 第 3-5 館 45-60 / 第 6-8 館 40-55 / 四天王 ≤50');
/* 現有魔鬼模式階段 5 會取消（變成 24 館通天塔），所以唔好再照住上面個範圍去調 */
if(DIFF === 1) console.log('⛔ 魔鬼模式階段 5 會取消（換成三個地區一次過打嘅 24 館通天塔）——\n' +
                           '   呢啲數睇下就算，唔好再花時間校（見 CLAUDE.md）。');
if(errors.length) console.log('\n⚠ 有錯誤：\n' + errors.slice(0,5).join('\n'));
