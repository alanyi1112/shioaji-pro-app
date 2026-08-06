## Why

TDCC 大戶與散戶副圖目前把級距說明、張數、人數、來源、提醒與頻率全部放在標題列，資料完整時會占用多列高度並壓縮線圖。使用者需要預設只看關鍵讀值，並在需要時透過既有右鍵功能表查看完整明細。

## What Changes

- 將大戶與散戶副圖標題精簡為名稱、實際資料日期、持股比例、週變化與相較前一筆實際發布週資料的持股增減張數。
- 將級距下拉式功能表保留在標題列最右側，並以較短的使用者可辨識文字顯示。
- 將級距說明、張數、人數、來源、資料頻率與投資人身分提醒從預設標題列移除。
- 在大戶與散戶副圖既有的滑鼠右鍵／鍵盤功能表新增「詳細資料」。
- 點選「詳細資料」後，以結構化表格顯示目前讀值日期的完整 TDCC 明細；不在標題列新增任何按鈕。
- 大戶與散戶使用相同行為，切換級距或游標日期時同步更新精簡讀值與詳細資料。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `taiwan-stock-chip-subcharts`: 調整 TDCC 大戶／散戶副圖的預設標題資訊密度、級距控制位置與詳細資料存取方式。

## Impact

- 前端：`public/static/chip-panes.js` 的 holder header、讀值、右鍵功能表與詳細資料表。
- 樣式：`public/static/styles.css` 的 holder 緊湊版型、右側級距選擇與詳細資料表。
- 靜態資產：`public/static/index.html` 的顯示名稱與 cache-busting 版本。
- 驗證：前端 contract tests、實際瀏覽器互動與 Codex Sites 正式站畫面。
- API、Worker、D1 schema、TDCC 回補流程與資料來源不變。
