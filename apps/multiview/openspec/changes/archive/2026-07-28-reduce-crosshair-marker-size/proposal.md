## Why

圖表十字準線停在同一日期時，主圖、技術副圖與籌碼副圖的折線交點沿用 Lightweight Charts 預設大型圓點；多條線靠近時會互相堆疊並遮住 K 棒、折線與讀值。需要將交點縮成只比線條略粗的小圓點，同時保留顏色辨識與跨圖同步。

## What Changes

- 將主圖價格折線、技術副圖折線與籌碼副圖折線的 crosshair marker 統一縮為半徑 2 CSS px。
- 將 marker 邊框縮為 1 CSS px，避免預設 4 px 半徑與 2 px 邊框造成大面積遮蔽。
- 保留既有 marker 顏色、顯示條件、費波那契選點期間隱藏邏輯及跨 pane 十字準線同步。
- 新增契約測試，防止任一圖層回退到大型預設 marker。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `codex-sites-rewrite`: 補充主圖、技術副圖與籌碼副圖折線的緊湊十字準線交點視覺契約。

## Impact

- 前端：`public/static/app.js`、`public/static/chip-panes.js`、`public/static/index.html` cache-busting。
- 測試：圖表靜態契約與互動測試。
- 不變更 Worker API、D1 schema、資料來源、計算公式、持久化或 Sites runtime secrets。
