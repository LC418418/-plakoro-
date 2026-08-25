#!/usr/bin/env python3
"""由 PokeAPI 資料生成 index.html 嘅 DEX_RAW / EVO（第一至三代，1-386）。

點解唔直接 call pokeapi.co：呢個 sandbox 嘅 egress proxy 擋咗佢（403）。
改用官方靜態鏡像 PokeAPI/api-data 嘅 raw.githubusercontent —— 同一份 JSON，
連 URL 結構都一樣，淨係前面加咗 repo 路徑。

用法：
    python3 tools/gendex.py fetch      # 落資料（有 cache，行第二次唔會再落）
    python3 tools/gendex.py check      # 攞現有 1-151 對數，證明映射表冇砌錯
    python3 tools/gendex.py emit       # 出 DEX_RAW 152-386 + EVO 二三代

⚠ 人手打 235 行 = 燒好多 token 兼一定有錯，所以先有呢個腳本。
"""
import json, os, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE  = 'https://raw.githubusercontent.com/PokeAPI/api-data/master/data/api/v2'
CACHE = os.path.join(os.path.dirname(__file__), '.cache')
MAXN  = 386                      # 到豐緣為止（第三代尾）

# ---------- 官方 18 屬性 → 遊戲 10 屬性 ----------
# 唔係我砌嘅，係由現有關都 151 隻反推返出嚟（`check` 會驗返）。
# 岩石→無（小剛「岩石道館」type:'無'）、地面→闘（坂木）、毒同幽靈→悪、
# 冰→水（勘菜）、龍→空（渡）、蟲→草（綠毛蟲）、妖精→超（第三代未有）。
TYPE_MAP = {
    'normal':'無', 'fire':'炎', 'water':'水', 'electric':'雷', 'grass':'草',
    'ice':'水', 'fighting':'闘', 'poison':'悪', 'ground':'闘', 'flying':'空',
    'psychic':'超', 'bug':'草', 'rock':'無', 'ghost':'悪', 'dragon':'空',
    'dark':'悪', 'steel':'鋼', 'fairy':'超',
}

# ---------- 雙屬性揀邊個 ----------
# 遊戲入面一隻得一個屬性。一開始估「揀第一屬性」，`check` 話錯 13 隻；
# 逐隻反推之後先知現有 151 隻其實跟緊一個**優先次序**：邊個屬性排前就用邊個。
# 憑證（全部由現有 DEX_RAW 反推，唔係我砌）：
#   磁怪 81 電/鋼→鋼（鋼贏電）、迷唇姐 124 冰/超→超（超贏冰）、
#   呆呆獸 79 水/超→水（水贏超）、毒刺水母 73 水/毒→水（水贏毒）、
#   妙蛙 1 草/毒→草、獨角蟲 13 蟲/毒→草、超音蝠 41 毒/飛→悪（毒贏飛）、
#   蚊香蛙皇 62 水/闘→水、大岩蛇 95 岩/地→闘（地贏岩）、
#   化石翼龍 142 岩/飛→空、菊石獸 138 岩/水→水（岩讓晒路）、
#   波波 16 一般/飛→空（一般讓路）、噴火龍 6 火/飛→炎、急凍鳥 144 冰/飛→水。
# 排完之後 151 隻淨係錯一隻：暴鯉龍 130 水/飛，現有寫「空」——
# 佢係人手調嘅（設計上想佢似龍），照跟優先次序會出「水」。
# 1-151 唔會重新生成，所以呢隻唔使理，`check` 會照報出嚟。
# 「惡」（dark）第二代先出現，關都冇得反推，所以係我排嘅：擺喺水之後、
# 毒之前。咁樣狃拉（惡/冰）同班基拉斯（岩/惡）出「悪」，
# 而黑魯加（惡/火）出「炎」、巨牙鯊（水/惡）出「水」—— 三樣都貼返直覺。
TYPE_RANK = ['steel', 'ghost', 'dragon', 'fire', 'grass', 'bug', 'water',
             'dark', 'poison', 'electric', 'psychic', 'fairy', 'ice',
             'fighting', 'ground', 'flying', 'rock', 'normal']
assert set(TYPE_RANK) == set(TYPE_MAP), '18 個官方屬性要排齊'

# 三個世代嘅編號範圍。決定 2 揀咗 A：三個世代嘅池唔會溝埋，
# 所以階級同進化鏈都**淨係計同一個世代入面**嗰段鏈。
GENS = [(1, 151), (152, 251), (252, 386)]


def gen_of(n):
    for lo, hi in GENS:
        if lo <= n <= hi:
            return lo, hi
    return None


def get(path):
    """落一個 JSON，落完 cache 喺 tools/.cache/，行第二次唔使再落。"""
    fn = os.path.join(CACHE, path.replace('/', '_') + '.json')
    if os.path.exists(fn):
        with open(fn, encoding='utf-8') as f:
            return json.load(f)
    req = urllib.request.Request(f'{BASE}/{path}/index.json',
                                 headers={'User-Agent': 'poketower-gendex'})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read().decode('utf-8'))
    os.makedirs(CACHE, exist_ok=True)
    with open(fn, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    return data


def fetch_all():
    """species + pokemon 各 386 個，再跟住入面嘅 URL 落進化鏈。"""
    paths = [f'pokemon-species/{n}' for n in range(1, MAXN + 1)]
    paths += [f'pokemon/{n}' for n in range(1, MAXN + 1)]
    with ThreadPoolExecutor(max_workers=16) as ex:
        list(ex.map(get, paths))

    chains = set()
    for n in range(1, MAXN + 1):
        u = get(f'pokemon-species/{n}').get('evolution_chain')
        if u:
            chains.add('evolution-chain/' + u['url'].rstrip('/').split('/')[-1])
    with ThreadPoolExecutor(max_workers=16) as ex:
        list(ex.map(get, sorted(chains)))
    print(f'落咗 {MAXN} 隻 species + {MAXN} 隻 pokemon + {len(chains)} 條進化鏈')


# ---------- 由 API 資料整返遊戲要嘅四個欄位 ----------

def zh_name(sp):
    """繁中名。第三代有幾隻 API 冇繁中，退返簡中／英文，等 `emit` 標出嚟人手執。"""
    names = {n['language']['name']: n['name'] for n in sp['names']}
    return names.get('zh-Hant') or names.get('zh-hant') or \
           names.get('zh-Hans') or names.get('zh-hans') or sp['name']


def game_type(n):
    """雙屬性揀優先次序排得最前嗰個（見上面 TYPE_RANK 嘅反推憑證）。"""
    ts = [t['type']['name'] for t in get(f'pokemon/{n}')['types']]
    return TYPE_MAP[min(ts, key=TYPE_RANK.index)]


def chain_of(n):
    """攞呢隻所在嘅進化鏈（dict 樹）。冇就返 None。"""
    u = get(f'pokemon-species/{n}').get('evolution_chain')
    return get('evolution-chain/' + u['url'].rstrip('/').split('/')[-1]) if u else None


def sid(node):
    return int(node['species']['url'].rstrip('/').split('/')[-1])


def local_chain(n, lo, hi):
    """剪走唔喺 [lo,hi] 嘅節點之後，n 所在嗰段鏈：(層數, 總層數, 父, 仔)。

    ⚠ 一定要剪。唔剪嘅話大鋼蛇（208）會當成「大岩蛇 95 嘅第 2 階」，
    但大岩蛇喺關都池 —— 城都池入面佢自己就係單階強者。
    """
    ch = chain_of(n)
    if not ch:
        return 1, 1, None, []
    par, kids = {}, {}

    def walk(node):
        me = sid(node)
        kids[me] = [sid(k) for k in node['evolves_to']]
        for k in node['evolves_to']:
            par[sid(k)] = me
            walk(k)
    walk(ch['chain'])
    inr = lambda x: lo <= x <= hi

    root = n                                   # 向上行到範圍內最頂
    while par.get(root) is not None and inr(par[root]):
        root = par[root]

    depth = {}

    def dfs(x, d):                             # 由根向下，只行範圍內嘅
        depth[x] = d
        for k in kids.get(x, []):
            if inr(k):
                dfs(k, d + 1)
    dfs(root, 1)
    return depth[n], max(depth.values()), \
        (par.get(n) if inr(par.get(n, -1)) else None), \
        [k for k in kids.get(n, []) if inr(k)]


def stage_of(n):
    """階級 s：1=幼體 2=中階 3=完全體／單階強者 4=傳說。

    由關都反推嘅規則：
      傳說／幻獸 → 4；官方標住 is_baby → 1（皮丘、迷唇娃嗰批，
      佢哋喺自己世代入面睇落係「單階」，但明顯係幼體）；
      其餘睇喺同世代嗰段鏈嘅第幾層 —— **單階算 3 唔算 1**（大蔥鴨、
      吉利蛋嗰批「單階強者」），兩階鏈係 1→3（跳過 2，烈雀 21→大嘴雀 22
      就係咁），三階鏈先至 1→2→3。
    """
    sp = get(f'pokemon-species/{n}')
    if sp.get('is_legendary') or sp.get('is_mythical'):
        return 4
    if sp.get('is_baby'):
        return 1
    lo, hi = gen_of(n)
    d, total, _, _ = local_chain(n, lo, hi)
    if total <= 1:
        return 3                      # 單階 = 強者，唔係幼體
    return 1 if d == 1 else 3 if d == total else 2


def evo_map(cross=False):
    """dex → 下一階 dex。多過一個分支就出 list（伊布嗰種，遊戲畀玩家自己揀）。

    預設淨係出**同世代內**嘅邊。cross=True 就反過嚟，淨係出跨世代嗰啲
    （大岩蛇 95→大鋼蛇 208 嗰種，第二代先加嘅新進化）—— 呢批唔可以就咁加，
    加咗即係關都局會進化出城都寶可夢，撞正決定 2（三個池唔溝埋）。
    """
    out = {}
    for n in range(1, MAXN + 1):
        lo, hi = gen_of(n)
        ch = chain_of(n)
        if not ch:
            continue
        kids = []

        def walk(node):
            if sid(node) == n:
                kids.extend(sid(k) for k in node['evolves_to'] if sid(k) <= MAXN)
                return
            for k in node['evolves_to']:
                walk(k)
        walk(ch['chain'])
        keep = [k for k in kids if (not (lo <= k <= hi)) == cross]
        if keep:
            out[n] = keep[0] if len(keep) == 1 else keep
    return out


# ---------- 對數：用現有 1-151 驗返上面幾條規則 ----------

def read_existing(hi=151):
    """由 index.html 讀返關都嗰 151 隻，做我哋嘅標準答案。

    ⚠ 只讀 1-151：`apply` 之後個檔已經有埋二三代，佢哋係呢啲規則生成嘅，
    攞返嚟對自己就永遠全中，驗唔到嘢。
    """
    html = os.path.join(os.path.dirname(__file__), '..', 'index.html')
    with open(html, encoding='utf-8') as f:
        src = f.read()
    body = src[src.index('const DEX_RAW = ['):]
    body = body[:body.index('\n];')]
    out = {}
    for m in re.finditer(r"\[(\d+),'([^']+)','([^']+)',(\d)(?:,'([^']+)')?\]", body):
        n, name, ty, s, weak = m.groups()
        if int(n) <= hi:
            out[int(n)] = (name, ty, int(s), weak)
    return out


def check():
    old = read_existing()
    print(f'現有 {len(old)} 隻，逐項對返生成規則：\n')
    bad_t, bad_s, bad_n = [], [], []
    for n, (name, ty, s, weak) in sorted(old.items()):
        gt, gs, gn = game_type(n), stage_of(n), zh_name(n_sp(n))
        if gt != ty:
            bad_t.append(f'  {n:3} {name}：現有 {ty}，生成 {gt}')
        if gs != s:
            bad_s.append(f'  {n:3} {name}：現有 s={s}，生成 s={gs}')
        if gn != name:
            bad_n.append(f'  {n:3} 現有「{name}」，API「{gn}」')
    print(f'屬性唔啱 {len(bad_t)}/151：');  print('\n'.join(bad_t) or '  （全中）')
    print(f'\n階級唔啱 {len(bad_s)}/151：'); print('\n'.join(bad_s) or '  （全中）')
    print(f'\n名唔同 {len(bad_n)}/151：');   print('\n'.join(bad_n) or '  （全中）')

    ev = evo_map()
    old_ev = re.search(r'const EVO = \{(.*?)\n\};', open(
        os.path.join(os.path.dirname(__file__), '..', 'index.html'),
        encoding='utf-8').read(), re.S).group(1)
    cur = {}
    for m in re.finditer(r'(\d+):(\[[\d,]+\]|\d+)', old_ev):
        cur[int(m.group(1))] = json.loads(m.group(2))
    diff = [f'  {k}: 現有 {cur.get(k)}，生成 {ev.get(k)}'
            for k in sorted(set(cur) | {k for k in ev if k <= 151})
            if cur.get(k) != ev.get(k)]
    print(f'\n進化鏈唔啱 {len(diff)}：'); print('\n'.join(diff) or '  （全中）')


def n_sp(n):
    return get(f'pokemon-species/{n}')


# ---------- 出 code ----------

def build(lo=152, hi=MAXN):
    """出兩舊 code：DEX_RAW 嘅新行、同 EVO 嘅新行。"""
    rows, warn = [], []
    for n in range(lo, hi + 1):
        name = zh_name(n_sp(n))
        if not re.fullmatch(r'[一-鿿Ⅰ-Ⅿ·]+', name):
            warn.append(f'{n} {name}')
        rows.append(f"[{n},'{name}','{game_type(n)}',{stage_of(n)}]")
    dex = '\n'.join(','.join(rows[i:i + 3]) + ',' for i in range(0, len(rows), 3))

    ev = {k: v for k, v in evo_map().items() if lo <= k <= hi}
    items = [f'{k}:{json.dumps(v, separators=(",", ""))}' for k, v in sorted(ev.items())]
    evo = '\n'.join('  ' + ', '.join(items[i:i + 8]) + ','
                    for i in range(0, len(items), 8))
    return dex, evo, warn


def emit():
    dex, evo, warn = build()
    print(dex + '\n\n/* EVO */\n' + evo)
    if warn:
        print('\n⚠ 呢幾隻攞唔到中文名，要人手執：' + '、'.join(warn), file=sys.stderr)


def apply():
    """直接寫入 index.html 嘅 DEX_RAW 同 EVO。

    生成嗰段夾喺 marker 中間，所以改咗映射表可以重跑，唔使人手貼 235 行。
    ⚠ marker 中間唔好人手改，一重跑就冇。
    """
    path = os.path.join(os.path.dirname(__file__), '..', 'index.html')
    with open(path, encoding='utf-8') as f:
        src = f.read()
    dex, evo, warn = build()

    def splice(src, tag, block, anchor):
        beg = f'/* ↓↓ {tag}：tools/gendex.py 生成，唔好人手改 ↓↓ */'
        end = f'/* ↑↑ {tag} 生成到呢度 ↑↑ */'
        new = f'{beg}\n{block}\n{end}'
        if beg in src:
            i, j = src.index(beg), src.index(end) + len(end)
            return src[:i] + new + src[j:]
        k = src.index(anchor) + len(anchor)
        return src[:k] + '\n' + new + src[k:]

    src = splice(src, '城都＋豐緣圖鑑', dex, "[151,'夢幻','超',4,'悪'],")
    src = splice(src, '城都＋豐緣進化鏈', evo,
                 '129:130, 133:[134,135,136], 138:139, 140:141, 147:148, 148:149,')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(src)
    print(f'寫咗入 index.html：DEX_RAW +{dex.count("[")} 隻、EVO +{evo.count(":")} 條')

    cross = evo_map(cross=True)
    print(f'\n⚠ 另外有 {len(cross)} 條**跨世代**進化冇加落去（第二代先加嘅新進化）：')
    print('  ' + '、'.join(f'{k}→{v}' for k, v in sorted(cross.items())))
    print('  加咗即係關都局會進化出城都寶可夢，撞正決定 2（三個池唔溝埋）。')
    print('  留返階段 2 抽 REGION 層嗰陣先決定點處理。')
    if warn:
        print('\n⚠ 呢幾隻攞唔到中文名，要人手執：' + '、'.join(warn), file=sys.stderr)


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'check'
    {'fetch': fetch_all, 'check': check, 'emit': emit, 'apply': apply}[cmd]()
