## Why

多層副圖目前可能讓滑鼠實際 X 座標、共用垂直線、主 K 棒、技術副圖與籌碼副圖落在不同交易日；部分商品的技術指標 series 也會因圖表重建與時間範圍同步順序而沒有出現。這會讓畫面讀值失真，且違反既有跨 pane 1 CSS px 日期對齊契約。

## What Changes

- 以主 K 線的 candle time 作為同一 panel 唯一的游標與資料查值基準，任何 pane 的滑鼠位置都先換算至同一根 K 棒。
- 將主圖、技術副圖與籌碼副圖的可視範圍同步改為可驗證的時間錨點流程，避免 right offset、資料稀疏度或 series 重建造成 logical index 漂移。
- 修正共用垂直線與日期標籤的幾何定位，使垂直線貼合滑鼠指向的 K 棒，並讓每個 pane 的同日資料點位於同一螢幕 X 座標。
- 讓技術指標 chart／time anchor／series 在商品切換、快取更新、快速換頁與 layout resize 後以固定順序重建及套用資料；有選取且有合法資料的技術線不得偶發消失。
- 新增多商品、四圖多層副圖、滑鼠左中右位置、重建與捲動後的瀏覽器與自動化驗收。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `taiwan-stock-chip-subcharts`：補強共用游標的原始滑鼠位置、同日資料點、跨 pane 時間錨點及技術指標重建可見性契約。

## Impact

- 前端圖表同步：`public/static/app.js`、`public/static/chip-panes.js`。
- 回歸測試：副圖互動、圖表生命週期、可見 HTML 與必要的純函式測試。
- 不變更市場資料 API、資料庫 schema、籌碼資料日期語意、登入或部署設定。
