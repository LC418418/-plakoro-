# POKE TOWER — 俾 Claude 睇嘅開發筆記

一個單檔網頁遊戲（寶可夢風格嘅骰子對戰 + 爬塔）。同事之間玩，host 喺
GitHub Pages（`lc418418.github.io/-plakoro-/`），後端用 Firebase。

**用廣東話（書面粵語）同用家傾偈同寫註解。**

---

## ⚠ 開頭一定要知：`index.html` 好大，唔好亂讀

成個遊戲喺一個 `index.html` 入面，**6,200+ 行**，而且入面塞咗一大堆
base64 圖（背景、地圖底圖、節點圖示）。有幾個 trap：

- **唔好 `cat index.html`、唔好 `Read` 成個檔**。
- **唔好 grep 到 base64 嗰幾行**。例如 `grep -n "const SCENES"` 會 dump 728KB。
  真係要搵嗰啲行就加 `| cut -c1-120`。
- 正確做法：**用 `grep -n` 搵常數／function 名攞行號，再 `Read` 嗰 30-60 行**。
  下面有成張地圖，多數情況唔使摸黑搵。

---

## 檔案地圖

| 檔案 | 做咩 |
|---|---|
| `index.html` | **成個遊戲**（畫面、規則、數值、圖片全部喺入面） |
| `sw.js` | Service worker，network-first。⚠ 出版要將 `poketower-vXX` 加一 |
| `manifest.webmanifest` | PWA。玩家多數係 iOS「加到主畫面」咁玩 |
| `database.rules.json` | Firebase 權限規則。⚠ **改完要人手去 Console 貼上去**，唔會自動生效 |
| `docs/八館改版計劃.md` | 四章→八館改版嘅交接文件，三個階段都做完 |
| `docs/匿名登入設定.md` | 匿名登入／綁定嘅設計 + Firebase Console 要做嘅嘢 |
| `tools/` | 平衡模擬器 + 回歸測試（**唔屬於遊戲本體**，玩家見唔到） |

## `index.html` 分區（`<script>` 逐個 block）

| 大概行 | 內容 |
|---|---|
| ~947 | Plakoro 卡表資料（官方 12 隻） |
| ~1291 | 能量骰／晶片資料 |
| ~1398 | 關都 151 隻圖鑑 `DEX` |
| ~1506 | 進化鏈 |
| ~1602 | 151 隻嘅招式／骰組生成器 |
| ~1797 | **規則引擎**（`takeTurn`、`payCost`、傷害結算） |
| ~2042 | 出招特效 |
| ~2167 | **Firebase**：帳戶、匿名登入、綁定、新手引導、線上房 |
| ~2549 | 介面共用（`show`、`sheetOpen`、`toast`、`esc`） |
| ~3257 | **爬塔邏輯**（`TIER`、`ACT_TUNE`、`genMap`、`buildEnemy`、獎勵） |
| ~4148 | 爬塔存檔 + 戰力 + PvP 快照 |
| ~4510 | 爬塔 PvP 引擎 |
| ~4596 | **爬塔介面**（地圖、戰鬥、獎勵、商店、結算） |
| ~5757 | **道具袋** `ITEMS` + `openItems`（寶箱／商店拎到，地圖同四天王用） |
| ~5988 | **排行榜 + 管理員** |
| ~6474 | 爬塔隊伍 PvP 介面 |

---

## 主要旋鈕（`grep -n "^const XXX"` 搵得返）

**結構**：`ACTS`（8 個道館）、`MAP_ROWS`（每館 6 關）、`BATTLE_ROWS`、
`ACTIVE_N`（出戰 3）、`PARTY_MAX`（全隊 6）、`RELIC_MAX`（遺物 8）

**平衡**：`TIER`、`ACT_TUNE`、`DIFFS`、`BADGE_HP`、`EVO_WINS`、
`MOB_RELIC_CHANCE`、`CHEST_RELIC_CHANCE`、`TYPE_FOCUS`

> ⚠ **敵人強度唔再係數字表。** 每個 tier 只寫 4 個端點
> （`hp0` `hp1` `nm0` `nm1`），中間幾何內插 `起點 × (終點÷起點)^(a/7)`；
> `ACT_TUNE` 係兩行 8 格嘅逐章微調。**唔好返去寫死逐章數字表。**
> `TIER.gym.hp` 係**成隊總血量**，`genMon` 再除 `gymTeamN(a)`。
> `TIER.e4` / `TIER.champ` 標咗 `flat:true` ＝ 唔食 `ACT_TUNE`。

**內容**：`GYMS`（八個道館，次序就係章節次序，`team` 有 4 隻但第 4 隻淨係
魔鬼後半出）、`ELITE4`、`CHAMPION`、`RELICS`、`MV_T`（10 個招式模板）、
`CHEST_LOOT`（寶箱唔中遺物嗰陣派邊款消耗品）、`ITEMS`（道具袋三款）

---

## 資料 schema

**localStorage**（冇帳戶都有）
```
plakoro.run.0-2     三格挑戰進度
plakoro.slot        最近玩嗰格
plakoro.hof.0-2     三格名人堂
plakoro.loadouts    骰組
plakoro.best.<uid>  「歷來最遠」本機鏡像（保命用，見下面排行榜嗰段）
plakoro.onb.nick / plakoro.onb.bind   新手引導問過未
```

**Firebase RTDB**
```
users/<uid>/profile    { nick, created, wins, losses, auto }
                       auto:true = 個名係系統生成，仲未問過本人
users/<uid>/runs/0-2   雲端存檔（同 localStorage 對開，新嗰份行先）
users/<uid>/teams/0-2  名人堂
users/<uid>/loadouts   骰組
users/<uid>/pvp        PvP 勝負統計
users/<uid>/rogue      { runs, wins, best, bestFloor, bestBadges,
                         bestTeam, bestPower, bestDiff }
board/<uid>            公開摘要（排行榜）
admins/<uid>           管理員名單，客戶端寫唔到
rooms/<code>           線上對戰房
```

⚠ **`board` 嘅規則有 `$other: false`** —— 加新欄位一定要同時改
`database.rules.json` **並且去 Console 重新貼**，唔係成個寫入會俾人拒絕，
而且**唔會報錯，個名就係唔更新**。

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
node tools/test-features.mjs     # 53 項：遺物上限／特訓／四天王補給／傷害尾巴／
                                 #        道具袋／敵人倒下免費換人／四天王換人
node tools/test-resist.mjs       # 抗性遺物唔可以令倒下嘅寶可夢翻生
node tools/test-auth.mjs         # 36 項：匿名登入／問名／綁定／排行榜進度／通關唔會被踩低
node tools/measure.mjs 3000 0    # 量通關率（0 困難、1 魔鬼）
N=3000 node tools/sweep.mjs '[{"actTune":{"hp":[...]}}]'
```

**改完平衡或者 Firebase／排行榜邏輯，三個 test 都要跑。**

模擬器跑幾多局**完全唔影響 usage**（返嚟都係同一舊細 JSON），所以
一次 sweep 塞多幾組設定去試，唔好一次試兩三組。局數 3000 起跳。

`tools/fbstub.js` 係假 Firebase（記憶體 RTDB + auth），`test-auth.mjs` 用，
**唔會連真 project**。佢特登模擬「session 非同步還原」，唔好改細咗。

---

## 改嘢嘅規矩

1. **出版一定要 `sw.js` 加版本號**，唔係玩家收唔到新版。
2. **GitHub Pages 派 `main`。** 喺 branch 做完記得 merge 返落 `main`
   （撞過：喺 branch 做完冇 merge，玩家一直行緊舊 code）。
3. **註解寫「點解」，唔係「做乜」**，用廣東話。呢個 codebase 通篇都係咁，
   而且啲註解記低咗好多踩過嘅坑，跟返個風格。
4. 改到平衡就要跑 `measure.mjs` 對返目標（見 `tools/README.md`）。
5. 唔好改 `tools/` 入面啲嘢去遷就測試 —— 要改就改個真 bug。

---

## 踩過嘅坑（唔好再踩）

- **Firebase session 係非同步還原。** `firebase.auth()` 之後即刻讀
  `currentUser` **一定係 null**，要等第一次 `onAuthStateChanged`。
  之前喺呢度直接讀，搞到每次冷啟動都開多個新匿名帳戶。
- **`board` 加欄位 = 要重貼規則**（見上面）。
- **`myNick()`**：匿名帳戶 `email` 係 `null`，唔可以直接 `.split('@')`。
- **平衡對數值極敏感**，尤其係傷害：魔鬼第 1 章 `dmg` 加 **0.01** 通關率跌 15 點。
  血量一次行 0.02-0.05、傷害 0.01-0.02，兩樣分開試。
- **郁一章會連帶影響之後幾章**（前面難咗，行得到後面嘅隊伍本身強啲）。
  要一次過睇齊八個數，唔好逐章追。
- **後面幾章樣本天生細**：6000 局先得 ~120 局行到第 8 館、~55 局行到四天王。
  跳 ±10 點係雜訊，唔好見到跌就即刻加返上去。
- **晶片池加長咗（`chipPoolOf`）**：原本 18 塊之後再接 6 塊雙屬性（index 18-23），
  爬塔獎勵淨係派呢批。加／減呢個數要同時改 `CHIP_EXT_N` 同 `validLoadout` 個上限 ——
  `validLoadout` 守住 `deserializeRun`，上限唔夠大嘅話新晶片一 reload
  就會**靜靜哋**被打回 `defaultLoadout()`，唔會報錯，玩家淨係見到骰組無故重置。
  經典模式嘅骰子工房照舊只用原本 18 塊，所以雲端骰組唔受影響。
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
- 詳情同數據見 `tools/README.md` 最後三節。
