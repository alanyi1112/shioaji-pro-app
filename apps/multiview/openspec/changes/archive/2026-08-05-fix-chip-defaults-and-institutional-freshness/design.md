## Context

前一版為避免尚未發布的今日信用交易資料誤顯示，將籌碼 API 依資料集設定 15:00、21:00、22:00 等固定門檻。這仍不符合「取得後立即顯示」：來源可能提早或延後發布，時間門檻無法證明資料日期。更嚴重的是 TWSE `MI_MARGN` OpenAPI 回應沒有報表日期，舊程式曾把請求日期直接交給 normalizer，可能將 8/4 快照建立成 8/5 row。相對地，TWSE 日期查詢報表會回傳明確 `date`，TPEx 與 FinMind rows 也各自帶有日期，可作為安全顯示依據。

## Goals / Non-Goals

**Goals:**

- 新使用者進入多層副圖時，預設不建立「集保戶數」pane。
- 三大法人、融資券與其他日籌碼來源一旦回傳具可驗證日期的資料就立即顯示，不等待固定時間。
- 來源只發布前一日資料時，只保存與顯示前一日，不建立今日空白、零值或複製 row。
- 排除舊版由無日期 TWSE 快照建立的未驗證融資券 cache，並觸發安全重抓。
- 保留實際 `sessionDate`、`sourceDate`、coverage、availability 與 provider provenance。

**Non-Goals:**

- 不強制修改使用者已保存的 pane 選擇。
- 不推測任何資料源的發布時間，也不以 K 棒、請求日期、HTTP `Last-Modified` 或伺服器時間補資料日期。
- 不新增 D1 schema、不更換 FinMind、TWSE、TPEx 或 TDCC 資料來源。

## Decisions

### 1. 只調整首次使用的 pane 預設

`DEFAULT_MODE_B_PANES` 由 registry 排除 `tdcc-holder-count`；registry、群組成員、series 預設及既有 localStorage migration 都保留。這讓新選擇預設未勾選，但已手動勾選的使用者不會被版本升級強制取消。

### 2. requested end 只限制查詢範圍，不宣告來源已發布

所有日資料 adapter 都可查到 requested end，不使用固定小時裁切。adapter 只能以 payload 內的日期建立 row；回傳實際日期早於 requested end 時保存可用 rows，並將 fetch-state、coverage 與 availability 維持 partial，讓後續開啟或重試可以取得新資料。

替代方案是保留 22:00 或其他門檻，但時間不是資料來源證據，會同時造成延後顯示與誤判，因此不採用。

### 3. TWSE 融資券只使用有日期的官方報表

上市融資券 fallback 改查 `rwd/zh/marginTrading/MI_MARGN?date=<requestedEnd>&selectType=ALL&response=json`。normalizer 必須驗證頂層 `date`、目標彙總 table 的 `groups`／`fields` 與目標代號，再建立相同 `sessionDate`／`sourceDate` 的 row。`openapi.twse.com.tw/v1/exchangeReport/MI_MARGN` 雖有融資券數值但沒有報表日期，不能用於建立 dated row。

### 4. API 邊界驗證 row 與 provenance 日期

所有回傳 row 的 dataset 欄位必須同時具有 provenance，且 `provenance.sourceDate === row.sessionDate`。舊版 `margin-short` 的 `twse` provenance 若沒有新增的 `sourceDateVerified: true`，視為無法證明日期：response 移除該欄位，cache coverage 不得直接命中，服務必須重新向帶日期來源查詢。FinMind、TPEx、TWSE T86、TWSE 日期融資券報表與 TDCC 都在 normalizer 階段保留自身實際日期。

## Risks / Trade-offs

- [來源尚未發布時每次開圖可能增加查詢] → 保留 partial／retry-after 與 single-flight，空回應不造資料並 bounded retry。
- [既有 D1 含舊版無日期 TWSE 融資券 row] → response fail closed 排除，fetch-state 不視為完整，待 FinMind、TPEx 或 TWSE 日期報表取得同日資料後冪等覆寫。
- [使用者看到持股比群組不是全選狀態] → 群組 checkbox 使用既有 indeterminate 語意，使用者仍可一鍵勾選全部三項。

## Migration Plan

1. 加入 TWSE 日期融資券報表 normalizer、來源日期一致性與舊 cache 排除測試。
2. 移除固定時間有效終點，更新 Worker 與前端預設，執行完整測試、lint、build 與 OpenSpec strict validation。
3. 本機固定模擬「來源已有 8/5」與「來源仍只有 8/4」兩種情境，驗證取得即顯示且絕不改標日期。
4. 後續部署時觀察 Sites 保留站與 Cloudflare 正式站的 00919／00929／2330 三大法人與融資券實際日期；如需回滾，還原本變更程式即可，無 D1 schema migration。

## Open Questions

無。
