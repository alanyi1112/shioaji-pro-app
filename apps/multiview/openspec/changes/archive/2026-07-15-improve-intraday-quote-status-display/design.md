## Context

目前 Yahoo Chart 的 `regularMarketTime` 會寫入最新 candle 的 `quoteTime`，`marketState` 則直接正規化為小寫字串。`candlePayload()` 只把 `open` 與 `regular` 視為盤中，其餘值一律產生 `session-close`；因此當上游回傳未知、延遲或未列舉狀態時，台股盤中日 K 會誤入收盤 verifier。前端又把所有非 `verified` 狀態統一顯示為「未驗證」，使「不適用核對」與「核對失敗」混為一談。

正式站在台股交易時段已觀察到多個 panel 顯示「當日收盤・未驗證」，tooltip 則回報官方資料尚未發布。現有主規格其實只要求核對已完成日 K，因此需要把報價生命週期、核對適用性與資料新鮮度拆開。

2026-07-13 的收盤後驗收揭露第二個問題：TWSE 官方每日收盤行情約於 14:00、15:30、17:30 產製，當日 14:36 以日期查詢 `www.twse.com.tw` 的 `MI_INDEX` 已取得 2026-07-13 全市場資料，但 `openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL` 至 14:44 仍只提供 2026-07-09。正式站八個 `.TW` 面板在 14:46 仍為 `pending`，證明目前選用的端點不適合同日收盤後核對。

以 2026-07-09 資料交叉比對，`MI_INDEX` 與 `STOCK_DAY_ALL` 均涵蓋相同 1,369 檔，正常有成交商品的收盤價全部一致；僅 5 檔無成交商品分別使用 `--` 與 `0.00`。這支持以 `MI_INDEX` 作同日主要來源，但 parser 必須顯式處理無成交標記。

## Goals / Non-Goals

**Goals:**

- 可靠區分台股盤中、收盤整理中與已完成收盤。
- 盤中不呼叫官方收盤 verifier，並用 `not_applicable` 表達「不適用」，而不是 `unverified`。
- 盤中價格列顯示主來源的市場時間與「現價」。
- 收盤後保留原有 TWSE／TPEx／TWSE MIS／TPEx mirror 核對能力。
- 讓 `.TW` 在官方同日資料發布後能由 `pending` 轉為 `verified`／`mismatch`，不被次日才更新的公開資料檔阻塞。
- 保留全市場請求共享、交易日對齊、無成交保護與官方端點 fallback。
- 讓 freshness、market phase 與 verification 成為互相獨立、可測試的資訊。
- 保持 `/api/candles`、`/api/stream` 與前端狀態一致。

**Non-Goals:**

- 不新增外部行情或第二來源供應商。
- 不改用非官方第三方資料；`MI_INDEX`、TWSE MIS 與 `STOCK_DAY_ALL` 均屬 TWSE 官方來源。
- 不改變 `.TWO` 既有 TPEx、D1 官方鏡像與 TWSE MIS 的優先順序。
- 不在本次變更調整指數、外匯、期貨的 verifier。
- 不把 Worker 接收時間冒充市場報價時間。
- 不在未量測 Yahoo 限流與多使用者負載前，直接把日 K D1 cache 從 300 秒降到 20 秒。
- 不改變技術指標、清單、圖表版型或 D1 schema。

## Decisions

### 1. 在 Worker 建立明確的報價生命週期

`quote` 新增或正式化下列欄位：

```ts
type MarketPhase = "preopen" | "open" | "closing" | "closed" | "unknown";
type QuoteKind = "intraday" | "session-close";

type QuoteVerificationStatus =
  | "not_applicable"
  | "pending"
  | "verified"
  | "unverified"
  | "mismatch";
```

同時傳遞 `sourceQuoteTime` 與 `sourceTimeZone`。台股的 `sourceTimeZone` 使用上游 `exchangeTimezoneName`，預期為 `Asia/Taipei`。

選擇這個模型，而不是只在前端隱藏「未驗證」，因為後端是否呼叫第二來源、API contract、stream parity 與「現價／收盤價」都依賴同一個狀態判定。

### 2. 市場階段採多訊號判定，不只依賴時鐘或單一字串

判定優先順序：

1. 上游明確的交易中／已收盤狀態。
2. 台北市場時段與週末判斷。
3. 最新 `sessionDate` 是否等於台北當日。
4. `sourceQuoteTime` 是否為台北當日且在容許 freshness 範圍。
5. 當日有效 candle 是否具有非占位資料。

正式站 2026-07-13 version 15 驗收發現 Yahoo 在 15:30 後仍可能回傳 `marketState = unknown`，但 `sessionDate` 為當日、`sourceQuoteTime` 明確為台北 13:30:08。為避免這種已完成日 K 永遠停在 `intraday`，未知狀態在「同日有效 K、同日來源時間、台北時間已達 15:00」三項證據同時成立時判定為 `closed`；15:00 前仍沿用原本的盤中與收盤整理規則。這不是把所有未知狀態自動視為收盤。

時鐘只能作為輔助訊號。若是平日 10:00，但沒有當日 candle 或當日來源時間，系統不得在國定假日誤判為開盤。

替代方案是完全相信 Yahoo `marketState`，但正式站已證明它可能無法被目前列舉值正確解讀；另一個替代方案是完全依台北時鐘判斷，但會在休市日產生誤判，因此不採用。

### 3. 盤中使用 `not_applicable`，收盤等待使用 `pending`

- `not_applicable + market_open`：收盤驗證在這個階段沒有意義，且 verifier 必須零呼叫。
- `pending + reference_not_published`：已收盤，但官方資料仍在發布過程。
- `unverified`：只有第二來源連線、資料格式、entitlement、商品覆蓋或其他真正失敗。
- `mismatch`：只有雙方交易日與價格定義一致後，數值仍不同。

這避免使用者把「現在不該驗證」或「官方還在發布」理解為資料不可靠。

### 4. 前端顯示優先級為 freshness、market phase、verification

顯示順序：

1. `freshness = stale`：任何階段都顯示來源時間與「資料過期」。
2. `kind = intraday` 或 `verification = not_applicable`：只顯示來源 `MM/DD HH:mm`，compact 顯示 `HH:mm`，不附核對文字。
3. `verification = pending`：顯示「收盤整理中」或「待核對」。
4. 已完成核對：顯示「已核對」、「未驗證」或「待確認」。

盤中 tooltip 說明「顯示主來源資料時間，收盤後才進行第二來源核對」，但主要可見文字保持精簡。

### 5. 來源時間必須使用市場時區

前端以 `sourceTimeZone` 格式化 `sourceQuoteTime`，台股固定呈現台北市場時間，而不是隨使用者裝置時區改變。若來源時間缺失，顯示「盤中・時間待確認」，不得以 `Date.now()` 或 Worker 接收時間冒充。

### 6. 第一階段保留既有 300 秒日 K cache

本次先修正狀態語意與可見顯示，保留現有日 K cache TTL，讓顯示時間誠實反映資料來源最後更新。部署後再量測來源時間延遲、Yahoo 429 與多圖負載；若需要更快更新，另案評估盤中動態 TTL 或集中式 quote polling。

### 7. `.TW` 使用同日 TWSE 收盤資料鏈

上市商品的官方核對順序調整為：

1. 以主來源 `sessionDate` 組成日期指定的 TWSE `MI_INDEX` 請求，取得同日全市場一般交易收盤行情。
2. `MI_INDEX` 明確回覆目標日期尚無資料時，回傳 `pending + reference_not_published`，不得把正常產製延遲當成 provider failure。
3. `MI_INDEX` 發生連線、HTTP 或無法安全解析的格式錯誤時，才嘗試 TWSE MIS 的 `tse` 單一商品行情。
4. MIS 仍無法使用時，保留 `STOCK_DAY_ALL` 作最後 fallback；若它只提供較早交易日，仍回傳 `pending`。

`MI_INDEX` 是 TWSE 官方網站使用的 JSON 端點，但不是 `openapi.twse.com.tw/v1` 下的版本化 OpenAPI，因此不能移除 fallback。正式部署驗收必須特別確認 Sites Worker 可穩定存取 `www.twse.com.tw`。

### 8. 依欄位語意解析，不依固定 table 位置

`MI_INDEX` 回傳多個 tables，實作必須尋找 `fields` 同時包含「證券代號」與「收盤價」的 table，再依欄位名稱取得索引；不得假設資料永遠位於 `tables[8]` 或收盤價永遠位於固定欄位。

回傳日期必須與請求的 `sessionDate` 相同。收盤價的 `--`、空字串、非有限數值與其他無成交標記均視為無可比較的官方收盤價，不得產生 `mismatch`。正常有成交資料仍沿用官方顯示精度比較。

同一交易日的全市場成功結果維持 300 秒記憶體快取與 inflight coalescing；尚未發布結果維持短期 negative cache。部署時提高 candle cache contract version，避免舊版 `pending` payload 延續到新端點策略。

## Risks / Trade-offs

- [Yahoo `marketState` 仍可能出現未知值] → 保留多訊號判定與 `unknown`，不讓未知自動等於收盤。
- [只靠平日時鐘會在台股休市日誤判] → 必須同時看到台北當日 session 與來源時間才可用時鐘 fallback。
- [來源時間缺失時 UI 資訊較少] → 顯示「時間待確認」，不可製造假精確度。
- [收盤後官方資料有發布延遲] → 使用 `pending`，避免過早顯示 `unverified`。
- [`STOCK_DAY_ALL` 無法在收盤後提供同日資料] → 改以日期指定的 `MI_INDEX` 為主要來源，保留 MIS 與 OpenAPI fallback。
- [`MI_INDEX` 屬官方網站 JSON 端點但非版本化 OpenAPI] → 以欄位名稱與日期做嚴格驗證，並在 Sites runtime 做 live smoke；格式錯誤不得靜默比較。
- [無成交商品在不同端點使用 `--` 或 `0.00`] → 無有效官方收盤價時不得產生 `mismatch`。
- [多面板重複抓取全市場資料] → 以交易日為 key 共用成功快取與 inflight promise。
- [盤中 300 秒 cache 可能讓來源時間落後] → 先誠實顯示時間；TTL 優化需另做限流與負載驗證。
- [新增 verification status 可能影響舊前端] → 同一版同步部署 Worker 與靜態資產，並以 API contract 測試鎖定狀態集合。

## Migration Plan

1. 先更新規格與 contract tests，建立盤中、收盤與休市日 fixture。
2. 在 Worker 正規化 `marketPhase`、`kind`、`sourceQuoteTime` 與 `sourceTimeZone`。
3. 更新 verifier 狀態機，確保盤中零第二來源呼叫。
4. 更新前端顯示與樣式，再驗證 candles／stream parity。
5. 執行 build、完整測試與 OpenSpec strict validation。
6. 加入 `MI_INDEX` 同日、尚未發布、欄位重排、無成交與 fallback fixtures，並證明多檔 `.TW` 共用單一全市場請求。
7. 提高 candle cache contract version，再建置與部署同一版 Worker／前端資產。
8. 在台股盤中正式站驗收「現價＋來源時間」，收盤後再驗收 `pending` 轉為 `verified`／`mismatch`，同時確認 Sites runtime 可存取 `MI_INDEX`。
9. 若出現回歸，可回滾整個 Sites version；此變更不含 D1 migration，回滾不需資料轉換。

## Open Questions

- 盤中日 K 的 cache TTL 是否需要從 300 秒調整為 60 秒，應在本次部署後以實際來源延遲與 Yahoo 限流量測決定。
- 收盤整理中的主要可見文案採「收盤整理中」或「待核對」，可在 UI 驗收時依版面寬度選定，但 API 必須固定使用 `pending`。
- TWSE 官方說明的 14:00 為約略產製時間，不作為硬編碼切換點；系統仍以官方回傳日期是否等於 `sessionDate` 決定 `pending` 或進行比較。
