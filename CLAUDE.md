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
| ~918 | Plakoro 卡表資料（官方 12 隻） |
| ~1262 | 能量骰／晶片資料 |
| ~1328 | 關都 151 隻圖鑑 `DEX` |
| ~1436 | 進化鏈 |
| ~1532 | 151 隻嘅招式／骰組生成器 |
| ~1727 | **規則引擎**（`takeTurn`、`payCost`、傷害結算） |
| ~1961 | 出招特效 |
| ~2086 | **Firebase**：帳戶、匿名登入、綁定、新手引導、線上房 |
| ~2458 | 介面共用（`show`、`sheetOpen`、`toast`、`esc`） |
| ~3160 | **爬塔邏輯**（`TIER`、`ACT_TUNE`、`genMap`、`buildEnemy`、獎勵） |
| ~4003 | 爬塔存檔 + 戰力 + PvP 快照 |
| ~4351 | 爬塔 PvP 引擎 |
| ~4437 | **爬塔介面**（地圖、戰鬥、獎勵、商店、結算） |
| ~5529 | **排行榜 + 管理員** |
| ~5941 | 爬塔隊伍 PvP 介面 |

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

**內容**：`GYMS`（八個道館，次序就係章節次序）、`ELITE4`、`CHAMPION`、
`RELICS`、`MV_T`（10 個招式模板）

---

## 資料 schema

**localStorage**（冇帳戶都有）
```
plakoro.run.0-2     三格挑戰進度
plakoro.slot        最近玩嗰格
plakoro.hof.0-2     三格名人堂
plakoro.loadouts    骰組
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

---

## 點跑測試

```bash
cd tools && npm install          # 第一次先要
node tools/test-features.mjs     # 31 項：遺物上限／特訓／四天王補給／傷害尾巴
node tools/test-resist.mjs       # 抗性遺物唔可以令倒下嘅寶可夢翻生
node tools/test-auth.mjs         # 31 項：匿名登入／問名／綁定／排行榜進度
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

## 而家擺住未修

- **魔鬼難度後半仲係太鬆**（實測 70/57/64/47，目標 20-35）。
  再加倍率冇用 —— 行到第 5 館嘅魔鬼局得大約 2%，係倖存者效應。
  要修就要改結構（例如館主帶第 4 隻）。冇乜人打魔鬼，所以擺住。
- 詳情同數據見 `tools/README.md` 最後兩節。
