## Why

RealTimeStock 目前沒有費波那契繪圖工具；使用者提供的 `MultiChartOnCodexSite` 已具備可驗證的費波那契回撤與拓展公式、錨點吸附、待選價位導引、預覽、雙圖共存、保存及重繪契約。2026-08-06 重新核對 GitHub 遠端 refs 後，預設 `main` 仍為 `2d09253f710de1126a0ca841bfb0645125b2ed31`，但較新的可驗證工作版本為 `ecae7cac837f06085801c96f3da0c570051d66e7`；兩版 `public/static/chart-annotations.js` 與正式 Fibonacci spec blob 相同，而新版 `public/static/app.js` 已補上 active panel、generation 與排程清理防護。因此本 change 固定以 `ecae7ca` 為完整參考基準。這些功能不是一般 OHLCV 自動指標，若直接塞入 indicator instance renderer，會混淆使用者選點狀態與圖表下單 click。需要在已歸檔的 `integrate-multichart-technical-indicators` stable overlay 基礎後，以獨立 change 安全整合。

## What Changes

- 在每個 `CandleChart` 提供獨立的「費波那契回撤」與「費波那契拓展」繪圖工具，預設皆未啟動。
- 回撤使用 A／B 兩點及 0、0.236、0.382、0.5、0.618、0.786、1；拓展使用 A／B／C 三點及 0.618、0.786、1、1.272、1.414、1.618、2，公式與來源 repo 一致。
- 一般點選時 A 吸附所點 K 棒 low、B 吸附 high、拓展 C 有 K 棒時吸附 low；按住 macOS Option 或 Windows Alt 時使用游標自由價位。
- 支援下一錨點即時預覽、`待選 A／B／C｜價格` 全寬價位導引、剩餘點數、Escape 取消、清除完成圖，以及同一商品／時框各保留一張回撤與一張拓展。
- 選點期間暫時隱藏主圖價格折線的原生實心 crosshair marker；未固定 preview 使用 10 CSS px、1 CSS px 線寬的小型十字，固定／完成錨點使用半徑 4 CSS px 的透明空心圓，結束選點後還原原設定。
- 沿用來源 repo 的完成順序呈現：較早完成者使用分級彩色與半透明區間色帶，較晚完成者使用一致單色且不顯示色帶。
- 完成圖依 canonical contract identity 與 timeframe 保存於 localStorage；暫態選點不保存，換商品、換時框、重載、縮放、平移及 resize 後必須安全還原與對齊。
- 建立明確輸入優先權：啟動費波那契時強制回到游標觀察模式；切換到點價買賣、停損、停利或警示模式時取消 pending 繪圖，任何 pending pointer move／click 不得同步點價、送單或建立警示。
- pending preview 完全不參與 autoscale；只有完成的拓展可用有界透明 helper 納入最低／最高水準。所有排程重繪都必須驗證目前 chart identity、panel instance generation 與仍存活的 panel。
- 增加公式、controller、storage、錨點吸附、交易安全、SVG overlay、autoscale、多圖隔離與本機可見行為測試。

## Capabilities

### New Capabilities

- `main-chart-fibonacci-tools`: 定義 RealTimeStock 主圖費波那契回撤與拓展的公式、選點、視覺、保存、重繪、多圖隔離及交易點擊安全契約。

### Modified Capabilities

- 無。

## Impact

- 前置 change：已歸檔的 `integrate-multichart-technical-indicators`，重用其 stable overlay lifecycle、latest-wins scheduler 與 generation guard；本 change 不重做技術指標公式或 pane store。
- 主要程式：預計新增純函式 annotation controller／storage／renderer，並調整 `src/components/candle-chart.tsx`、對應樣式與測試。
- 資料：只使用目前圖表的 Shioaji OHLCV 與瀏覽器座標，不新增 API、遠端資料庫、Worker、D1、Cloudflare、production 登入或下單路徑。
- 安全：繪圖只能在游標觀察模式消耗 pointer move／click；不得略過既有交易風險檢查，也不得將帳號、API key、token、憑證或完整市場資料寫入註記 storage／log。
- 明確不納入：價格範圍、固定區間 Volume Profile、任意趨勢線、週線／月線時框、跨裝置同步及通用圖表 PNG 匯出。RealTimeStock 目前沒有通用 panel 匯出流程，若未來加入，必須另行要求將可見費波那契 SVG 合成進匯出結果。
