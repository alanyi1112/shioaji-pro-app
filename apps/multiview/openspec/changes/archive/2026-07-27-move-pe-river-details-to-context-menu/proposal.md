## Why

本益比河流圖目前把本益比、參考 EPS、七個 percentile multiplier、歷史區帶與來源 coverage 長期放在主圖左上 readout，會佔用 K 線顯示空間，且 multiplier 與實際河流線分離。需要讓 percentile 資訊直接貼在線上辨識，完整說明則改為需要時才展開。

## What Changes

- 在河流圖顯示區左側，為 P5／P20／P35／P50／P65／P80／P95 七條線新增同色框線標籤，格式為類似 `—P5 10.01x—`，標籤垂直置中於對應線條。
- 移除主圖左上角常駐的本益比河流圖 readout，不再長期顯示截圖綠框中的本益比、EPS、財報、multiplier、區帶、來源與 coverage 文字。
- 在 panel 滑鼠右鍵選單新增「本益比河流圖詳細說明」；只有目前河流圖具有可用詳情時顯示，點擊後才在選單內展開原 readout 的完整內容。
- 保留 pointed date／盤中估算／provisional／官方來源與授權語意，不新增同業本益比、目標價或投資建議。
- 更新 PNG、存取性、清理生命週期、靜態資產 cache key、自動化測試與本機瀏覽器驗收契約。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `taiwan-stock-pe-river-chart`：修改河流線條辨識、詳細說明入口、常駐 readout 與 PNG 可見內容契約。

## Impact

- 前端：`public/static/pe-river-overlay.js`、`public/static/app.js`、`public/static/index.html`、`public/static/styles.css`。
- 測試：`tests/taiwan-stock-pe-river.test.mjs`、`tests/chart-annotations.test.mjs`、必要的 rendered HTML contract。
- 規格：`taiwan-stock-pe-river-chart`。
- 不影響 percentile 計算、河流價格、資料來源、D1 schema、Worker API、排程或授權邊界。
