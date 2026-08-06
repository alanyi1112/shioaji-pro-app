## Why

目前 `npm run lint` 會回報 104 個問題（85 個 errors、19 個 warnings），使 lint 無法作為可信賴的品質閘門，也增加 Workers、D1 資料處理與前端互動程式在重構時發生型別錯誤或保留失效程式碼的風險。現有產品功能與正式排程已穩定通過驗收，適合在不改變可見行為、API 契約與資料結果的前提下，集中清理這批既有技術債。

## What Changes

- 清除目前 84 個 `@typescript-eslint/no-explicit-any` errors，為 Worker environment、D1 查詢列、外部市場資料 payload、回補狀態與請求內容建立可核對的型別邊界。
- 修正 1 個 `prefer-const` error，以及前端靜態程式、Worker 與測試中的 19 個 `@typescript-eslint/no-unused-vars` warnings。
- 將 `npm run lint` 納入變更驗收，要求以現行 ESLint 規則達到 0 errors、0 warnings。
- 禁止以停用規則、降低嚴重度、廣泛 ignore、無條件 `any`／型別斷言或刪除仍有產品用途的邏輯來規避檢查。
- 保持既有 Codex Sites／Workers runtime、API schema、D1 migration、排程、資料來源、前端可見行為與功能 parity 不變，並以既有測試、OpenSpec strict validation 與必要 smoke 驗證防止回歸。

## Capabilities

### New Capabilities

- `lint-quality-gate`: 定義全專案 lint 零錯誤零警告、型別邊界、未使用程式碼處理原則，以及不改變既有產品與 runtime 行為的驗收要求。

### Modified Capabilities

- 無。

## Impact

- 主要影響 `worker/app.ts`、`worker/market-data.ts`、`worker/taiwan-stock-chip-service.ts`、`worker/tdcc-continuous-backfill.ts`、`worker/tdcc-history-backfill.ts`、`worker/watchlist-chip-prewarming.ts`。
- 同時清理 `public/static/app.js`、`public/static/chip-panes.js` 與 `tests/taiwan-stock-chip.test.mjs` 的未使用變數警告。
- 不新增外部服務、runtime secret、D1 migration 或公開 API；預期不需要重新設計 UI。
- 驗證面涵蓋 `npm run lint`、`npm test`、`openspec validate --all --strict`、秘密掃描與必要的正式站行為抽查。
