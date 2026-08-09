## 1. 指定水準公式與資料遷移

- [x] 1.1 在 `src/lib/fibonacci-annotations.ts` 將回撤更新為十水準、拓展更新為八水準常數，維持既有公式、比率與價格格式，並將 fixture version 升為 `multichart-ecae7ca-fibonacci-v2`
- [x] 1.2 擴充 restore／validation，讓合法 v1 kind、anchors、order 以 v2 依種類重算及寫回，並維持損毀 identity 隔離與保存失敗提示
- [x] 1.3 更新 `src/lib/fibonacci-annotations.test.ts`，覆蓋上漲／下跌回撤、正負波段拓展、回撤負比率、0.705、非有限值及 v1-to-v2 migration

## 2. Overlay、色彩與價格尺度

- [x] 2.1 在資料模型與 renderer 改用「Fibonacci 種類＋比率」色彩映射，保留各種類既有七個比率色彩，並加入回撤負比率與兩種類 0.705 的固定色
- [x] 2.2 更新 `src/lib/fibonacci-overlay.ts`、`src/components/fibonacci-overlay.tsx` 與必要樣式，使第一張圖依種類產生回撤十線九帶或拓展八線七帶、第二張圖維持單色無色帶，並保留標籤與 pointer 安全邊界
- [x] 2.3 更新 completed extension autoscale，以八條有限水準的最低／最高值納入 helper，並確認 pending、clear、identity change 與 unmount 不留下 helper
- [x] 2.4 擴充 overlay 單元與元件測試，驗證回撤十線九帶、拓展八線七帶、新比率顏色、彩色／單色完成順序、拓展 autoscale 及 latest-wins cleanup

## 3. 時間級別保存與精準清除

- [x] 3.1 將 controller 清除 API 分成目前 identity 的 kind clear 與目前 canonical 商品所有 timeframe 的 Fibonacci clear，安全枚舉 app namespace 並同步清除匹配記憶體快取
- [x] 3.2 加入 scoped 同頁事件與 generation 防護，讓顯示同一商品的已掛載 `CandleChart` 即時清除，不同商品與卸載 panel 不受影響
- [x] 3.3 更新 `src/components/candle-chart.tsx` 的「清除回撤」、「清除拓展」、「全部清除」接線，確認前兩者只處理目前 timeframe、後者只處理目前商品所有 timeframe
- [x] 3.4 新增切換 timeframe 後還原、分種類清除、同商品跨 timeframe 全部清除、跨商品隔離，以及不影響價格範圍／Pivot／Volume Profile／指標／委託與交易狀態的測試

## 4. 驗證與可見行為

- [x] 4.1 執行費波那契相關 Vitest、完整 `pnpm test` 與 `pnpm build`，修正失敗且不擴大至無關功能
- [x] 4.2 在本機主交易畫面驗收回撤十條線、拓展八條線、0.705、回撤兩條負比率、依種類產生的色帶、autoscale、時間級別切換還原及目前商品全時間級別清除
- [x] 4.3 以至少兩個商品及兩個時間級別驗證隔離，並確認繪圖操作未呼叫下單、觸價或其他交易副作用
- [x] 4.4 依最新需求移除拓展的 `-0.62`、`-0.27`，保留回撤負比率，更新 autoscale、測試與規格並重新驗證
