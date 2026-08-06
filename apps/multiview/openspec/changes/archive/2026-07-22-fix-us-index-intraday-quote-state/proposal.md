## Why

美股正常交易時段內，Yahoo 日 K 可能回傳 `marketState = unknown`，目前後端因此把當日盤中指數誤判為 `session-close`，前端進一步顯示「7/21 收盤・未驗證」。這會把仍在變動的盤中行情表達成已完成收盤，必須立即修正市場狀態語意。

## What Changes

- 為美國股市日 K 新增以 `America/New_York` 為基準的保守交易時段判定。
- 只有當最新 K 棒、`sessionDate` 與來源報價時間都能證明是當日且仍具新鮮度時，才在上游狀態未知的情況下判定為盤中。
- 美股盤中 quote 統一回傳 `marketPhase = open`、`kind = intraday` 與 `verification.status = not_applicable`。
- 前端盤中狀態顯示來源報價時間，不再顯示「收盤」、「未驗證」或收盤價標籤。
- 新增美股盤中、盤後及來源過舊的回歸測試，避免只依本機時鐘誤判。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `intraday-quote-state`：將既有盤中與已完成收盤的語意擴充至美國股市指數，並規範上游狀態未知時的判定與可見文字。

## Impact

- Worker 市場資料正規化：`worker/market-phase.ts`、`worker/market-data.ts`、`worker/app.ts`。
- 前端報價狀態與價格標籤：`public/static/app.js`。
- API contract：`/api/candles` 與 `/api/stream` 的 `quote.marketPhase`、`quote.kind`、`quote.verification`。
- 自動化驗證：`tests/rendered-html.test.mjs` 與 OpenSpec strict validation。
