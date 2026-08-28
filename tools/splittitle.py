#!/usr/bin/env python3
"""封面圖拆層：由 assets/bg-title-v1.webp 拆出「背景」同「角色」兩張圖。

點解要拆：主畫面本來成張圖都係平面一塊，入面隻寶可夢冇可能單獨郁。
拆完之後角色自己一層，就可以喺 CSS 度畀佢哋慢慢唞氣。

出咩：
  assets/bg-title-bg-v1.webp     背景（四個角色摳走咗、後面用 inpaint 補返）
  assets/bg-title-chb-v1.webp    後排：水箭龜 + 藍衫訓練家（透明底）
  assets/bg-title-chf-v1.webp    前排：噴火龍 + 紅帽訓練家（透明底）

⚠ 三張都保持**同一個 688×1536 畫布**，唔剪裁。咁 CSS 嗰邊三層用同一句
  background-size:cover / position:center top 就自動對得準，唔使靠 JS 計
  cover 之後嘅縮放比例（一計就要處理 resize、轉橫直屏、520px 上限…）。
  透明區域喺 webp 度壓得好扁，所以多出嚟嘅檔案細過想像。

⚠ 影子特登**留喺背景**：角色郁嘅時候影子唔應該跟住郁。

用法：python3 tools/splittitle.py [--debug]
      --debug 會喺 tools/_split_debug/ 出幾張核對圖（唔會入 git）
"""
import os, sys
import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC  = os.path.join(ROOT, 'assets', 'bg-title-v1.webp')
OUT  = os.path.join(ROOT, 'assets')
DBG  = os.path.join(HERE, '_split_debug')

# 每個角色一個框（x, y, w, h）—— 由 grid 圖度量返嚟，四邊留咗少少水位。
# 分開逐個做，唔可以一個大框包兩個：GrabCut 會將中間嗰忽背景當埋做前景。
#   add：實係角色、但 GrabCut 一定睇漏嘅位（例如水箭龜嗰兩支白色炮管，
#        白色同淺色背景太似，唔強行標實就會俾佢斬走）
#   sub：實係背景、但成日俾佢當咗角色嘅位
# ⚠ 水箭龜同藍衫訓練家嘅框有少少重疊（炮管就喺訓練家隔籬）——
#   冇所謂，兩個都係入同一層，union 完就係一個 mask。
FIGURES = {
    'blastoise':   dict(rect=(338, 320, 195, 197),
                        add=[(360, 356, 18, 16),      # 左邊嗰支炮管
                             (503, 381, 18, 14)]),    # 右邊嗰支炮管
    'blueTrainer': dict(rect=(520, 326,  70, 182),
                        add=[(546, 344, 18, 14)]),    # 啡色頭髮，唔標實會俾綠色背景食咗
    # 噴火龍要加顏色篩：兩隻翼同條頸夾住嗰忽石地係「連住」嘅，GrabCut
    # 分唔開，要靠 R−G 差先切得走（見 color_gate 入面點解唔用色相）。
    'charizard':   dict(rect=(158, 540, 262, 266), rg=35),
    'redTrainer':  dict(rect=( 66, 546, 108, 244)),
}
# 邊個角色歸邊一層。分兩層係想前後排各自用唔同嘅呼吸節奏，
# 唔係成幅畫一齊上下郁 —— 一齊郁就好似成張圖喺度震，唔似兩隻生物。
LAYERS = {
    'chb': ['blastoise', 'blueTrainer'],   # 後排（遠、細、唞得慢）
    'chf': ['charizard', 'redTrainer'],    # 前排（近、大、唞得明顯啲）
}
MAX_HOLE = 260          # 大過呢個嘅「窿」當佢係真背景，唔填（見 clean()）


def grabcut(img, spec, iters=8):
    """分前景背景。⚠ 用 INIT_WITH_MASK 唔用 INIT_WITH_RECT：
       框以外成幅圖（樹、石地、藤蔓…）一律標做實背景，GrabCut 就有大量
       背景樣本去學，比淨係睇個框準好多；框邊嗰幾格都當實背景（框本身
       留咗水位，邊上實係背景）。"""
    rect = spec['rect']
    x, y, w, h = rect
    m = np.full(img.shape[:2], cv2.GC_BGD, np.uint8)
    m[y:y + h, x:x + w] = cv2.GC_PR_FGD
    b = 3
    m[y:y + b, x:x + w] = cv2.GC_BGD
    m[y + h - b:y + h, x:x + w] = cv2.GC_BGD
    m[y:y + h, x:x + b] = cv2.GC_BGD
    m[y:y + h, x + w - b:x + w] = cv2.GC_BGD
    for (ax, ay, aw, ah) in spec.get('add', []):
        m[ay:ay + ah, ax:ax + aw] = cv2.GC_FGD
    for (sx, sy, sw, sh) in spec.get('sub', []):
        m[sy:sy + sh, sx:sx + sw] = cv2.GC_BGD
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(img, m, None, bgd, fgd, iters, cv2.GC_INIT_WITH_MASK)
    return np.where((m == cv2.GC_FGD) | (m == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)


def color_gate(img, m, rg):
    """用顏色再篩一次 —— GrabCut 淨係識「連住一齊」，分唔開兩隻翼同條頸
       夾住嗰忽石地。

       ⚠ 試過用色相，唔得：石地係橄欖色（H≈28-32），噴火龍隻翼（H≈15-33）
         同佢重疊，一刀切落去唔係斬親隻翼就係留住石地。
         真正分得開嘅係 **R 減 G**：
             噴火龍 +82 … +130　　石地 −12 … +6
         （石地 R≈G，橙色 R 遠高過 G。）
       ⚠ 深色描邊同白色爪／牙冇顏色可言，要另外撈返，但**一定要限喺
         貼住角色色嗰幾格** —— 石地陰影一樣係深色，唔限範圍就會連一大嚿
         背景留埋落嚟。"""
    b, g, r = (img[:, :, i].astype(np.int16) for i in range(3))
    core = (r - g) >= rg
    mx, mn = img.max(axis=2), img.min(axis=2)
    near = cv2.dilate((core * 255).astype(np.uint8),
                      cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))) > 0
    ok = core | (near & (mx < 90)) | (near & ((mx - mn) < 45) & (mx > 170))
    return np.where(ok, m, 0).astype(np.uint8)


def clean(mask, spec, img=None):
    """執靚個 mask：
       1. 框外一律清走（GrabCut 有時會喺框邊漏啲嘢出去）
       2. 顏色再篩（淨係 spec 有寫 rg 先做）
       3. 掃走碎片，但**唔可以淨係留最大嗰嚿**
       4. 補返入面嗰啲細窿"""
    rect = spec['rect']
    x, y, w, h = rect
    keep = np.zeros_like(mask)
    keep[y:y + h, x:x + w] = 255
    m = cv2.bitwise_and(mask, keep)

    if spec.get('rg') and img is not None:
        m = color_gate(img, m, spec['rg'])

    # ⚠ 呢度以前係「開運算 + 淨係留最大嗰嚿」，衰咗兩次：
    #   開運算會切斷幼位（訓練家條頸），跟住「最大嗰嚿」就順手掉咗個頭；
    #   水箭龜嗰支炮管一斷開就同樣冇咗。
    #   而家改成「面積夠大就留」，另外 add 標實咗嘅位一定留。
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    if n > 1:
        areas = stats[1:, cv2.CC_STAT_AREA]
        thr = max(80, areas.max() * 0.02)
        want = {i + 1 for i, a in enumerate(areas) if a >= thr}
        for (ax, ay, aw, ah) in spec.get('add', []):
            want |= set(np.unique(lab[ay:ay + ah, ax:ax + aw])) - {0}
        m = np.where(np.isin(lab, list(want)), 255, 0).astype(np.uint8)

    # 填窿：由外圍 flood fill，填唔到嘅就係「窿」。
    # ⚠ 只可以填**細窿**（手臂同身之間嗰啲）。一 union 晒就大鑊：噴火龍
    #   兩隻翼同條頸夾住嗰忽石地都係「窿」，一填就連背景一齊摳埋落嚟。
    ff = m.copy()
    pad = np.zeros((m.shape[0] + 2, m.shape[1] + 2), np.uint8)
    cv2.floodFill(ff, pad, (0, 0), 255)
    holes = cv2.bitwise_not(ff)
    hn, hlab, hstats, _ = cv2.connectedComponentsWithStats(holes, 8)
    for i in range(1, hn):
        if hstats[i, cv2.CC_STAT_AREA] <= MAX_HOLE:
            m[hlab == i] = 255

    k5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    return cv2.morphologyEx(m, cv2.MORPH_CLOSE, k5, iterations=1)


def main():
    debug = '--debug' in sys.argv
    img = cv2.imread(SRC, cv2.IMREAD_COLOR)
    if img is None:
        sys.exit('讀唔到 ' + SRC)
    H, W = img.shape[:2]
    print(f'原圖 {W}×{H}')

    masks = {}
    for name, spec in FIGURES.items():
        masks[name] = clean(grabcut(img, spec), spec, img)
        print(f'  {name:12s} 摳到 {int(masks[name].sum() // 255):6d} px')

    # ---- 角色層：原圖 + alpha ----
    # ⚠ alpha 要**外擴兩格**再柔化，唔可以收窄。
    #   直覺會想收窄（驚留住一圈背景色出光暈），但呢度張角色圖嘅 RGB 就係
    #   原圖本身，外擴帶埋出嚟嗰兩格背景同原本嗰兩格**一模一樣**，靜止嗰陣
    #   完全睇唔出；收窄反而會鋸走角色自己條深色描邊，露出下面補返嘅背景。
    #   實測（同原圖逐格比）：收窄一格 差過 24 嘅像素 9764，外擴兩格得 782。
    #   外擴再多啲仲準，但郁嗰陣條「背景邊」會跟住走，同 2.5px 嘅唞氣幅度
    #   夾唔埋 —— 兩格啱啱好。
    k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    for layer, names in LAYERS.items():
        m = np.zeros((H, W), np.uint8)
        for n in names:
            m = cv2.bitwise_or(m, masks[n])
        alpha = cv2.GaussianBlur(cv2.dilate(m, k3, iterations=2), (3, 3), 0)
        rgba = np.dstack([img, alpha])
        out = os.path.join(OUT, f'bg-title-{layer}-v1.webp')
        cv2.imwrite(out, rgba, [cv2.IMWRITE_WEBP_QUALITY, 92])
        print(f'  → {os.path.basename(out)}  {os.path.getsize(out)//1024} KB')

    # ---- 背景層：角色位置用 inpaint 補返 ----
    # ⚠ 只需要補得掂「角色郁嗰兩三格」露出嚟嗰條窄邊，中間點都俾角色層冚住，
    #   所以 TELEA 呢種快嘅算法已經夠用。
    allm = np.zeros((H, W), np.uint8)
    for m in masks.values():
        allm = cv2.bitwise_or(allm, m)
    grow = cv2.dilate(allm, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)), iterations=1)
    bg = cv2.inpaint(img, grow, 6, cv2.INPAINT_TELEA)
    outbg = os.path.join(OUT, 'bg-title-bg-v1.webp')
    # q82：由 88 減落嚟慳 21KB，但畫質差別量到出嚟得 0.15（原圖自己嘅壓縮
    # 雜訊已經係 2.1，再谷高 quality 都係喺度重壓返啲雜訊，冇著數）。
    # 呢張係開機路徑上面嘅嘢，慳得 20KB 都要慳。
    cv2.imwrite(outbg, bg, [cv2.IMWRITE_WEBP_QUALITY, 82])
    print(f'  → {os.path.basename(outbg)}  {os.path.getsize(outbg)//1024} KB')

    if debug:
        os.makedirs(DBG, exist_ok=True)
        vis = img.copy()
        for name, m in masks.items():
            cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(vis, cnts, -1, (0, 0, 255), 1)
            x, y, w, h = FIGURES[name]['rect']
            cv2.rectangle(vis, (x, y), (x + w, y + h), (255, 0, 255), 1)
        cv2.imwrite(os.path.join(DBG, 'contours.png'), vis[300:850])
        cv2.imwrite(os.path.join(DBG, 'bg.png'), bg[300:850])
        # 角色層擺高 10px，睇下背景補得掂唔掂（實際淨係郁 2px）
        shifted = bg.copy()
        ys, xs = np.where(allm > 0)
        shifted[ys - 10, xs] = img[ys, xs]
        cv2.imwrite(os.path.join(DBG, 'shift10.png'), shifted[300:850])
        print('  debug 圖出咗喺 tools/_split_debug/')


if __name__ == '__main__':
    main()
