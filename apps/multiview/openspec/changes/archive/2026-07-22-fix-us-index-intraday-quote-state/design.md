## Context

美股指數日 K 由 Yahoo chart API 提供。來源會帶 `regularMarketTime` 與 `exchangeTimezoneName`，但 `marketState` 在正常交易期間仍可能是 `unknown`。現行 Worker 對非台股只信任列舉後的 `marketState`；未知值會直接產生 `marketPhase = unknown` 與 `kind = session-close`，使前端顯示「收盤・未驗證」。

## Goals / Non-Goals

**Goals:**

- 以來源市場時區、當地交易時段、當日 K 棒及來源報價新鮮度保守推論美股盤中狀態。
- 讓 candles 與 stream 使用一致的 `marketPhase`、`kind`、`sourceQuoteTime` 與 verification 語意。
- 盤中直接顯示來源最新報價時間，並允許實際變價動畫正常運作。
- 保留來源過期、休市日與未知市場的保守行為。

**Non-Goals:**

- 不建立完整美國交易所假日資料庫，也不推測特殊提早收盤日。
- 不更換 Yahoo 資料源或新增付費資料依賴。
- 不在本次變更調整 K 線歷史快取與 SSE payload 大小。

## Decisions

1. 在 `worker/market-phase.ts` 新增美股市場階段推論函式。優先尊重上游明確狀態；只有來源時區為 `America/New_York`、當地為週一至週五 09:30–16:00、最新 K 棒與來源報價同屬當日，且報價時間未超過一小時時，才將未知狀態推論為 `open`。相較只依系統時鐘，這能避免休市日誤判。
2. `quote.kind` 一律由正規化後的 `marketPhase` 決定。日 K 只有 `closing` 或 `closed` 才是 `session-close`，`open` 必須為 `intraday`；未知狀態不得冒充已完成收盤。
3. 所有市場只要 `marketPhase = open`，verification 都回傳 `not_applicable / market_open`，不得呼叫收盤第二來源。前端沿用既有盤中格式，顯示 `sourceQuoteTime` 依 `sourceTimeZone` 格式化後的日期時間。
4. 前端 `marketSessionState` 先採用 Worker 正規化的 `quote.marketPhase`，再回退至原始 `marketSession`，避免原始 `unknown` 蓋掉已判定的盤中狀態。
5. 提升 candle response contract version，使正式站部署後不會繼續命中舊版錯誤狀態的 D1 回應快取。

## Risks / Trade-offs

- [美國特殊提早收盤日無法僅靠固定時段精準辨識] → 上游明確 closed 狀態仍具有最高優先權；未知狀態只有來源報價持續更新且新鮮時才推論為 open。
- [來源報價時間短暫落後] → 容許一小時新鮮度，避免短暫供應商延遲立即誤判；資料快取若標示 stale，前端仍優先顯示資料過期。
- [其他 `America/New_York` 商品被納入] → 僅套用日 K 且要求當日有效來源時間；不符合證據時維持 unknown，不主動宣稱收盤。

## Migration Plan

1. 部署新的 Worker 與前端靜態資源，使用新版 cache contract 自動避開舊 payload。
2. 驗證四個美股指數盤中 API 與畫面顯示來源報價時間。
3. 若回歸，回退本次版本；舊 cache contract 不需資料庫 migration 或清除。

## Open Questions

無。
