#!/usr/bin/env python3
"""落 1-386 隻精靈圖，出 assets/dexspr-genN-v1.js。

用法：
    python3 tools/fetchdex.py            # 落圖 + 出三個 js
    python3 tools/fetchdex.py stat       # 淨係報大細，唔寫檔

⚠ 版本／來源嘅決定（同 docs/三世代改版計劃.md 講嘅有出入，見下）：

計劃書話用 `generation-iii/firered-leafgreen`，話佢「1-386 全齊」。
**實測係假嘅** —— 個資料夾只有 153 張（1-151 加 216、386），
152-385 全部 404。所以改用同一代嘅 **emerald**：385/386 齊，
剩返呆火駝（322）一隻由 ruby-sapphire 補（同一代同一班美術，肉眼分唔出）。
兩者都係第三代 GBA 嘅圖，決定 4 要嘅「三個世代美術完全一致」照樣做到。

⚠ 唔縮圖、唔裁邊，照用原生 64×64：
  - 縮到 40×40 係 0.625 倍非整數比例，pixel art 一定糊；
  - 裁走透明邊會搞亂相對大細 —— 畫面用緊 `object-fit:contain`，
    裁咗之後綠毛蟲同烈空坐會顯示到一樣大。
  - 而且原檔係 16 色 index PNG，一張得 ~700 bytes，
    **仲細過**而家用緊嗰批 40×40（~1,400 bytes）。冇理由縮。
"""
import base64, io, json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

ROOT  = os.path.join(os.path.dirname(__file__), '..')
CACHE = os.path.join(os.path.dirname(__file__), '.cache', 'spr')
SRC   = ('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites'
         '/pokemon/versions/generation-iii')
GENS  = [(1, 1, 151), (2, 152, 251), (3, 252, 386)]
FALLBACK = {322: 'ruby-sapphire'}          # emerald 冇呆火駝


def fetch(n):
    fn = os.path.join(CACHE, f'{n}.png')
    if os.path.exists(fn):
        return fn
    ver = FALLBACK.get(n, 'emerald')
    req = urllib.request.Request(f'{SRC}/{ver}/{n}.png',
                                 headers={'User-Agent': 'poketower-fetchdex'})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
    os.makedirs(CACHE, exist_ok=True)
    with open(fn, 'wb') as f:
        f.write(raw)
    return fn


def squeeze(fn):
    """重新存一次，慳返 PokeAPI 原檔啲用唔著嘅 chunk。

    保持 RGBA 唔轉 palette：轉 P 模式會丟埋半透明嘅邊，
    而 PNG 本身已經識得將少過 256 色嘅圖壓得好好。
    """
    im = Image.open(fn).convert('RGBA')
    buf = io.BytesIO()
    im.save(buf, 'PNG', optimize=True)
    return min(buf.getvalue(), open(fn, 'rb').read(), key=len)


def main(stat_only=False):
    with ThreadPoolExecutor(max_workers=16) as ex:
        list(ex.map(fetch, range(1, 387)))

    total = 0
    for g, lo, hi in GENS:
        d = {str(n): base64.b64encode(squeeze(fetch(n))).decode() for n in range(lo, hi + 1)}
        js = ('/* 圖鑑精靈圖（第 %d 世代 %d-%d，第三代 GBA 版）。逐隻 64×64 PNG base64。\n'
              '   點解唔拆做真檔案：呢度幾百個索引，拆開就係幾百個 request。\n'
              '   點解逐個世代分檔：開機只需要一個世代，其餘兩個等圖鑑撳開先落。\n'
              '   ⚠ 唔用 `const DEXSPR` —— 三個檔要疊埋落同一個 object，\n'
              '   而且係唔同時間先載到，所以掛喺 window 度慢慢儲。 */\n'
              'window.DEXSPR = Object.assign(window.DEXSPR || {}, %s);\n'
              % (g, lo, hi, json.dumps(d, separators=(',', ':'))))
        out = os.path.join(ROOT, 'assets', f'dexspr-gen{g}-v1.js')
        total += len(js)
        print(f'gen{g}  {hi-lo+1:3} 隻  {len(js)/1024:6.1f} KB  {out}')
        if not stat_only:
            with open(out, 'w', encoding='utf-8') as f:
                f.write(js)
    print(f'合計 {total/1024:.1f} KB（而家嘅 dexspr-v1.js 係 '
          f'{os.path.getsize(os.path.join(ROOT, "assets", "dexspr-v1.js"))/1024:.1f} KB／151 隻）')


if __name__ == '__main__':
    main(stat_only=len(sys.argv) > 1 and sys.argv[1] == 'stat')
