#!/usr/bin/env python3
"""把上載嘅像素畫圖示轉成可以直接嵌入 index.html 嘅 data URI。

手機上載出嚟嘅係 JPEG，冇真正嘅透明度 —— 「透明」係被畫成灰白棋盤格燒死咗入去。
呢個腳本還原返 alpha，再縮成細細粒嘅 PNG。

點做：
  1. 由畫面四邊（一定係背景）度返棋盤嗰兩隻灰白色
  2. 由四邊灌水，行得過嘅係「似棋盤色」同「JPEG 光暈」（灰、唔夠深）嘅像素，
     遇到圖示嘅深色描邊就停 —— 灌到嘅就係背景
     （唔靠棋盤格嘅網格，因為唔同工具出嘅圖格大細唔同，仲會有次像素漂移）
  3. 圖示內部真係穿窿嘅位（獎盃耳仔、購物車格）：驗「隔一格就轉色」嘅交替特徵，
     所以白色刀身、米白骷髏臉呢啲淨色位唔會俾人穿窿
  4. 縮到原生解像度、掃走雜點、裁走透明邊、減色壓縮

⚠ 圖示要有一圈完整嘅深色描邊包住，第 2 步先分得開圖示同背景。

用法：
    python3 tools/pixicon.py 圖片.jpeg --name rest --preview /tmp/p.png
    python3 tools/pixicon.py 圖片.jpeg --name chest --native 48    # 細節多就要開大啲
"""
import argparse, base64, io, sys
from PIL import Image
import numpy as np

LUM = [.299, .587, .114]


def two_colours(a, m=34):
    """棋盤嗰兩隻色：喺四邊嘅像素度做 1-D k-means。"""
    H, W, _ = a.shape
    e = np.zeros((H, W), bool)
    e[:m, :] = e[-m:, :] = e[:, :m] = e[:, -m:] = True
    lu, px = (a @ LUM)[e], a[e]
    t = (lu.min() + lu.max()) / 2
    for _ in range(20):
        lo, hi = lu[lu < t], lu[lu >= t]
        if not len(lo) or not len(hi):
            break
        t = (lo.mean() + hi.mean()) / 2
    return np.median(px[lu < t], axis=0), np.median(px[lu >= t], axis=0)


def cell_size(a):
    """量棋盤格闊：對四邊嘅掃描線做 FFT 攞主週期（一個週期＝兩格）。
    只要週期唔要相位，所以就算張圖被縮放到格位有次像素漂移都照準。"""
    H, W, _ = a.shape
    L = a @ LUM
    sp = np.zeros(W//2 + 1)
    for line in (L[3], L[8], L[H-4], L[H-9], L[:, 3], L[:, 8], L[:, W-4], L[:, W-9]):
        d = line - line.mean()
        sp += np.abs(np.fft.rfft(d * np.hanning(len(d))))**2
    lo, hi = max(2, W//200), W//8
    k = lo + int(np.argmax(sp[lo:hi]))
    y0, y1, y2 = sp[k-1], sp[k], sp[k+1]
    d = 0.5*(y0-y2) / (y0 - 2*y1 + y2 + 1e-9)
    return W / (k + d) / 2


def _grow(seed, mask, limit=4000):
    """喺 mask 入面由 seed 灌水（純 numpy，唔使 scipy）。"""
    cur = seed & mask
    for _ in range(limit):
        nxt = cur.copy()
        nxt[1:, :] |= cur[:-1, :]
        nxt[:-1, :] |= cur[1:, :]
        nxt[:, 1:] |= cur[:, :-1]
        nxt[:, :-1] |= cur[:, 1:]
        nxt &= mask
        if nxt.sum() == cur.sum():
            return nxt
        cur = nxt
    return cur


def alpha(a, tol=22):
    """→ (外圍背景遮罩, 全部似棋盤色嘅像素, 棋盤交替訊號, 深色, 淺色)

    內部真係穿窿嘅位（獎盃耳仔、購物車格）唔可以靠「兩隻棋盤色都齊」嚟認 ——
    白色刀身配淺灰陰影一樣兩隻色都齊，會連刀身都當成窿。真正嘅分別係
    「棋盤會每隔一格就轉色」，所以改為驗交替：望開一格嗰點係咪換咗另一隻色。"""
    H, W, _ = a.shape
    cA, cB = two_colours(a)
    nA = np.abs(a - cA).max(axis=2) < tol
    nB = np.abs(a - cB).max(axis=2) < tol
    strong = nA | nB
    halo = (a.max(2) - a.min(2) < 40) & ((a @ LUM) > (cA @ LUM) - 40)   # JPEG 光暈
    walk = strong | halo

    border = np.zeros((H, W), bool)
    border[0, :] = border[-1, :] = border[:, 0] = border[:, -1] = True
    bg = _grow(border, walk)

    sh = max(2, int(round(cell_size(a))))
    flip = np.zeros((H, W), bool)
    flip[:, :-sh] |= (nA[:, :-sh] & nB[:, sh:]) | (nB[:, :-sh] & nA[:, sh:])
    flip[:, sh:]  |= (nA[:, sh:] & nB[:, :-sh]) | (nB[:, sh:] & nA[:, :-sh])
    flip[:-sh, :] |= (nA[:-sh, :] & nB[sh:, :]) | (nB[:-sh, :] & nA[sh:, :])
    flip[sh:, :]  |= (nA[sh:, :] & nB[:-sh, :]) | (nB[sh:, :] & nA[:-sh, :])
    return bg, strong, flip, cA, cB


def reduce_to(a, bg, strong, flip, N, need=0.62):
    H, W, _ = a.shape
    px = np.zeros((N, N, 4), np.uint8)
    for r in range(N):
        y0, y1 = int(round(r * H / N)), int(round((r + 1) * H / N))
        for c in range(N):
            x0, x1 = int(round(c * W / N)), int(round((c + 1) * W / N))
            b = bg[y0:y1, x0:x1]
            if b.mean() > need:
                continue
            st = strong[y0:y1, x0:x1]
            # 成格都係棋盤色、而且睇得出交替 → 圖示內部嘅窿
            if st.mean() > 0.85 and flip[y0:y1, x0:x1][st].mean() > 0.5:
                continue
            blk = a[y0:y1, x0:x1]
            keep = blk[~b] if (~b).sum() >= 8 else blk.reshape(-1, 3)
            px[r, c, :3] = np.median(keep, axis=0)
            px[r, c, 3] = 255
    return px


def biggest_blob(px):
    """淨低最大嗰嚿，掃走零星雜點格。"""
    N = px.shape[0]
    op = px[..., 3] > 0
    seen = np.zeros((N, N), bool)
    best, bestn = None, 0
    for r in range(N):
        for c in range(N):
            if not op[r, c] or seen[r, c]:
                continue
            st, comp = [(r, c)], []
            seen[r, c] = True
            while st:
                y, x = st.pop(); comp.append((y, x))
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        v, u = y+dy, x+dx
                        if 0 <= v < N and 0 <= u < N and op[v, u] and not seen[v, u]:
                            seen[v, u] = True; st.append((v, u))
            if len(comp) > bestn:
                best, bestn = comp, len(comp)
    if best is None:
        return px, 0
    keep = np.zeros((N, N), bool)
    for y, x in best:
        keep[y, x] = True
    dropped = int(op.sum() - bestn)
    px[op & ~keep] = 0
    return px, dropped


def trim_square(px):
    ys, xs = np.where(px[..., 3] > 0)
    if not len(ys):
        return px
    box = px[ys.min():ys.max()+1, xs.min():xs.max()+1]
    h, w, _ = box.shape
    s = max(h, w)
    out = np.zeros((s, s, 4), np.uint8)
    out[(s-h)//2:(s-h)//2+h, (s-w)//2:(s-w)//2+w] = box
    return out


def smallest_png(im):
    buf = io.BytesIO(); im.save(buf, 'PNG', optimize=True)
    best = ('全彩', buf.getvalue())
    for n in (8, 12, 16, 24, 32, 48):
        buf = io.BytesIO()
        im.quantize(colors=n, method=Image.FASTOCTREE).save(buf, 'PNG', optimize=True)
        if len(buf.getvalue()) < len(best[1]):
            best = (f'{n}色', buf.getvalue())
    return best


def convert(path, native=32, tol=22, need=0.62, log=lambda s: None):
    a = np.asarray(Image.open(path).convert('RGB')).astype(float)
    bg, strong, flip, cA, cB = alpha(a, tol)
    log(f'棋盤色 {cA.astype(int)} / {cB.astype(int)}　格闊 {cell_size(a):.1f}px　背景佔 {bg.mean()*100:.0f}%')
    px = reduce_to(a, bg, strong, flip, native, need)
    px, dropped = biggest_blob(px)
    px = trim_square(px)
    log(f'{native}×{native} → 裁到 {px.shape[1]}×{px.shape[0]}　掃走雜點 {dropped} 格')
    return Image.fromarray(px, 'RGBA')


def preview(im, out, scale=12):
    big = im.resize((im.size[0]*scale, im.size[1]*scale), Image.NEAREST)
    W, H = big.size
    g = np.zeros((H, W, 4), np.uint8)
    g[..., :3] = (22, 28, 47)          # 真節點底色
    g[..., 3] = 255
    bg = Image.fromarray(g, 'RGBA'); bg.alpha_composite(big); bg.save(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('image')
    ap.add_argument('--name', default='icon', help='NODE_IMG 嘅 key：mob/elite/rest/shop/chest/unknown/boss')
    ap.add_argument('--native', type=int, default=32, help='原生解像度，細節多嘅圖示開 48')
    ap.add_argument('--tol', type=float, default=22, help='棋盤色容差')
    ap.add_argument('--need', type=float, default=0.62, help='一格入面幾多成背景先當透明')
    ap.add_argument('--preview', help='寫一張放大 12 倍、深藍底嘅預覽圖出嚟核對')
    a = ap.parse_args()

    err = lambda s: print('#   ' + s, file=sys.stderr)
    print(f'# {a.image}', file=sys.stderr)
    im = convert(a.image, a.native, a.tol, a.need, log=err)
    tag, data = smallest_png(im)
    b64 = base64.b64encode(data).decode()
    err(f'{tag}　PNG {len(data)}B　base64 {len(b64)}B')
    print(f"  {a.name}:'data:image/png;base64,{b64}',")
    if a.preview:
        preview(im, a.preview)
        err(f'預覽 → {a.preview}')


if __name__ == '__main__':
    main()
