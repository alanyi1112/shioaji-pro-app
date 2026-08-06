## Why

目前 Pivot Point 以七條完整歷史階梯線覆蓋每根 K 棒，資訊密度過高且不利於判讀下一交易期的參考價位；使用者在曾載入較長歷史後取消 Pivot，還可能因切回較短的非 Pivot payload 卻沿用舊 logical range，導致 K 線被推到圖表左側並留下大片空白。

## What Changes

- 將 Pivot 主圖改為單一「參考 K 棒」投影：預設使用最後一根已完成 K 棒，僅繪製由該參考期計算、適用下一交易日／週／月的 P、R1～R3、S1～S3，並由參考 K 棒向右延伸至價格軸前。
- 允許使用者在沒有其他繪圖工具占用點擊時，點選 K 棒固定 Pivot 參考期，並提供回到最新參考期的清楚操作與參考期／適用期標示。
- 日內圖以所選 K 棒所屬的完整交易日為參考；尚未完成的日、週或月 MUST 明確標示為暫估，不得冒充已完成的下一期水準。
- 以文字、線型、明暗與右側價格標籤區分 P、R、S；移除覆蓋完整歷史的七條 step series，並維持價格尺度、圖表匯出及多 panel 隔離。
- 修正 Pivot 啟用／取消的資料與 viewport 生命週期：不得以較短 cache payload 覆蓋目前較長 K 線視窗；需要切換 payload 時必須維持相同 display window，並以 candle time 而非失效的 logical index 還原可視內容。
- 增加載入較長歷史後反覆啟用／取消 Pivot、點選歷史 K 棒、盤中暫估、週月週期、繪圖工具優先權、多圖及 PNG 匯出的自動與正式站驗收。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `main-chart-pivot-points`: 將 Pivot 從完整歷史當期階梯線改為所選參考期的下一期投影，並強化點選互動、暫估狀態、viewport 保持與取消清理契約。

## Impact

- 前端：`public/static/app.js` 的 Pivot series／overlay、K 棒點選優先權、readout、stream 重連、payload cache 與 visible range 還原流程，以及對應 HTML／CSS。
- Worker：`worker/pivot-points.ts`、`worker/market-data.ts` 與 `/api/candles`／`/api/stream` 的 Pivot payload 語意，必須維持 Traditional 公式、交易所時區與完整參考期判定。
- 測試：Pivot 純函式、Worker API／stream、較長歷史切換、主副圖同步、繪圖工具互動、匯出與正式 Sites browser-visible 驗收。
- 不新增外部依賴、D1 schema、秘密、交易訊號、停利停損建議、通知或自動交易。
