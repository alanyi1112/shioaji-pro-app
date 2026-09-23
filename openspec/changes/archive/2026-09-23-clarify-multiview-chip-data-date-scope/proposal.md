## Why

MultiView 籌碼副圖目前把各資料集的警示集中顯示在所有副圖下方，卻沒有在「法人」、「融資券」、「持股比」群組旁標示各自的實際資料截止日與更新頻率。當日資料與 TDCC 週資料的截止日不同時，使用者容易把某一筆 `2026-09-21` 警示誤認為全部籌碼資料都更新到該日，即使大戶／散戶持股實際只到 `2026-09-18`。

## What Changes

- 在 MultiView 模式 B 的籌碼副圖群組標題加入資料日期範圍標示，直接使用 API `coverage[]` 回傳的實際 `end` 與資料頻率。
- 依目前可見副圖列出實際使用的資料集日期；同一群組若混用不同截止日，分別顯示，不合併成單一全域籌碼日期。
- 法人群組區分買賣超與外資持股日期；融資券群組區分融資融券與借券日期；持股比群組明確標示 TDCC 週資料日期。
- 日期標示不隨十字線游標日期改變，並隨群組一起納入 PNG 匯出；缺少可驗證截止日時顯示無法驗證，而不是推測日期。
- 保留既有逐資料集警示訊息，讓資料延遲、部分資料與截止日資訊可以同時被辨識。

## Capabilities

### New Capabilities

- `multiview-chip-date-scope-labels`: 在 MultiView 籌碼副圖中，依可見資料集呈現可驗證的資料截止日、日／週頻率與缺資料狀態。

### Modified Capabilities

- 無。

## Impact

- 影響 `apps/multiview/public/static/chip-panes.js` 的群組標題與 payload 更新流程。
- 影響 `apps/multiview/public/static/styles.css` 的群組日期標示排版。
- 新增或調整 `apps/multiview/tests/subchart-interaction.test.mjs` 的日期範圍單元測試與結構驗證。
- 不變更籌碼 API、資料來源、排程或資料庫內容；僅使用既有 `coverage[]` metadata 改善顯示語意。
