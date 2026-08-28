# POKE TOWER — 俾 Claude 睇嘅開發筆記

一個單檔網頁遊戲（寶可夢風格嘅骰子對戰 + 爬塔）。同事之間玩，host 喺
GitHub Pages（`lc418418.github.io/-plakoro-/`），後端用 Firebase。

**用廣東話（書面粵語）同用家傾偈同寫註解。**

---

## ⚠ 開頭一定要知：`index.html` 好大，但唔再有 base64

成個遊戲喺一個 `index.html` 入面，**7,500+ 行 / 412KB**。

**階段 0 之後啲圖已經搬咗去 `assets/`**，所以以前嗰個「grep 一行 dump 728KB」
嘅 trap 冇咗，剩返一舊 12KB 嘅 `FACE_IMG`（骰面圖，細到唔值得多開一個檔）。

- 照舊**唔好 `cat index.html`、唔好 `Read` 成個檔** —— 而家 7,506 行，照樣好貴。
- 正確做法：**用 `grep -n` 搵常數／function 名攞行號，再 `Read` 嗰 30-60 行**。
  下面有成張地圖，多數情況唔使摸黑搵。
- ⚠ **grep 嗰陣加 `| cut -d: -f1` 淨係攞行號。** 唔加嘅話，一 grep 中
  `FACE_IMG` 嗰行就即刻 dump 返 12KB base64 出嚟 —— 呢個踩過。
- `assets/*.webp` 係 binary、`assets/dexspr-gen*.js` 係一行幾百 KB base64
  —— **兩樣都唔好讀**，冇嘢好睇。

---

## 檔案地圖

| 檔案 | 做咩 |
|---|---|
| `index.html` | **成個遊戲**（畫面、規則、數值；圖已經搬走） |
| `assets/` | 所有圖。檔名帶版本號（`bg-title-v1.webp`）＝ 永久 cache，換圖就改號 |
| `assets/bg-title-{bg,chb,chf}-v1.webp` | 封面拆咗三層（背景／後排／前排角色），`tools/splittitle.py` 出。⚠ `bg-title-v1.webp` 係原材料，頁面已經唔用，但**唔好剷**（要重出就靠佢） |
| `assets/dexspr-gen{1,2,3}-v1.js` | 386 隻精靈圖（第三代 GBA 版）。**開機只落 gen1**，另外兩個撳開圖鑑先落 |
| `sw.js` | Service worker。⚠ 出版要將 `CORE_V`（`poketower-vXX`）加一 |
| `manifest.webmanifest` | PWA。玩家多數係 iOS「加到主畫面」咁玩 |
| `database.rules.json` | Firebase 權限規則。⚠ **改完要人手去 Console 貼上去**，唔會自動生效 |
| `docs/八館改版計劃.md` | 四章→八館改版嘅交接文件，三個階段都做完 |
| `docs/三世代改版計劃.md` | 關都＋城都＋豐緣改版，七個階段。**階段 0-4、6、7 做完；階段 5（魔鬼 24 館通天塔）老細叫暫時唔好做，魔鬼掣而家標住「待更新」** |
| `docs/匿名登入設定.md` | 匿名登入／綁定嘅設計 + Firebase Console 要做嘅嘢 |
| `tools/` | 平衡模擬器 + 回歸測試（**唔屬於遊戲本體**，玩家見唔到） |
| `tools/splittitle.py` | 封面拆層（GrabCut 摳圖 + inpaint 補背景）。改咗框就重跑，`--debug` 有核對圖 |

## `index.html` 分區（`<script>` 逐個 block）

| 大概行 | 內容 |
|---|---|
| ~12 | Firebase config **＋ 動畫等級開機碼**（`<html data-anim>`，見下面「動畫等級」） |
| ~1151 | Plakoro 卡表資料（官方 12 隻） |
| ~1466 | `FACE_IMG` 骰面圖（**唯一剩低嘅 base64**，12KB） |
| ~1472 | 精靈圖分三個世代載（`loadDexSpr`，開機只落關都） |
| ~1486 | 能量骰／晶片資料 |
| ~1605 | **386 隻圖鑑 `DEX_RAW`／`DEX`**（152 起係 `gendex.py` 生成，夾喺 marker 中間） |
| ~1786 | `DEX_GENS`／`ACTIVE_GEN`／`genPool`（**世代分界**，見下面） |
| ~1801 | 進化鏈（152 起同樣係生成嘅） |
| ~1867 | `DEAD_END_BASIC`／`canDraft`（進化唔到嘅 baby 唔會出喺開局三選一） |
| ~1921 | 招式／骰組生成器：`PMV` 玩家模板（~1961）、`opText`、`faceEV`（~2081）、`genPlayable`（~2114） |
| ~2184 | `SCENES`／`MAPBG`（而家淨係檔案路徑，圖喺 `assets/`） |
| ~2188 | **規則引擎**（`takeTurn`、`payCost`、傷害結算、所有 op） |
| ~2445 | 出招特效（`playAttack` 蓄力／命中、`arenaShake`／`arenaFlash` 喺介面嗰邊） |
| ~2580 | **Firebase**：帳戶、匿名登入、綁定、新手引導、線上房 |
| ~2964 | 介面共用（`show`、`sheetOpen`、`toast`、`esc`）＋ 擲骰動畫（`rollDiceAnim`／`throwDice`）＋ `setAnimLevel`／`titleMotes` |
| ~3649 | **寶可夢圖鑑畫面**（`openDex`，四頁：三個世代 + 官方卡表） |
| ~3858 | **爬塔邏輯**：`MV_T` 敵人模板（~3865）、`TYPE_FLAVOR`（~3887）、`DIFFS`（~3984）、`TIER`（~4071）、`ACT_TUNE`（~4098）、`genMap`、`buildEnemy`、獎勵 |
| ~4200 | **`REGIONS`**（三個世代嘅道館／四天王／冠軍／御三家／`TYPE_FOCUS`）+ `setGen()` |
| ~4931 | 爬塔存檔 + 戰力 + PvP 快照（`SAVE_VER` 5＝存檔記住 `gen`） |
| ~5238 | **名人堂**（每個世代三格 + 舊格式 migration） |
| ~5367 | 爬塔 PvP 引擎 |
| ~5453 | **爬塔介面**（`ensureSpr`、地圖、戰鬥、獎勵、商店、結算） |
| ~5494 | `rgStart`／`openGenPick`（開新一局：先揀世代）＋ 開局抽卡 |
| ~5719 | 地圖：`mapFrameSVG`（即場砌邊框 SVG）、`fitMapMetrics`、`renderMap` |
| ~6728 | **道具袋** `ITEMS` + `openItems`（寶箱／商店拎到，地圖同四天王用） |
| ~6970 | **排行榜 + 管理員**（`badgeMask`／`gens` 累計、`boardWrite` 退返舊格式） |
| ~7575 | 爬塔隊伍 PvP 介面 |

## 主要旋鈕（`grep -n "^const XXX"` 搵得返）

**結構**：`ACTS`（8 個道館）、`MAP_ROWS`（每館 6 關）、`BATTLE_ROWS`、
`ACTIVE_N`（出戰 3）、`PARTY_MAX`（全隊 6）、`RELIC_MAX`（遺物 8）

**世代**：`REGIONS`（三個世代成套內容）、`setGen(g)`、`DEX_GENS`（編號範圍）、
`ACTIVE_GEN`、`genPool()`（當代嗰批 DEX）、`inGen(n)`、`genOf(n)`、`regionOf(g)`、`genName(g)`

> ⚠ **`GYMS`／`ELITE4`／`CHAMPION`／`STARTERS`／`TYPE_FOCUS`／`GEN_TUNE` 而家係 `let`，
> 唔係 `const`。** 佢哋係「而家嗰局用緊嗰個世代」嘅綁定，**一定要行 `setGen(g)` 換**
> —— 直接寫 `ACTIVE_GEN = x` 會令池同道館唔同步（打緊城都但撞到關都館主）。
>
> ⚠ **`DEX` 有 386 條，但一局只用一個世代。** 抽卡（`rollCands`）、
> 敵人池（`dexPool`）、神獸池、`allPlayable` 全部行 `ACTIVE_GEN` 嗰段。
> 加新嘅「掃全個圖鑑」嘅 code 一定要行 `genPool()`，唔好寫 `Object.values(DEX)`
> 或者 `for(n=1;n<=386;n++)` —— 溝咗世代唔會報錯，通關率要到階段 3 先量得返。
> `tools/test-dex.mjs` 有成打測試專門守住呢樣（逐個世代跑一次）。

**平衡**：`TIER`（~3779）、`ACT_TUNE`（~3806）、`GEN_TUNE`（~3839）、`DIFFS`（~3692）、
`BADGE_HP`、`EVO_WINS`、`MOB_RELIC_CHANCE`、`CHEST_RELIC_CHANCE`、`TYPE_FOCUS`

> ⚠ **敵人強度唔再係數字表。** 每個 tier 只寫 4 個端點
> （`hp0` `hp1` `nm0` `nm1`），中間幾何內插 `起點 × (終點÷起點)^(a/7)`；
> `ACT_TUNE` 係兩行 8 格嘅逐章微調。**唔好返去寫死逐章數字表。**
> `TIER.gym.hp` 係**成隊總血量**，`genMon` 再除 `gymTeamN(a)`。
> `TIER.e4` / `TIER.champ` 標咗 `flat:true` ＝ 唔食 `ACT_TUNE`。
>
> ⚠ **平衡有三層（階段 3 加咗第三層）**：
> `曲線 × ACT_TUNE[a] × GEN_TUNE[a]`。頭兩層**三個世代共用**，
> `GEN_TUNE` 係逐個世代嘅修正，數字寫喺 `REGIONS[g].tune`，由 `setGen()` 綁。
> **關都嗰份全部係 1（佢係基準）** —— 校城都／豐緣就淨係郁佢哋自己嗰行
> （`sweep.mjs` 嘅 `genTune`），**唔好郁 `ACT_TUNE`**，一郁就連關都一齊拉。
> `flat` tier（四天王／冠軍）同樣唔食 `GEN_TUNE`。

**內容**：`REGIONS`（三個世代各自嘅 `gyms` 八館／`e4` 四天王／`champ` 冠軍／
`starters` 御三家／`focus` 屬性焦點／`tune` 世代修正；`gyms[i].team` 有 4 隻
但第 4 隻淨係魔鬼第 5 館起先出）、`RELICS`、
`CHEST_LOOT`（寶箱唔中遺物嗰陣派邊款消耗品）、`ITEMS`（道具袋三款）

**招式（階段 4 之後）**：玩家池 `PMV`（六個 slot，每隻寶可夢攞 8 招）、
敵人池 `MV_T`（14 個模板）、`TYPE_FLAVOR`（十個屬性 × 每個模板一個名）、
`opText`（招式描述）、`faceEV`（一招值幾多）、`TIER[k].mv`（邊個 tier 抽得到邊幾個模板）

> ⚠ **加新模板要五樣一齊做**：`PMV`／`MV_T` 加條目（自己寫定 `k`）、
> `TYPE_FLAVOR` **十個屬性**都補個名、`opText` 補描述、`EV_W` 補權重。
> 漏咗 `TYPE_FLAVOR` 就會出個通用名（或者空白）；漏咗 `opText` 招式卡就少一行；
> **漏咗 `EV_W` 最惡** —— 四個揀招嘅地方（`enemyChoose`／`bestFour`／
> `monPowerScore`／`simlib` 嘅 `playerChoose`）當佢零分，即係「加咗招冇人肯揀」，唔會報錯。
>
> ⚠ **敵人唔可以有 `x2` / `fail`**。敵人嘅基本傷害本身已經乘咗成局倍率，
> 再 ×2 就係後期一擊清枱 —— `tameAdd` 壓得住角色骰嗰下加成，壓唔住 ×2。
> `test-moves.mjs` 守住呢樣。
>
> ⚠ **新模板嘅 cost 唔好寫成全「無」**（見下面「無」系館主嗰段坑）。

> ⚠ **一個世代嘅演員表淨係用得自己嗰段編號**，而且**同一隻唔好用兩次**
> （唔係一局入面會見到同一隻館主寵物兩次）。`test-dex.mjs` 兩項守住。
> 加新道館之前先睇 `focus` 上面嗰行「非神獸隻數」—— 池得三四隻嘅屬性
> 焦點要開 0，唔係成場都係同一隻。

**動畫等級（v49 加）**：`<html data-anim>` 三級 —— `full` / `less` / `off`，
喺 `<head>` 第一段 script 落定（**第一次 paint 之前**，唔係揀咗「關」都會見到
動畫行咗半格先停），玩家喺「帳戶」畫面最底揀，存 `plakoro.anim`。
守門規則喺 `<style>` **最尾**（source order 最大，唔使成堆 `!important`）。

> ⚠ **加新嘅循環動畫（唞氣、飄浮、慢鏡呢類）就要標 `.ambient`**，
> 唔係「少啲」嗰級關唔到佢。⚠ 但 `.ambient` 淨係管**自己**同自己嘅
> `::before/::after`，**唔會管仔仔** —— 呢個係特登嘅：`.fighter` 標咗
> `.ambient`，如果連仔仔一齊關，入面張圖嘅 `hitshake`／`faintAnim`
> 都會一齊死。要關仔仔嗰啲就好似 `titleMotes()` 咁，索性唔生出嚟。
>
> ⚠ 系統嘅 `prefers-reduced-motion` **而家淨係決定預設值**（reduce → `off`）。
> 本來散喺兩個 `@media` block 嘅規則搬晒入去，唔係玩家自己校返「全開」
> 都會俾系統設定靜靜哋壓住。

---

## 資料 schema

**localStorage**（冇帳戶都有）
```
plakoro.run.0-2     三格挑戰進度（v5 起入面記住 gen）
plakoro.slot        最近玩嗰格
plakoro.hof.<gen>.<i>  名人堂：三個世代 × 三格
                       （舊格式 plakoro.hof.<i> 由 hofMigrateLocal() 搬入 gen 0）
plakoro.loadouts    骰組
plakoro.best.<uid>  「歷來最遠」本機鏡像（保命用，見下面排行榜嗰段）
plakoro.onb.nick / plakoro.onb.bind   新手引導問過未
```

**Firebase RTDB**
```
users/<uid>/profile    { nick, created, wins, losses, auto }
                       auto:true = 個名係系統生成，仲未問過本人
users/<uid>/runs/0-2   雲端存檔（同 localStorage 對開，新嗰份行先）
users/<uid>/teams/<gen>/<i>   名人堂（舊格式 teams/0-2 由 hofMigrateCloud() 搬入
                       teams/0/0-2，一次過 set 成個節點，唔可以逐格搬）
users/<uid>/loadouts   骰組
users/<uid>/pvp        PvP 勝負統計
users/<uid>/rogue      { runs, wins, best, bestFloor, bestBadges,
                         badgeMask, genMask,        ← 階段 6
                         bestTeam, bestPower, bestDiff }
board/<uid>            公開摘要（排行榜）
                       { nick, ts, act, best, bestFloor, wins, runs, power,
                         diff, badges, badgeMask, gens, team }
admins/<uid>           管理員名單，客戶端寫唔到
rooms/<code>           線上對戰房
```

⚠ **`board` 嘅規則有 `$other: false`** —— 加新欄位一定要同時改
`database.rules.json` **並且去 Console 重新貼**，唔係成個寫入會俾人拒絕，
而且**唔會報錯，個名就係唔更新**。
呢個坑撞過兩次，所以階段 6 加咗兩重防守：
**(1)** `boardWrite()` 寫失敗會自動退返舊格式（掉走新欄位、`badges` 夾返 8）再試一次
—— 未貼規則個榜都仲行得，貼咗之後第一次寫就自動行返新格式；
**(2)** `test-auth.mjs` 直接對住 `database.rules.json` 檢查
「`boardRecord` 寫嘅每個欄位規則都有列明」同埋幾個數值上限夠唔夠大。

⚠ **徽章而家係 `badgeMask`（24 個 bit）唔係一個數**（階段 6）。
第 g 個世代第 i 個道館 = bit `g*8+i`，`popcount(mask)` 就係真正嘅徽章數 ——
咁「重打同一個道館」就唔會重複計。舊資料冇 mask，所以 `badgesOf()`
要同舊嗰個 `badges` 取大，唔係老玩家一開個榜就見到自己徽章跌咗。
⚠ 加第四個世代就會去到 32 bit（JS 位元運算得 31 bit）——
**嗰陣要改用兩個數或者字串，唔好靜靜哋加落去。**

⚠ **排行榜一行嘢全部要嚟自「最遠嗰次」**（`bestSnapshot()`）——
唔可以將歷來嘅 `best` 溝住呢一局嘅 `team`/`badges`。呢個位撞過兩次。

⚠ **`FB.rogue === null` 就唔可以寫榜。** `null` 嘅意思係「歷來最遠仲未讀到」
（`onAuthStateChanged` 入面兩個 await 之後先有值，讀失敗亦都係 null）。
當咗零嚟寫，就會將呢一局嘅進度當成新紀錄踩低真紀錄 —— 真事：
有人打爆冠軍之後個榜寫返「第 8 道館」，另一個「👑 通關 1」配「第 7 道館」。
三重防守：**(1)** `null` 就唔寫、**(2)** `plakoro.best.<uid>` 本機鏡像取大、
**(3)** `wins > 0` 就一定顯示「通關」＋八個徽章（`bestActOf` / `badgesOf`），
再加 `healBestFromHof()` 用名人堂嗰啲 `won` 紀錄補返舊資料。

---

## 點跑測試

```bash
cd tools && npm install          # 第一次先要
node tools/test-features.mjs     # 60 項：遺物上限／特訓／四天王補給／傷害尾巴／道具袋／
                                 #        敵人倒下免費換人／四天王換人／魔鬼難度封咗
node tools/test-resist.mjs       # 抗性遺物唔可以令倒下嘅寶可夢翻生
node tools/test-auth.mjs         # 52 項：匿名登入／問名／綁定／排行榜進度／通關唔會被踩低／
                                 #        三代累計徽章唔會重複計／board 欄位對得返規則
node tools/test-dex.mjs          # 46 項：386 隻資料／圖／圖鑑畫面／**三個世代唔會撈亂**／
                                 #        世代修正（GEN_TUNE）真係落到敵人度
node tools/test-moves.mjs        # 41 項：招式模板（連續技／援護／反擊／賭命／追擊）、
                                 #        十個屬性都有名、faceEV 睇得到、敵人冇 ×2
node tools/measure.mjs 3000 0 0  # 量通關率（局數、0 困難 1 魔鬼、0 關都 1 城都 2 豐緣）
GEN=1 N=3000 node tools/sweep.mjs '[{"genTune":{"hp":[...]}}]'   # ⚠ 校城都／豐緣行 genTune
```

**改完平衡、世代／存檔／名人堂、招式模板，或者 Firebase／排行榜邏輯，五個 test 都要跑。**
**量平衡要三個世代各量一次**（`measure.mjs` 第三個參數）。

模擬器跑幾多局**完全唔影響 usage**（返嚟都係同一舊細 JSON），所以
一次 sweep 塞多幾組設定去試，唔好一次試兩三組。局數 3000 起跳。

`tools/fbstub.js` 係假 Firebase（記憶體 RTDB + auth），`test-auth.mjs` 用，
**唔會連真 project**。佢特登模擬「session 非同步還原」，唔好改細咗。

---

## 改嘢嘅規矩

1. **出版一定要 `sw.js` 嘅 `CORE_V` 加版本號**，唔係玩家收唔到新版。
   ⚠ **唔好順手加 `ASSET_V`** —— 加咗就等於叫全世界重新落成 1.1MB 圖，
   拆檔就白拆。換圖係改檔名嘅版本號（`-v1` → `-v2`），唔關 `ASSET_V` 事。
2. **GitHub Pages 派 `main`。** 喺 branch 做完記得 merge 返落 `main`
   （撞過：喺 branch 做完冇 merge，玩家一直行緊舊 code）。
3. **註解寫「點解」，唔係「做乜」**，用廣東話。呢個 codebase 通篇都係咁，
   而且啲註解記低咗好多踩過嘅坑，跟返個風格。
4. 改到平衡就要跑 `measure.mjs` 對返目標（見 `tools/README.md`）。
5. 唔好改 `tools/` 入面啲嘢去遷就測試 —— 要改就改個真 bug。

---

## 踩過嘅坑（唔好再踩）

- **一個元素嘅 `transform` 得一個動畫用得（v49 撞到）。** 兩個動畫寫同一個
  屬性，**後面嗰個會靜靜哋蓋死前面**，唔會報錯。粒骰嘅「翻滾」（`sh`）已經
  佔咗 `transform`，所以「由框外掟入」嗰段要用**獨立變換屬性**
  （`translate` / `rotate` / `scale` —— 佢哋喺 `transform` 之前套用，兩者夾得埋），
  而且兩個動畫要寫喺**同一句** `animation:` 度。
  同一個道理，寶可夢嘅唞氣特登落喺 `.fighter`（外面個框）唔係 `.bspr`：
  張圖嗰個 `transform` 已經俾 `flip`（`scaleX(-1)`）／`lunge`／`hitshake`／
  `faintAnim` 佔晒，喺同一層加動畫就要為 flip 版再寫多一套 keyframes
  （`hs` / `hsf` 就係咁嚟嘅），改一樣嘢要郁兩處。
- **改 `.mapWrap` 個 `border`／`padding` 要一齊改 `fitMapMetrics`（v49）。**
  嗰度有個「地圖框自己食咗幾多高度」嘅數字（而家係 46），唔跟住改嘅話
  最底嗰層節點會俾 `overflow:hidden` 剪走，唔會報錯。
  順帶：層數欄（`MAP_GUT`）而家係畫布**入面**一條欄，唔再係用負數
  `left` 掛喺畫布外面 —— 掛出面就要靠「畫布擺中之後左右仲有位」，
  iPhone SE 一直剪走咗一大截。
- **`.arena.scene .bspr` 會蓋走後加嘅 `filter`（v49）。** 佢係三個 class，
  同 `.arena .bspr.charge` 打成平手，所以新規則一定要排喺佢**後面**，
  唔係個光就係唔出、又唔會報錯。
- **封面拆層（v50）：三層一定要用同一套 `background-position`／`background-size`。**
  唔好用 JS 計 cover 之後嘅縮放去擺角色 —— 一計就要跟住處理 resize、
  轉橫直屏、`#app` 嗰個 520px 上限，一有出入就見到隻寶可夢浮咗離地。
  三層共用同一句 CSS，點縮都自動對得返。實測靜止嗰陣同原版逐格比：
  最大差 59、超標像素 128／329160。
  ⚠ **角色層淨係郁得 `translateY`，唔可以加 `scale`。** 佢哋係成幅畫咁大
  （角色只係入面一忽），`scale` 嘅支點喺成層嘅中心唔係角色對腳，一縮
  就會見到隻嘢離地或者陷落石地。
  ⚠ **摳圖嘅 alpha 要外擴唔係收窄**（`splittitle.py` 入面有實測數字）。
- **主畫面三層 z-index 要企定（v49）**：底圖 0、遮罩同粒子 1、掣同文字 2。
  `#title>*` 嗰條會將**所有**仔仔扯上 z-index:2，所以底圖同粒子層要用
  specificity 高過佢嘅 `#title .titleBg` / `#title .titleFx` 壓返自己個層數。
  同樣咁，`.mapWrap:before`（暗罩）**唔可以落 z-index** —— 一浮上去就會
  蓋住 `.mapCanvas`（z-index:1）啲節點同連線，成幅地圖變晒灰。
- **裝飾用嘅隨機數一定要用 `Math.random()`，唔可以用 `rnd()`。**
  `rnd()` 行緊嘅係遊戲條 seeded RNG（`RNG`），攞佢嚟撒粒子／揀飛入方向
  就會扯亂骰面同 PvP 重播嘅結果。
- **Firebase session 係非同步還原。** `firebase.auth()` 之後即刻讀
  `currentUser` **一定係 null**，要等第一次 `onAuthStateChanged`。
  之前喺呢度直接讀，搞到每次冷啟動都開多個新匿名帳戶。
- **`board` 加欄位 = 要重貼規則**（見上面）。
- **`myNick()`**：匿名帳戶 `email` 係 `null`，唔可以直接 `.split('@')`。
- **平衡對數值極敏感**，尤其係傷害：魔鬼第 1 章 `dmg` 加 **0.01** 通關率跌 15 點。
  血量一次行 0.02-0.05、傷害 0.01-0.02，兩樣分開試。
- **郁一章會連帶影響之後幾章**（前面難咗，行得到後面嘅隊伍本身強啲）。
  要一次過睇齊八個數，唔好逐章追。
- **「無」系館主永遠唔會能量不足（階段 3 掘返出嚟）。** `payCost` 當「無」係
  萬用能量，而「無」系嘅招式成套 cost 都係「無」——**任何骰面都找得掂**。
  其他屬性嘅敵人成日擲唔夠色而放空，「無」系唔會，所以一個「無」系館主
  喺中段大約值 **-25 到 -30 點**通關率（城都第 3 館 30%、豐緣第 5 館 32%，
  館主場勝率 32% / 29%）。⚠ **擺「無」系道館落中後段之前要先諗定**
  （關都個「無」係第 1 館所以一直冇事），而家喺 `REGIONS[g].tune.hp` 補返。
- **凹位要分清楚係「館主」定「雜魚」先好調。** `measure.mjs`／`sweep.mjs` 有
  「館主場勝率」同「未見館主就死」兩欄（階段 3 加）。淨係睇通關率係分唔出嘅 ——
  階段 3 一開頭跟住計劃書估係 `TYPE_FOCUS` 太高，跑咗六組先證實估錯咗
  （focus 拉到 0 都淨係郁到 3 點）。
- **後面幾章樣本天生細**：6000 局先得 ~120 局行到第 8 館、~55 局行到四天王。
  跳 ±10 點係雜訊，唔好見到跌就即刻加返上去。
- **晶片池加長咗（`chipPoolOf`）**：原本 18 塊之後再接 6 塊雙屬性（index 18-23），
  爬塔獎勵淨係派呢批。加／減呢個數要同時改 `CHIP_EXT_N` 同 `validLoadout` 個上限 ——
  `validLoadout` 守住 `deserializeRun`，上限唔夠大嘅話新晶片一 reload
  就會**靜靜哋**被打回 `defaultLoadout()`，唔會報錯，玩家淨係見到骰組無故重置。
  經典模式嘅骰子工房照舊只用原本 18 塊，所以雲端骰組唔受影響。
- **「加咗招但冇人肯揀」（階段 4 差啲踩到）。** 揀邊招嘅地方本來有**四份**
  一模一樣嘅「攞 `faces[0]` 入面嗰個 `add`」：`enemyChoose`、`bestFour`、
  `monPowerScore`、同 `tools/simlib.js` 嘅 `playerChoose`。即係話除咗純加傷
  之外乜都當零分 —— 加個「反擊」或者「援護」落去，四邊都會當佢冇價值，
  永遠唔會出現喺任何一副牌，**而且唔會報錯、測試照過**。
  而家四邊一律借 `faceEV(mv, opp)`（`EV_W` 係唯一一份權重表）。
- **`PMV.util` 成組模板曾經係死嘅（階段 4 修好）。** `genPlayable` 生成 7 招
  之後寫 `moves[6] = 副屬性招`，即係最後嗰格 util 一出世就俾人踩咗 ——
  屏障／療愈／迴避／集氣四個模板由頭到尾冇一隻寶可夢攞得到，連「學新招」
  嘅獎勵都見唔到（`moveAdds` 拎緊同一條清單）。而家改成 `push`，每隻 8 招。
  ⚠ 存檔冇事：`serializeRun` 存嘅係**成個招式物件**，唔係喺呢條清單入面嘅索引。
- **加新招式模板 = 平衡一定要重量（階段 4 實測）。** 五個新模板 + util 出返街，
  三個世代嘅八個數**一齊升咗 6 點**（關都 68/68/59/58/67/61/62/60 →
  75/74/65/64/68/67/68/66）。升幅八章一樣＝玩家底盤強咗，所以修返係郁
  **曲線**（`TIER` 嘅 `hp0`/`hp1` 加 8%），唔係郁 `ACT_TUNE`
  （`ACT_TUNE` 要留返「逐章凹凸」個意思）。
- **敵人唔可以有 `x2`／`fail`。** 敵人嘅基本傷害已經乘咗成局倍率，
  champ 第 8 章 ×2 就係 320 傷、玩家先得 317 血 —— 一擊清枱。
  `tameAdd` 壓得住角色骰嗰下加成，**壓唔住 `x2`**（佢係乘埋基本傷害）。
  所以「賭命」淨係玩家有，`MV_T` 度冇；`test-moves.mjs` 守住。
- **`partyHeal` 唔可以令倒低咗嘅隊友翻生。** 同抗性遺物撞過嗰個坑一模一樣
  （`test-resist.mjs`）：補返一滴血就等於免費復活。`takeTurn` 嗰度用
  `m.hp>0` 隔走。另外經典 1v1 冇 `game.sides`，要 guard 住唔好炸。
- **角色骰唔見咗多數係能量不足**，唔係 bug。`takeTurn` 一定要喺失敗嗰條路
  都擲埋粒角色骰（標 `L.charVoid`）畀人睇，唔好靜靜哋唔畫 ——
  之前就係咁，玩家逐場捉都搵唔到邊個技能搞佢。
- **`tools/simlib.js` 要跟住遊戲改。** 佢自己重寫咗寶箱／商店／換人嗰幾段
  （`doChest`、`doShop`、`fight`）。遊戲嗰邊加咗新資源而佢冇跟，
  量出嚟嘅通關率就會偏低而且**唔會報錯**。能借用遊戲嘅 function 就借
  （`doChest` 而家直接叫 `pickLoot()`），唔好另寫一份。
  ⚠ 呢個唔算「改工具去遷就測試」—— 係令個模型追返遊戲。
- **模擬器捉唔到寶可夢**（冇 `catchOffer`），所以**神獸補正量唔到**。
  同理，任何淨係喺捕捉／進化分支度嘅嘢，`measure.mjs` 都睇唔到。
- **圖搬咗去 `assets/`（階段 0）。** 三件事要記住：
  **(1)** 換圖係改檔名嘅版本號（`scene-forest-v1.webp` → `-v2`），
  唔係改 `sw.js` 嘅 `ASSET_V` —— 加 `ASSET_V` 等於叫全世界重新落成 1.1MB 圖。
  **(2)** `SCENES` 入面而家係**檔案路徑唔係 base64**，所以 `sceneCSS`
  認高清定舊圖係睇副檔名（`.webp`），唔再係睇 base64 頭嗰幾個字 ——
  加新場景圖唔記得咗呢點，就會用錯 `background-size` 扯到變形。
  **(3)** `DEXSPR` 特登冇拆做逐隻檔案：幾百個索引拆開就係幾百個 request。
  加新世代嘅精靈圖要繼續塞落 `assets/dexspr-genN-vN.js`。

- **`DEX` 有 386 條，但一局只用一個世代。** 加任何「掃全個圖鑑」
  嘅 code 一定要行 `genPool()`／`inGen()`，唔好寫 `Object.values(DEX)`
  或者 `for(n=1;n<=386;n++)`。溝咗世代唔會報錯，通關率要到階段 3
  先量得返 —— 中間出咗事冇人知。`tools/test-dex.mjs` 逐個世代跑一次守住。

- **換世代一定要行 `setGen(g)`，唔好直接寫 `ACTIVE_GEN = g`（階段 2）。**
  `GYMS`／`ELITE4`／`CHAMPION`／`STARTERS`／`TYPE_FOCUS` 而家係 `let`，
  由 `setGen()` 一次過綁。淨係改 `ACTIVE_GEN` 就會出現「抽緊城都嘅寶可夢
  但撞到關都館主」，而且一個錯都唔會報。
  ⚠ 同一個原因：**`serializeRun`／`deserializeRun` 唔可以用 ambient `GYMS`**
  —— 存檔畫面同 PvP 會喺另一個世代度讀第二個世代嗰格，所以一律行
  `regionOf(run.gen).gyms`。`window.__rogue` 嗰邊亦都要用 getter，
  唔係工具攞到嘅永遠係開機嗰陣（關都）嗰份。

- **讀存檔／接返一局要 `setGen(run.gen)` + `await loadDexSpr()`。**
  淨係 `setGen` 冇落圖 = 成隊透明格；淨係落圖冇 `setGen` = 打錯世代嘅道館。

- **舊存檔冇 `gen` 欄位（v4）＝ 關都。** `SAVE_VER` 升到 5，但
  **`SAVE_MIN_VER` 照留 4** —— 升咗即係人哋玩緊嗰局俾剷走。

- **二三代嘅圖鑑資料唔好人手改。** `DEX_RAW` 同 `EVO` 152 之後嗰段夾喺
  `↓↓ … gendex.py 生成 …↑↑` marker 中間，`python3 tools/gendex.py apply`
  一重跑就冚唪唥覆蓋。要改屬性／階級就改 `gendex.py` 嗰兩條規則
  （`TYPE_RANK`、`stage_of`），跑埋 `check` 睇關都 151 隻對唔對得返。

- **19 條跨世代進化特登冇加**（大岩蛇→大鋼蛇、皮丘→皮卡丘嗰批）。
  加咗即係關都局會進化出城都寶可夢，撞正決定 2（三個池唔溝埋）。
  `python3 tools/gendex.py apply` 會列返出嚟。
  ⚠ **副作用（階段 2 處理咗）**：有 **8 隻** baby 喺自己世代 `s=1` 但
  永遠進化唔到（皮丘 172、皮寶寶 173、寶寶丁 174、迷唇娃 238、電擊怪 239、
  鴨嘴寶寶 240、露力麗 298、小果然 360 —— 計劃書寫 6 隻，漏咗 173/174）。
  老細揀咗 A：**開局三選一唔會出佢哋**（`DEAD_END_BASIC` / `canDraft()`），
  野外照撞得到、捉得到、圖鑑照有。⚠ 用嘅係計出嚟嘅規則
  （`s===1 && !EVO[n]`）唔係硬名單，所以 `gendex.py` 改咗進化鏈會自動跟。

- **精靈圖分咗三個檔，開機只落關都。** `loadDexSpr(gen)` 係遲載，
  所以 `dexURL()` 對未落到嗰啲會出返一個**透明** 1×1（唔係妙蛙種子 ——
  出返第一隻嘅話玩家會以為認錯咗隻）。新畫面用到城都豐緣嘅圖，
  記得 `await loadDexSpr(gen)` 先 render，唔係就一版透明格仔。
  ⚠ **一個畫面同時顯示幾個世代嘅隊伍**（三格存檔、排行榜、PvP 揀隊伍、
  對手嗰隊）就行 `await ensureSpr(dexList)` —— 佢會睇住要邊幾個世代先落。
  ⚠ 揀世代嗰個畫面**特登唔出圖**：出圖就要開機落埋城都豐緣嗰 500KB，
  階段 0／1 慳返嚟嘅開機時間就白慳。

- **`tools/simlib.js` 嘅 `draftParty()` 要跟住世代行。** 佢本來寫死
  `for(n=1;n<=151;n++)` + `isBasic()`，階段 2 改成 `DEX_GENS[ACTIVE_GEN]`
  + `canDraft()`。唔跟就等於量緊一個玩家玩唔到嘅池，而且唔會報錯。
  `measure(diff, N, gen)` 第三個參數換世代（自己會 `setGen` 返轉頭）。

- **加新資源（道具／券）要三個位一齊改**：`ITEMS`／`CHEST_LOOT`／`openShop`，
  加埋 `serializeRun` + `deserializeRun`（唔存＝reload 就靜靜哋唔見咗），
  同埋 `tools/simlib.js` 嘅 `doShop` / `doItems`（唔跟＝派咗出嚟冇人用，
  量出嚟嘅通關率偏低而且唔會報錯）。

- **魔鬼後半只有 `bossN` 郁得郁。** 行到第 5 館嘅魔鬼局得大約 2%，
  嗰批係最強嗰幾隊 —— 倖存者效應，所以 hp/dmg 倍率點加都推唔郁後半
  （實測後半 hp 加成 1.06-1.18，第 5 館 33→32，第 7 館就一嘢跌穿到 17）。
  真正有效係「館主帶第 4 隻」（`DIFFS[1].bossN`）。
  ⚠ 唔可以太早開：第 4 章就帶 4 隻，第 4 章跌到 13%（目標 25-40）。
- **魔鬼第 7-8 館量唔到**：10000 局淨返 ~30 / ~10 局。跳幾多都係雜訊，
  調嘢淨係睇第 1-6 館，唔好追第 7-8 館個數。

## 而家擺住未修

- **困難後半（第 5-8 館）出咗 band，但係刻意保留 —— 唔好修。**
  v41 加咗「打低對手一隻免費換人」同道具袋之後，由 57/47/55/40 升到
  **69/63/63/62**（目標 45-60 / 40-55 ×3）。頭四章冇郁、魔鬼喺雜訊範圍。
  問過老細，決定「就咁易啲」—— 呢兩個功能本身就係要加強續戰力，收返一半
  等於做咗當冇做。**見到呢幾個數高過 band 唔係 bug。**
  （真係要收返先睇 `tools/README.md`，三組候選數值已經量咗。）
  ⚠ 階段 3 之後，城都豐緣嘅後半一樣係 56-68 —— 特登**跟返關都嗰個鬆度**，
  三個世代同一個形狀，同樣唔好「修」。
- ⛔ **魔鬼模式而家封咗（`DIFFS[1].lock = '待更新'`），唔好校佢嘅平衡。**
  老細（2026-08）：現有嗰個逐個地區都有嘅魔鬼模式**會取消**，變成一次過打
  三個地區所有 boss 嗰個 24 館通天塔（三世代改版階段 5）——
  但**通天塔暫時唔做住**，所以個掣而家喺開局畫面出「待更新」、撳唔到。
  校佢＝校緊一個就嚟拆走嘅模式。豐緣魔鬼冇量過，亦都唔使量。
  `tools/README.md` 嗰兩節魔鬼數字淨係做歷史紀錄。
  ⚠ **封咗唔等於剷咗，亦都唔可以剷。** `DIFFS[1]` 要原封不動留住：
  舊存檔嘅 `run.diff===1` 接得返（`rgResume` 會 `DIFF=run.diff`），
  名人堂／排行榜／PvP 快照顯示嘅難度名照舊係「魔鬼」。
  剷走嗰行 = `clampDiff` 會靜靜哋當佢係「困難」，即係改咗人哋嘅歷史紀錄。
  `test-features.mjs` 七項守住呢個（撳唔到、開新局校返做困難、舊紀錄唔變樣）。
- **困難嗰邊三個世代都校好咗**（階段 3）。老細：「而家呢個平衡 OK，
  有道具、有戰鬥中換人已經加強咗策略性，出咗版再慢慢調。」
- 詳情同數據見 `tools/README.md` 最後幾節。
