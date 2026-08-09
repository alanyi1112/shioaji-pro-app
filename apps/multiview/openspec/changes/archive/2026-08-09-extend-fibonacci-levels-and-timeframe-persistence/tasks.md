## 1. 指定水準公式與相容資料

- [x] 1.1 在 `public/static/chart-annotations.js` 將回撤更新為十水準、拓展更新為八水準常數，維持既有公式與 anchors-only storage schema v3
- [x] 1.2 改以 Fibonacci 種類與穩定 ratio key 對應色彩／樣式，保留既有七個比率色彩，並加入回撤 `-0.62`、`-0.27` 與兩種類 `0.705` 固定色
- [x] 1.3 擴充 `tests/chart-annotations.test.mjs`，驗證上漲／下跌回撤、正負波段拓展、依種類水準順序、新比率標籤、非有限值與舊 v3 anchors restore

## 2. Overlay、匯出與價格尺度

- [x] 2.1 更新 `public/static/app.js` 與 `public/static/styles.css`，讓第一張圖依種類顯示回撤十線九帶或拓展八線七帶，第二張圖維持單色無色帶且不攔截圖表操作
- [x] 2.2 更新 completed extension autoscale，以八條有限水準的最低／最高值納入 helper，並讓 pending、clear、切換 identity、`intraday` 與 destroy 正確移除 helper
- [x] 2.3 更新完整 panel PNG 路徑與測試，確認畫面可見的回撤十線、拓展八線、標籤、波段虛線與第一張圖依種類產生的色帶皆被匯出，第二張圖無色帶
- [x] 2.4 新增密集圖、價格軸安全邊界、十線九帶／八線七帶 CSS／DOM 數量、彩色／單色完成順序及 latest-wins cleanup 測試

## 3. 時間級別保存與精準清除

- [x] 3.1 擴充 annotation controller，支援目前 symbol／interval 的 retracement 或 extension clear，以及目前 canonical symbol 所有 interval 的 Fibonacci clear
- [x] 3.2 安全枚舉 `quoteChart.annotations.v1` namespace，只移除匹配 symbol payload 的 Fibonacci 欄位，保留同 identity 的 `priceRange`、其他 symbol 與無關本機資料
- [x] 3.3 在 `public/static/index.html` 與 `public/static/app.js` 提供「清除回撤」、「清除拓展」、「全部清除」並保留價格範圍獨立清除能力；分種類操作只處理目前 interval
- [x] 3.4 加入 scoped 同頁 panel 清除事件與 generation 防護，使相同 symbol 的其他 interval panel 即時更新，不同 symbol、priceRange 與已 destroy panel 不受影響
- [x] 3.5 新增 interval 切換還原、`intraday` 隱藏／禁止建立、分種類清除、目前商品全 interval 清除、跨商品隔離及 priceRange 保留測試

## 4. 驗證與可見行為

- [x] 4.1 執行 `npm test`、`npm run lint` 與必要的 root governance 驗證，修正失敗且不擴大至 API、D1、Worker 或 realtime gateway
- [x] 4.2 在本機 MultiView 以至少兩個 symbol、兩個 K 線 interval 及同商品多 panel 驗證回撤十水準、拓展八水準、依種類產生的色帶、切換還原與目前商品全時間級別清除
- [x] 4.3 實際驗證 `intraday` 不顯示／建立費波那契、完整 panel PNG 包含新水準，且價格範圍、Pivot、Volume Profile、技術指標與其他商品資料維持不變
- [x] 4.4 依最新需求移除拓展的 `-0.62`、`-0.27`，保留回撤負比率，更新 autoscale、PNG／DOM 測試與規格並重新驗證
