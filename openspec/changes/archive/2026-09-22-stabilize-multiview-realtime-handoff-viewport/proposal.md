## Why

MultiView 在「自動」來源的台股日線先顯示較長的 canonical 延遲歷史，收到第一筆 Shioaji 盤中行情後再以較短的同源 Kbars 取代，卻沿用舊 candle 陣列的 logical range。00929.TW 的實際交接由 524 根變成 242 根，造成約一半畫面成為右側空白，主圖與副圖同時位移；行情更新不應改壞使用者正在觀看的 viewport。

## What Changes

- 讓「自動」模式在 Shioaji 可用的分鐘與日線週期等待完整 bootstrap，再一次顯示最終同源 candle payload，避免先畫 Yahoo 後於第一筆即時行情可見地整批換源。
- 將資料集合改變時的 viewport 保存由舊陣列 logical index 改為日期錨點，並在新資料較短時依實際 candle 數量限制範圍，避免左右側大面積空白。
- 來源 fallback、收盤 canonical handoff、重連與換交易日維持原子完整 payload；不得混接不同 provider 或成交量單位。
- 補上 524 根 canonical 對 242 根 Shioaji、使用者局部縮放、同日重複 snapshot、fallback／恢復與主副圖同步的回歸及 browser 驗收。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `multiview-chart-viewport-stability`: 資料來源交接或 candle 集合長度改變時，必須以日期錨點保留或安全收斂 viewport，且不得產生超過既定右側空間的大面積空白。
- `multiview-taiwan-realtime-market-data`: 自動模式必須在完整 Shioaji bootstrap 後原子顯示同源 payload，來源 fallback 與收盤 handoff 也必須維持同源完整性及穩定 viewport。

## Impact

- 前端：`apps/multiview/public/static/app.js`、`chart-interactions.js` 與相關測試。
- 行情來源：沿用本機 Shioaji simulation、Yahoo／TWSE canonical fallback 與既有共用 SSE；不新增 API、不啟用 production、不執行真實下單。
- UI：台股分鐘與日線初次載入可能短暫顯示「等待 Shioaji Kbars」，不再先顯示即將被替換的延遲圖形。
