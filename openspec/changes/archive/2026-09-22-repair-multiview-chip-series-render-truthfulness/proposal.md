## Why

MultiView 籌碼副圖可能在資料讀值仍存在時，因使用者保存了空的 series 選取、K 棒日期映射改變後未重建可繪點，或匯出就緒檢查只確認 series 物件而呈現空白。這會讓使用者誤以為法人、融資券或持股資料缺漏，也讓空白副圖可能通過 PNG 匯出驗證。

## What Changes

- 所有可設定的籌碼副圖都不得保存或套用零條 series；若舊設定為空，必須回復該 pane 的預設 series。
- K 棒日期映射實際改變時，副圖必須使用最後已驗證的籌碼 payload 在本機重建可繪點，不重新呼叫籌碼 API。
- 副圖狀態與匯出 readiness 必須以已選 series 的實際可繪點數判定，不能把空選取、空 series 或只有有效 Canvas 視為已完成。
- 增加涵蓋法人、融資券、借券、比率與持股比副圖的回歸測試，區分「來源確實無資料」與「資料存在但未繪製」。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `multiview-chip-data-stability`：補充 series 選取下限、K 棒日期映射變更時的快取重繪，以及有資料就必須產生可繪點的顯示真實性要求。
- `multiview-panel-image-export-stability`：補充匯出 readiness 必須核對實際可繪點，並在資料存在但圖未建立時 fail closed。

## Impact

- 主要修改 `apps/multiview/public/static/chip-panes.js` 的 series 選取正規化、日期映射重繪與匯出 readiness。
- 補強 `apps/multiview/tests/subchart-interaction.test.mjs` 與相關 MultiView 測試。
- 不改變籌碼 API、資料來源、正式行情內容、交易模式或 Shioaji 連線。
