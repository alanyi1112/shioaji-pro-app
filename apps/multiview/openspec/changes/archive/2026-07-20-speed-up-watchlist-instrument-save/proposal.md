## Why

目前「我的清單」儲存商品時，`POST /api/instruments` 會在回應前同步重建完整 TDCC continuous targets；正式站已有 38 個 targets，單次儲存因此需等待大量 D1 查詢與寫入，畫面長時間停在「商品儲存中...」。既有規格已要求 API 先回應、籌碼預熱在背景執行，本 change 要補齊這個可見行為與實作落差。

## What Changes

- 將完整 TDCC target reconciliation 移出使用者儲存商品的前景 request，避免每次儲存重掃官方商品目錄、所有使用者商品與所有既有 targets。
- `POST /api/instruments` 在單筆 D1 upsert 成功後優先回傳；必要的單一 symbol target 註冊、eligibility 檢查與籌碼預熱改由 `context.waitUntil` 背景工作處理。
- 保留 durable scheduler 從 D1 清單與商品目錄重建完整 target 集合的責任，確保背景工作中斷後仍能在下一週期補齊。
- 補充可量測的 API latency／工作邊界 contract、D1 query 數量測試、背景工作測試與正式站實際儲存驗收。
- 不變更使用者清單資料模型、登入身分、商品排序、來源欄位或既有籌碼資料語意。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `watchlist-chip-prewarming`: 明確要求清單儲存前景不得執行全量 target reconciliation，單一 symbol 的 target 註冊與預熱必須在背景 lifetime 執行，API 先回應。
- `tdcc-continuous-backfill`: 明確界定完整 target discovery／reconciliation 由 durable scheduler 或受保護的商品目錄同步流程執行，不由互動式清單儲存 request 阻塞完成。

## Impact

- Worker：`worker/app.ts` 的 `saveInstrument`、背景預熱排程與 TDCC target 註冊邏輯。
- 背景資料：`worker/tdcc-continuous-backfill.ts` 的單一 target upsert 或等效 helper，以及既有 full reconciliation 邊界。
- 測試：`tests/rendered-html.test.mjs`、`tests/watchlist-chip-prewarming.test.mjs`、`tests/tdcc-continuous-behavior.test.mjs` 或新增的 focused contract 測試。
- 正式驗收：比較 change 前後 `/api/instruments` 讀取與儲存時間，確認使用者先看到「商品已儲存」，背景 target／預熱仍會完成或由 scheduler 接手。
