/* 共用啟動碼：開 headless 瀏覽器、載入 index.html、注入模擬器 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const GAME = 'file://' + path.join(ROOT, 'index.html');

/* Chromium 喺唔同機可能擺喺唔同位。順序：環境變數 → Playwright 自己搵 →
   /opt/pw-browsers 入面最新嗰個 */
export function findChrome(){
  if(process.env.CHROME && fs.existsSync(process.env.CHROME)) return process.env.CHROME;
  try{
    const p = chromium.executablePath();
    if(p && fs.existsSync(p)) return p;
  }catch(e){}
  const base = '/opt/pw-browsers';
  if(fs.existsSync(base)){
    const dirs = fs.readdirSync(base)
      .filter(d=>/^chromium-\d+$/.test(d))
      .sort((a,b)=>+b.split('-')[1] - +a.split('-')[1]);
    for(const d of dirs){
      const p = path.join(base, d, 'chrome-linux', 'chrome');
      if(fs.existsSync(p)) return p;
    }
  }
  return undefined;                       // 交返俾 Playwright 自己決定
}

export async function boot(){
  const executablePath = findChrome();
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    const t = m.text();
    if(m.type() === 'error' && !t.includes('ERR_TUNNEL')) errors.push('CONSOLE: ' + t.slice(0,200));
  });
  await page.goto(GAME);
  await page.waitForFunction(() => window.__plk && window.__plk.ready, null, { timeout: 30000 });
  await page.addScriptTag({ path: path.join(HERE, 'simlib.js') });
  return { browser, page, errors };
}
