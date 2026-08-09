## Context

MultiView 的 `chart-annotations.js` 已以 `canonical symbol + interval` 保存費波那契 anchors，restore 時重算水準；storage schema v3 同時承載該 identity 的 Fibonacci 與價格範圍資料。現行回撤與拓展各有七條水準，單一「清除繪圖」會處理目前 interval 的費波那契與價格範圍，無法表達分種類清除及「目前商品所有 interval」的清除範圍。

MultiView 可同頁顯示多個 panel，同一 symbol 可能同時出現在不同 interval；另有 `intraday` 分時模式，該模式既有契約是不顯示或建立費波那契。完整 panel PNG 會複製可見 SVG overlay，因此新增水準也必須進入匯出驗收。

## Goals / Non-Goals

**Goals:**

- 將回撤擴充為十條、拓展擴充為八條指定水準，維持與 RealTimeStock 主交易畫面相同公式與視覺角色。
- 讓第一張圖依種類顯示回撤十線九帶或拓展八線七帶，並讓 completed extension autoscale 包含全部八條拓展水準。
- 保留每個 symbol／interval 的完成圖，切換 interval 後切回可還原。
- 增加目前 interval 的分種類清除，並把「全部清除」定義為目前 symbol 所有 interval 的費波那契。
- 保留價格範圍、其他商品與其他圖表功能；同頁相同商品 panel 必須即時同步清除結果。
- 讓完整 panel PNG 與畫面顯示一致。

**Non-Goals:**

- 不讓 `intraday` 分時模式建立或顯示費波那契。
- 不改變 A／B／C 吸附、完成順序、彩色／單色角色或價格格式化規則。
- 不清除或改寫價格範圍、Pivot、Volume Profile、技術指標、個人偏好或其他 symbol 資料。
- 不新增 API、D1、Worker schema、外部行情依賴或交易功能。
- 不與根目錄 RealTimeStock 建立 runtime dependency。

## Decisions

### 1. 兩種類型使用各自固定水準常數

回撤固定為 `[-0.62, -0.27, 0, 0.236, 0.382, 0.5, 0.618, 0.705, 0.786, 1]`，依 `B - r × (B - A)` 計算；拓展固定為 `[0.618, 0.705, 0.786, 1, 1.272, 1.414, 1.618, 2]`，依 `C + r × (B - A)` 計算。storage 仍保存 anchors 而不保存衍生水準，因此現有合法資料可直接重算。

替代方案是升級 schema 並保存各種類的衍生價格；這會增加 migration，且衍生值可能與 anchors 分歧，因此不採用。

### 2. 以種類與比率決定色彩及 CSS class

既有七個比率依回撤／拓展原順序保留原七色色票；回撤新增的 `-0.62`、`-0.27` 與兩種類皆新增的 `0.705` 分別固定為 `#a78bfa`、`#e879f9`、`#f472b6`。renderer 不再假設 `levelIndex` 只有 0 至 6，而以穩定 ratio key 產生線、標籤與 band class。第一張圖依種類繪製回撤十線九帶或拓展八線七帶，第二張維持單色無色帶；PNG 匯出沿用 overlay clone，自然取得同一 DOM。

替代方案是新增 index 7 至 9 並按陣列位置套色；負比率插入前端會使舊水準顏色錯位，因此不採用。

### 3. 保持 storage schema v3，restore 時依種類自動取得水準

v3 已保存 `completed.fibonacci` 的 kind、anchors、order，足以依種類重建水準，因此不升版。restore 繼續接受既有合法版本並正規化為 v3；同 identity 的 `priceRange` 必須原樣保留。損毀項目只淘汰相應無效欄位，不發出 API 或 D1 寫入。

### 4. 拆分費波那契清除 scope，價格範圍維持獨立操作

annotation controller 增加：

- 目前 interval 的 `retracement` 與 `extension` kind clear。
- 目前 canonical symbol 的 `all-fibonacci-intervals` clear。

跨 interval 清除只枚舉 `quoteChart.annotations.v1` namespace，解析 key 的 symbol 與 interval 後刪除匹配項目的 `completed.fibonacci`；同一 payload 的 `priceRange` 存在時保留並重新寫回，沒有其他內容時才移除 key。不得使用 `localStorage.clear()`。原本價格範圍的清除能力保留為獨立操作，不混入費波那契「全部清除」。

### 5. 以 app 內 scoped event 同步同頁 panel

完成目前 symbol 的跨 interval 清除後，發布含 canonical symbol 與 generation 的 app 內事件。各 panel 只在 symbol 匹配時取消 Fibonacci pending、清除 completed／autoscale 並重繪；不同 symbol 與 priceRange 不處理。panel destroy 時移除 listener，舊 callback 以既有 generation/latest-wins 防護丟棄。

僅靠 localStorage `storage` event 無法通知同一 document，因此採用 app 內事件。事件不承載行情或個人資料。

### 6. `intraday` 只保存、不呈現

切換到 `intraday` 時取消 pending 並移除 Fibonacci overlay／helper，但不得刪除其他 interval 已保存完成圖；在 `intraday` 不提供啟動繪圖。切回 K 線 interval 後依該 symbol／interval restore。跨 interval 全部清除仍會處理目前 symbol 的所有已保存 K 線 interval。

### 7. completed extension autoscale 使用八水準極值

autoscale helper 取 completed extension 八條有限價格的最低與最高值，不納入 `-0.62`、`-0.27`。pending 不參與 autoscale；清除、換 symbol／interval、進入 `intraday` 或 destroy 時移除 helper。

## Risks / Trade-offs

- [回撤十線九帶與拓展八線七帶增加視覺密度] → 維持 1 CSS px、低透明度色帶、左側標籤與第二張單色無色帶，並做密集圖實際驗收。
- [跨 interval 枚舉誤傷其他 symbol 或 priceRange] → 限定 app namespace、結構化解析 key，只刪除匹配 symbol 的 Fibonacci 欄位。
- [多 panel 收到清除事件後舊排程重畫] → 事件遞增 generation，listener 與 renderer 沿用 latest-wins，destroy 時移除 listener。
- [拓展水準使價格軸範圍擴大] → 只讓 completed extension 的有限極值參與 autoscale，pending 與 retracement 不新增 helper。
- [舊版 CSS 只支援七個 index] → 改為 ratio key 並以單元測試依種類斷言十線九帶、八線七帶與新比率 class，避免漏樣式。

## Migration Plan

1. 先擴充公式 fixture、色彩與依種類水準／色帶測試。
2. 更新 renderer、CSS、autoscale 與 PNG 匯出測試，確認 v3 舊 anchors 可重算。
3. 拆分目前 interval 分種類清除與目前 symbol 全 interval 清除，保留 priceRange 清除入口。
4. 加入同頁 panel scoped event、cleanup 與 `intraday` 回歸測試。
5. 執行測試、build，並在 MultiView 實際切換 symbol／interval、同商品多 panel 及儲存圖片驗收。若需回退，v3 anchors schema 未變，不需資料回滾。

## Open Questions

無；「全部清除」的商品範圍已確認為目前商品的所有時間級別。
