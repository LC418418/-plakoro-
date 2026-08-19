#!/usr/bin/env python3
"""把上載嘅像素畫圖示轉成可以直接嵌入 index.html 嘅 data URI。

手機上載出嚟嘅係 JPEG，冇真正嘅透明度 —— 「透明」係被畫成灰白棋盤格燒死咗入去。
呢個腳本做三件事：
  1. 由四邊度量返棋盤格嘅兩隻顏色，逐格判斷邊度先係真背景
     （真背景兩種棋盤色都要啱；白色刀身只會啱白格，唔會誤刪）
  2. 由畫面四邊灌水、遇到深色描邊就停，掃走 JPEG 壓縮嘅光暈殘影
  3. 縮返做原生像素解像度、裁走透明邊、減色壓縮成最細嘅 PNG

用法：
    python3 tools/pixicon.py 圖片.jpeg [--name mob] [--preview out.png]

會 print 出一行 `mob:'data:image/png;base64,...',`，抄入 index.html 嘅 NODE_IMG 就得。
"""
import argparse, base64, io, sys
from PIL import Image
import numpy as np

CHECKER_CELLS = 40      # 上載圖嘅棋盤格數（1024px ÷ 40 = 25.6px 一格）
NATIVE        = 32      # 像素畫原生解像度
DARK_LUM      = 130     # 幾暗先當係描邊


def to_native(a, tol, need):
    """1024×1024 JPEG → NATIVE×NATIVE RGBA，用棋盤格判斷透明度。"""
    H, W, _ = a.shape
    cell = W / CHECKER_CELLS
    ys, xs = np.mgrid[0:H, 0:W]
    par = ((xs / cell).astype(int) + (ys / cell).astype(int)) % 2

    m = max(4, W // 40)
    edge = np.zeros((H, W), bool)
    edge[:m, :] = edge[-m:, :] = edge[:, :m] = edge[:, -m:] = True
    col = [np.median(a[edge & (par == k)], axis=0) for k in (0, 1)]
    exp = np.where(par[..., None] == 0, col[0], col[1])
    isbg = np.abs(a - exp).max(axis=2) < tol

    px = np.zeros((NATIVE, NATIVE, 4), np.uint8)
    s, pad = W // NATIVE, (W // NATIVE) // 5
    for r in range(NATIVE):
        for c in range(NATIVE):
            bg, p = isbg[r*s:(r+1)*s, c*s:(c+1)*s], par[r*s:(r+1)*s, c*s:(c+1)*s]
            if min(bg[p == k].mean() if (p == k).any() else 0 for k in (0, 1)) > need:
                continue
            blk = a[r*s+pad:(r+1)*s-pad, c*s+pad:(c+1)*s-pad]
            b2 = isbg[r*s+pad:(r+1)*s-pad, c*s+pad:(c+1)*s-pad]
            keep = blk[~b2] if (~b2).sum() >= 12 else blk.reshape(-1, 3)
            px[r, c, :3] = np.median(keep, axis=0)
            px[r, c, 3] = 255
    return px, col


def biggest_blob(px):
    """淨低最大嗰嚿，掃走零星雜點格。"""
    N = px.shape[0]
    lab = -np.ones((N, N), int)
    sizes = []
    for r in range(N):
        for c in range(N):
            if px[r, c, 3] == 0 or lab[r, c] >= 0:
                continue
            st, n = [(r, c)], 0
            lab[r, c] = len(sizes)
            while st:
                y, x = st.pop(); n += 1
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        v, u = y+dy, x+dx
                        if 0 <= v < N and 0 <= u < N and px[v, u, 3] and lab[v, u] < 0:
                            lab[v, u] = len(sizes); st.append((v, u))
            sizes.append(n)
    if sizes:
        px[(lab >= 0) & (lab != int(np.argmax(sizes)))] = 0
    return px, (sum(sizes) - max(sizes)) if sizes else 0


def outline_clean(px):
    """由四邊灌水，遇到深色描邊就停 —— 清走 JPEG 光暈。
    圖示要被描邊完整包住先有效（手繪像素畫一般都係）。"""
    N = px.shape[0]
    lum = px[..., :3].astype(float) @ [.299, .587, .114]
    solid = (px[..., 3] > 0) & (lum < DARK_LUM)
    seen = np.zeros((N, N), bool)
    st = []
    for i in range(N):
        for y, x in ((0, i), (N-1, i), (i, 0), (i, N-1)):
            if not solid[y, x] and not seen[y, x]:
                seen[y, x] = True; st.append((y, x))
    while st:
        y, x = st.pop()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            v, u = y+dy, x+dx
            if 0 <= v < N and 0 <= u < N and not seen[v, u] and not solid[v, u]:
                seen[v, u] = True; st.append((v, u))
    px[seen] = 0
    return px


def trim_square(px):
    """裁走透明邊再補成正方形，令每個圖示喺節點入面大細一致。"""
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
    best = None
    buf = io.BytesIO(); im.save(buf, 'PNG', optimize=True)
    best = ('全彩', buf.getvalue())
    for n in (8, 12, 16, 24):
        buf = io.BytesIO()
        im.quantize(colors=n, method=Image.FASTOCTREE).save(buf, 'PNG', optimize=True)
        if len(buf.getvalue()) < len(best[1]):
            best = (f'{n}色', buf.getvalue())
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('image')
    ap.add_argument('--name', default='icon', help='NODE_IMG 入面嘅 key，例如 mob / boss / rest')
    ap.add_argument('--tol', type=float, default=22, help='棋盤色容差，光暈嚴重就調高')
    ap.add_argument('--need', type=float, default=0.62, help='幾多成似棋盤先當透明')
    ap.add_argument('--preview', help='寫一張放大 12 倍、深藍底嘅預覽圖出嚟核對')
    a = ap.parse_args()

    src = np.asarray(Image.open(a.image).convert('RGB')).astype(int)
    px, col = to_native(src, a.tol, a.need)
    px, dropped = biggest_blob(px)
    px = outline_clean(px)
    px = trim_square(px)
    im = Image.fromarray(px, 'RGBA')

    tag, data = smallest_png(im)
    b64 = base64.b64encode(data).decode()

    print(f"# {a.image}", file=sys.stderr)
    print(f"#   棋盤色 {col[0].astype(int)} / {col[1].astype(int)}　掃走雜點 {dropped} 格", file=sys.stderr)
    print(f"#   {im.size[0]}×{im.size[1]}　{tag}　PNG {len(data)}B　base64 {len(b64)}B", file=sys.stderr)
    print(f"  {a.name}:'data:image/png;base64,{b64}',")

    if a.preview:
        big = im.resize((im.size[0]*12, im.size[1]*12), Image.NEAREST)
        W, H = big.size
        yy, xx = np.mgrid[0:H, 0:W]
        g = np.zeros((H, W, 4), np.uint8)
        g[..., :3] = np.where((((xx//24 + yy//24) % 2) == 0)[..., None], 22, 34)   # 深藍＝真節點底色
        g[..., 3] = 255
        bg = Image.fromarray(g, 'RGBA'); bg.alpha_composite(big); bg.save(a.preview)
        print(f"#   預覽 → {a.preview}", file=sys.stderr)


if __name__ == '__main__':
    main()
