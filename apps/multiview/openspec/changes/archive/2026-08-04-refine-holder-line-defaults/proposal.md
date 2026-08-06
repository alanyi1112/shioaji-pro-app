## Why

大戶持股與散戶持股 pane 目前預設同時顯示持股比例、週變化與股東人數線，畫面資訊過密，而且線寬與資料點大小和主圖的基準樣式不一致。需要讓預設畫面聚焦持股比例與變化，同時保留使用者按需開啟人數線的能力。

## What Changes

- 大戶持股與散戶持股 pane 預設不勾選股東人數 series；持股比例與週變化維持預設顯示。
- 既有偏好若仍是上一版完整預設組合，升級後套用新預設；已客製的 series 選擇繼續保留。
- 大戶／散戶的持股比例線與可選股東人數線改用和主圖一致的線寬與資料點半徑。
- 右鍵「線圖項目」、標題列人數資訊、詳細資料、TDCC 資料與其他 pane 行為不變。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `taiwan-stock-chip-subcharts`: 調整大戶／散戶持股 pane 的預設 series 選擇、舊預設遷移與折線視覺基準。

## Impact

- 主要影響 `public/static/chip-panes.js` 的 series defaults、偏好 migration 與 holder line options。
- 補充 `tests/rendered-html.test.mjs` 或聚焦的籌碼 pane 測試，驗證新預設、客製偏好保留與樣式參數。
- 不變更 Worker API、D1 schema、TDCC 計算、資料來源、存取控制或部署秘密。
