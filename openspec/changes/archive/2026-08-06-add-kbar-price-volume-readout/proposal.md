## Why

目前 K 線圖的左上角 legend 只會回報已加入技術指標的數值，使用者無法直接從滑鼠所在 K 棒確認該時段的開、高、低、收與成交量；右上角行情摘要又只代表最新報價，不能代替歷史 K 棒讀值。需要提供一個可選、可移除且不產生額外圖線的主圖價量 readout，讓歷史與形成中 K 棒的資料語意清楚可辨。

## What Changes

- 在技術指標選擇器的「主圖疊加」新增「K 棒價量」項目，但以 readout 呈現，不新增圖線、價格軸標籤或副圖。
- 啟用後，readout 固定排在主圖左上角所有顯示數值的最上方，第一欄顯示滑鼠所在 K 棒的時間區間，後續依序顯示開、高、低、收與量。
- 游標位於尚未收線的最新 K 棒時，第四個價格欄位改標示為「最新」；游標離開 K 棒或位於未對應資料的空白區時，回到最新一根可用 K 棒。
- 時間區間使用圖表既有的台灣市場時間語意，日內 K 顯示開始至結束分鐘，跨日或 1D K 額外顯示日期，避免不同交易日混淆。
- 日內圖相鄰 K 棒的台灣顯示日期改變時，在兩日交界加上一條較一般垂直格線粗的跨日分隔線，並讓主圖與副圖使用相同邊界位置。
- 「K 棒價量」限制為單一實例，可隱藏、移除並設定適用時框，但不得複製或移入一般技術指標排序；其固定置頂不改寫其他指標的持久化順序。
- readout 僅使用目前圖表已載入並聚合完成的 canonical OHLCV，不新增 API、外部資料來源或交易能力。

## Capabilities

### New Capabilities

- `kbar-price-volume-readout`: 定義 K 棒時間區間、OHLCV 游標 readout、跨日粗分隔線、形成中／已收線語意、固定置頂、單一實例、多圖隔離與無資料降級規則。

### Modified Capabilities

無。

## Impact

- 主要程式：`src/components/candle-chart.tsx`、`src/components/indicator-dialog.tsx`、`src/components/candle-chart.css.ts`、`src/lib/indicator-defs.ts`、跨日 pane primitive 與相關測試。
- 指標模型：需支援不建立 lightweight-charts series 的受控 readout definition，並限制此類型的加入、複製與排序行為。
- 圖表資料：沿用 `barsRef`、crosshair time、現有時框聚合結果與 current-bar 更新，不變更 Shioaji HTTP API／SSE contract。
- 安全與環境：不接觸帳務、委託或 production 權限；browser-visible 驗收使用 simulation。
