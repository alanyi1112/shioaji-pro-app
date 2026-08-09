## Context

RealTimeStock 主交易畫面的費波那契 controller 已以 `security_type + exchange + canonical contract code + timeframe` 作為 identity，完成圖只保存種類、錨點與完成順序，水準價格則於 restore 時重算。現行回撤與拓展各有七條水準；分種類清除與「全部清除」都只處理目前 identity。這使新增水準本身不需要保存更多衍生資料，但「全部清除目前商品所有時間級別」需要把商品 identity 與 timeframe identity 分開處理，並通知同頁其他已掛載圖表更新。

本變更須與 `apps/multiview` 的同名 OpenSpec change 保持公式、比率、視覺角色與清除語意一致，但兩個 app 不建立 runtime dependency。既有 Shioaji 行情、交易模式、錨點吸附及多圖 latest-wins 防護均屬既有安全邊界。

## Goals / Non-Goals

**Goals:**

- 將回撤擴充為十條、拓展擴充為八條指定水準，並維持既有公式。
- 讓新水準參與標籤、第一張彩色圖、依種類產生的相鄰色帶及 completed extension autoscale。
- 切換時間級別時保留原級別完成圖，切回後精確還原。
- 讓分種類清除只作用於目前商品、目前時間級別；讓「全部清除」只作用於目前商品的所有時間級別。
- 安全遷移既有 v1 anchors，不因公式版本更新遺失使用者完成圖。
- 同頁多圖顯示同一商品時，跨時間級別全部清除後立即反映，不留下過期 overlay。

**Non-Goals:**

- 不改變錨點 A／B／C 的吸附、自由價位、preview 或完成順序規則。
- 不清除其他商品、價格範圍、Pivot、Volume Profile、主副圖指標、委託線或交易狀態。
- 不改變 Shioaji API、行情資料、simulation／production 邊界或下單流程。
- 不把 `apps/multiview` 程式碼抽成共用套件，也不加入外部依賴。

## Decisions

### 1. 水準使用固定有序常數，衍生價格不進 storage

回撤固定順序為 `[-0.62, -0.27, 0, 0.236, 0.382, 0.5, 0.618, 0.705, 0.786, 1]`；拓展固定順序為 `[0.618, 0.705, 0.786, 1, 1.272, 1.414, 1.618, 2]`。公式維持回撤 `B - r × (B - A)`、拓展 `C + r × (B - A)`。storage 繼續只保存 canonical anchors 與 order，避免保存的衍生價格與新版公式分歧。

替代方案是把各種類的衍生價格一併保存；這會增加 migration 與資料不一致風險，因此不採用。

### 2. 顏色改以「種類＋比率」映射，不再直接依陣列索引

第一張圖的既有七個比率，依各種類舊有順序保留既有色票 `#fb7185`、`#fb923c`、`#facc15`、`#84cc16`、`#2dd4bf`、`#22d3ee`、`#818cf8`；回撤新增的 `-0.62`、`-0.27` 與兩種類皆新增的 `0.705` 分別使用固定色 `#a78bfa`、`#e879f9`、`#f472b6`。以種類與比率查色可避免新增比率後，既有線條顏色整體錯位。

第一張完成圖依種類顯示回撤十條或拓展八條彩色線，並依畫面價格順序分別建立九個或七個半透明色帶；第二張維持 `#cbd5e1` 單色且不顯示色帶。標籤文字與線型仍提供非純顏色辨識。

替代方案是使用新的十色索引陣列；雖較簡單，但會改變既有比率的視覺記憶，因此不採用。

### 3. formula version 升為 v2，讀取時遷移 v1 anchors

新完成圖以可追溯的 `multichart-ecae7ca-fibonacci-v2` 計算。restore parser 同時接受合法 v1 與 v2 payload；v1 只取其 canonical anchors、kind 與 order，以 v2 依種類重算後覆寫為 v2。無效或非有限 anchors 仍只淘汰該 identity，不影響其他 identity。

替代方案是沿用 v1 名稱，會無法辨識舊七水準與新版依種類水準 fixture；直接拒絕 v1 則會遺失使用者繪圖，兩者皆不採用。

### 4. 清除 API 明確區分目前 identity 與目前商品

controller 將提供兩種 scope：

- `current-timeframe`：只修改目前完整 identity，用於「清除回撤」與「清除拓展」。
- `current-product-all-timeframes`：以不含 timeframe 的 canonical product identity，枚舉 app 自有 storage namespace，僅刪除匹配商品的回撤與拓展 payload，用於「全部清除」。

實作不得呼叫 `localStorage.clear()`，也不得使用模糊字串包含判斷；每個 key 必須通過 namespace 與結構化 identity 解析。記憶體快取亦以同一 product matcher 清除。其他商品與非費波那契資料保持不變。

替代方案是維持「全部清除」只處理目前 timeframe，與已確認需求不符；清空整個 namespace 則會誤傷其他商品，因此不採用。

### 5. 以模組內事件同步同頁已掛載圖表

跨時間級別全部清除完成後，controller 會發布只含 canonical product identity 與清除 generation 的內部事件。每個已掛載 `CandleChart` 只在自身商品匹配時取消 pending、清除 completed／autoscale helper 並進行 latest-wins 重繪；不同商品忽略事件。listener 在 unmount 時移除。

同一頁的 `storage` 事件不會回送到發出寫入的 document，因此單靠 localStorage 不足。模組內事件不含行情、帳戶或交易資料，且不形成跨 app dependency。

### 6. autoscale 只納入完成拓展的八條水準

completed extension helper 取八條有限水準的全域最低與最高價格，不納入 `-0.62`、`-0.27`。pending preview 仍不得驅動 autoscale。切換 identity、清除拓展、全部清除或 unmount 時都必須移除 helper。

## Risks / Trade-offs

- [拓展水準令價格軸範圍擴大] → 只讓 completed extension 參與 autoscale，pending 不參與，並以八條水準的有限最小／最大值為界。
- [storage 枚舉誤刪其他商品] → 只掃描 app 自有 prefix，解析完整 product identity 後比對，不使用前綴猜測或全域清除。
- [同頁多圖清除後舊 callback 重建 overlay] → 清除事件遞增 generation，沿用 `identity + panelInstanceId + generation` latest-wins 驗證。
- [新增色彩在密集圖中不易辨識] → 保留比率／價格文字、實線／虛線、彩色／單色角色，依種類測試十線九帶或八線七帶，不以顏色作唯一識別。
- [v1 migration 寫回失敗] → 目前 session 保留合法記憶體圖並顯示既有安全提示，不影響主圖與交易功能。

## Migration Plan

1. 先加入 v2 依種類水準 fixture、種類／比率色彩映射及公式測試。
2. 擴充 restore parser 接受 v1 anchors 並以 v2 重算、寫回；保留現有 storage key 以便找到舊資料。
3. 更新 overlay 與 autoscale，再加入 current-timeframe 及 current-product-all-timeframes 清除 API。
4. 加入同頁圖表同步事件及 cleanup，最後更新 UI 操作與回歸測試。
5. 以單元測試、build 與實際主畫面切換商品／時間級別驗收；失敗時可回退程式碼，v2 payload 因仍保存相同 anchors，可由相容 parser 還原。

## Open Questions

無；「全部清除」的商品範圍已確認為目前商品的所有時間級別。
