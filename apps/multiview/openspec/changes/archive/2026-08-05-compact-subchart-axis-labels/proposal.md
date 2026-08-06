## Why

籌碼副圖與技術指標的右側數值軸目前會顯示完整千分位張數及固定兩位小數，讓刻度文字占用過多圖表寬度，也顯示沒有資訊價值的 `.00`。需要縮短軸標籤，保留實際精度與單位，同時把更多水平空間留給資料圖形。

## What Changes

- 籌碼副圖數值軸的張數達千位時改用 `K張` 縮寫，例如 `50,000張` 顯示為 `50K張`。
- 籌碼副圖百分比刻度不再強制顯示兩位小數；整數顯示為 `2%`，非整數仍保留必要的小數。
- 技術指標數值軸移除尾端無意義的零，例如 `50.00` 顯示為 `50`，但保留非零的小數精度。
- 圖例、游標讀值、詳細資料與原始資料不受刻度精簡影響。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `taiwan-stock-chip-subcharts`：精簡籌碼副圖右側張數與百分比刻度的顯示格式。
- `configurable-subchart-indicators`：移除技術指標數值軸尾端無意義的零。

## Impact

- 影響 `public/static/chip-panes.js` 的籌碼副圖 price formatter。
- 影響 `public/static/app.js` 的技術指標 price formatter。
- 新增或調整 formatter 測試與 UI 可見驗收；不變更 Worker API、資料庫、資料來源或套件依賴。
