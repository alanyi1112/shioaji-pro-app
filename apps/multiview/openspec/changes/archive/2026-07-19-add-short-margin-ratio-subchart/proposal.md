## Why

目前籌碼副圖已分別顯示融資與融券，但使用者仍需自行換算兩者相對規模，無法直接觀察市場常用的券資比趨勢。現有 `margin-short` 日資料已同時提供同日融券餘額與融資餘額，適合新增可驗證且不增加上游負擔的衍生副圖。

## What Changes

- 新增獨立「券資比」籌碼副圖，供方式 A 單一副圖及方式 B 多層副圖選取，預設不自動啟用，避免改變既有頁面高度與個人選擇。
- 以同一交易日的 `shortTodayBalanceLots / marginTodayBalanceLots × 100` 計算券資比；融資餘額為 0、任一欄位缺漏、負值或非有限值時顯示無資料，不補 0、不沿用其他日期，也不產生無限值。
- 預設繪製券資比百分比線，右鍵「線圖項目」可另選日變化柱；標題列顯示日期、券資比、相對前一個有合法資料交易日的日變化、融券餘額、融資餘額與來源。
- 沿用既有 `margin-short` payload、request cache、availability、回補入口、共用十字線、時間範圍、右側數值軸、readout 換行及名稱／數值分離套色，不新增 API、D1 schema 或資料來源。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `taiwan-stock-chip-subcharts`: 增加券資比 pane 的公式、缺值語意、線圖／日變化柱、標題列讀值、選取及互動需求。

## Impact

- 前端：`public/static/chip-panes.js` 的 pane registry、series 定義、readout 與圖表繪製，以及必要的靜態資產版本。
- 測試：券資比公式與缺值純函式、pane registry／selection、右鍵 series、百分比尺度、readout 與正式站 UI 驗收。
- 資料與 API：只讀取既有 `margin-short` 正規化欄位與 provenance；不變更 Worker response、D1、上游頻率、回補範圍或 secrets。
