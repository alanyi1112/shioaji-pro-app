## Context

現行正式 Worker 會在前端請求且 TDCC cache 超過 8 天時呼叫最新 OpenAPI，屬於 opportunistic refresh；沒有流量就沒有更新。既有 `backfill-tdcc-holder-history` 已提供受保護 ingest、D1 job／coverage 與本機低速 runner，但目標清單與執行時機仍由操作者手動指定。

這次要把它改成持續運作的兩條背景資料鏈：第一條定期保存 TDCC 最新全市場週快照，第二條動態發現新加入網站的合格台股並逐週回補免費歷史。Codex Sites 目前沒有在專案 hosting contract 中提供可設定的 durable cron，因此背景控制面由 private GitHub repository 的 scheduled workflow 執行；Worker 保持 Cloudflare runtime 相容，負責授權、queue、驗證與 D1 寫入，歷史 HTML parser 與公開表單 session 不進入正式 Worker。

## Goals / Non-Goals

**Goals:**

- 即使無人開啟網站，也要每日自動檢查並保存新發布的 TDCC 週快照。
- 新加入商品目錄、個人清單或官方新上市清單的合格 TWSE／TPEx 普通股與 ETF，要在一個排程週期內建立 coverage 並自動回補免費歷史。
- 對漏週、新 symbol、workflow 中斷、重複排程及部署切換提供冪等 queue、lease、checkpoint、重試與可觀測狀態。
- 歷史表單自動化維持單一併發、低速、有限批次；遇 CAPTCHA、封鎖或格式漂移立即停止並告警。
- 維持 TDCC 週頻、實際 `dataDate`、非發布日 gap 與秘密不外洩的既有契約。

**Non-Goals:**

- 不把歷史頁 HTML parser、cookie 或 synchronizer token session 部署到 Sites Worker。
- 不為了回補而掃描未加入網站目標集合的所有既有上市櫃證券。
- 不規避 CAPTCHA、WAF、rate limit、robots／使用規範或來源封鎖。
- 不把週資料 forward-fill、插值或推算為每日持股資料。
- 不以 FinMind 付費歷史資料作為必要依賴。

## Decisions

### 1. 使用 GitHub Actions 作為 durable scheduler，Sites Worker 作為控制面

新增單一 scheduled workflow，每日固定時間執行並提供 `workflow_dispatch`。workflow 先呼叫受保護的 latest-refresh endpoint，再反覆 claim 有限批次的歷史工作；沒有待處理項目時立即結束。所有 endpoint 同時要求 Sites bypass header 與獨立 continuous-backfill secret。

選擇 GitHub Actions 是因為 repository 已是 private GitHub，支援背景 `schedule`、秘密與低速執行官方公開表單 session；Sites hosting contract 未揭露 cron 設定。替代方案「只在使用者開圖時更新」無法滿足無流量持續運作；在 Worker 內執行長時間歷史批次容易逾時。

### 2. 目標集合每次由 D1 動態重建，不寫死在 workflow

Worker 將 base setup、D1 instrument catalog、所有使用者已加入的台股 symbol 與最新官方新上市增量合併，再套用既有 `isEligibleTaiwanEquity` 規則。首次啟用以目前已支援清單建立 baseline；此後任何首次出現的合格 symbol 都 upsert 至 `tdcc_continuous_symbols` 並建立 `queued` 歷史工作。停用或下市 symbol 不再建立新工作，但已保存歷史不刪除。

workflow 只向受保護 API claim 目前 queue，不含固定 symbol 清單。這可讓新增商品不需改 workflow 或重新部署。為避免初次啟用意外掃描整個既有市場，官方市場目錄只將 baseline 後的新上市增量自動納入；其他既有股票在使用者加入網站時才納入。

### 3. 最新週快照與歷史回補分成兩條冪等資料鏈

`refresh-latest` 直接由 Worker 呼叫 TDCC 最新 OpenAPI，使用既有 parser 驗證完整 snapshot，並以 `symbol + dataDate` upsert 目前目標集合；資料日期與前次相同時為成功 no-op。這條鏈不需要歷史表單 session，優先確保每一個未來新週不漏存。

歷史鏈由 GitHub runner 先 GET TDCC 官方公開歷史頁，取得可見日期與 `SYNCHRONIZER_TOKEN`，再以同一 cookie session POST 頁面原生表單欄位。每次 claim 限制 symbol 數與週數，使用單一 session／單一併發及至少一秒間隔；結果仍透過受保護 ingest endpoint 與相同 validator 寫入。runner 只處理 queue 指定 symbol，不自行擴張目標，也不呼叫未驗證隱藏 API。

### 4. 缺週以官方日期集合偵測，不假設每週五

每次歷史 runner 從 TDCC 可見歷史日期選單取得官方 `dataDate` 集合，再與每個 symbol 的 D1 distinct dates 比對。新 symbol 對官方免費保存範圍建立 missing dates；既有 symbol 只補 gap。若官方可追溯上市日存在，上市日前標記 `pre_listing`；否則以表單的合法「查無資料」保存 gap reason，不製造 rows。

### 5. D1 queue 使用 lease、heartbeat 與逐 symbol coverage

新增 `tdcc_continuous_runs`、`tdcc_continuous_symbols` 與 `tdcc_continuous_items`。claim 以 transaction 將 queued／retryable item 設為 running、寫入 lease owner 與期限；workflow 定期 heartbeat。lease 過期可由下一次排程重新 claim，成功週透過既有唯一鍵保持冪等。

每個 symbol 保存 `firstSeenAt`、來源、catalog revision、目標起訖、expected／completed／failed weeks、checkpoint、最後最新快照、最後歷史成功、nextRetryAt 與安全錯誤碼。全域 health 另外保存 scheduler 最後心跳與最近成功 run。

### 6. 失敗採 fail closed，但排程持續服務其他 symbol

`captcha_or_blocked`、`candidate_mismatch`、`invalid_response` 或 HTML 格式漂移會將目前 claim 設為 `blocked`，停止該次歷史工作且不重試規避；其他尚未處理 symbol 留在 queue，下一次 run 仍可先執行 latest snapshot。429／5xx／timeout 只依有限次數退讓並設定 `nextRetryAt`。

blocked 不得被 UI 說成「回補中」。health 顯示 safe reason、最後成功日、排程心跳與受影響 symbol 數，不輸出頁面 body、秘密或內部 URL。

### 7. 副圖使用逐 symbol 狀態，不再沿用全域 job

個股籌碼 API 的 `backfill` 改為目前 symbol 的 coverage／queue 摘要。pane 可顯示「等待背景回補」、「背景回補中 x/y 週」、「回補未完成」、「來源阻擋」或「歷史已更新」；已有資料即使 blocked 仍照常繪圖。非發布日 tooltip 與週資料標示不變。

### 8. 秘密只存在 Sites 與 GitHub secrets

GitHub workflow 使用 `SITES_BYPASS_TOKEN` 與 `TDCC_CONTINUOUS_BACKFILL_SECRET`；repo、artifact、console、checkpoint 與 API response 都不得輸出值。runner 的錯誤序列化必須套用 allowlist，shell 不得啟用會回顯 secret 的 trace。部署前測試掃描 committed files 與 workflow log contract。

## Risks / Trade-offs

- [GitHub scheduled workflow 可能延遲或暫停] → 每日執行而非只跑單一星期幾，health 以最後心跳超時告警，並保留手動 `workflow_dispatch`。
- [TDCC 歷史頁可能限制資料中心 IP、自動表單或出現 CAPTCHA] → 只使用頁面公開 GET／POST 欄位、單一併發、低速、有限批次；立即 blocked 並告警，不規避。最新 OpenAPI 週快照仍可持續保存。
- [使用規範無法證明允許背景自動表單操作] → 啟用前記錄來源規範檢查；若明確禁止，歷史 lane 必須停用並回報 `history_automation_not_permitted`，不得以技術方式繞過。
- [新增大量 symbol 造成 queue 堆積] → 每次 run 設定 symbol／週／總時間上限，以 oldest-first 公平處理；latest snapshot 優先於歷史補洞。
- [首次 catalog refresh 將全市場誤認為新增] → migration 建立 baseline revision，只有 baseline 後的新上市或使用者實際加入商品才自動 enqueue。
- [workflow 重複或上次尚未結束] → GitHub concurrency group 加上 D1 lease 雙層防護；重複 ingest 仍由唯一鍵冪等。
- [新上市日前沒有資料] → 使用官方上市日或合法查無資料語意，不把缺值列為失敗，也不補造週資料。

## Migration Plan

1. 新增 D1 queue／run／symbol tables 與既有目標 baseline migration，不修改既有 TDCC rows。
2. 實作 dynamic target discovery、逐 symbol coverage 與受保護 latest／claim／heartbeat／complete endpoints，先以 mock scheduler 驗證。
3. 擴充 runner 支援 API claim、有限批次、lease heartbeat、gap-only 與 safe blocked 狀態。
4. 建立 GitHub scheduled workflow；由使用者在 GitHub／Sites secret 管理介面設定秘密，不將值寫入檔案。
5. 先以一檔普通股及一檔 ETF 執行 `workflow_dispatch` smoke，再將既有 24 檔設為 baseline 並啟用 daily schedule。
6. 新增測試 symbol，驗收自動 enqueue、歷史回補、最新週保存、UI 逐 symbol 狀態及重跑冪等後才正式啟用。
7. 回滾時停用 workflow，保留 D1 已驗證 rows；前端回到既有 D1／opportunistic refresh，queue tables 可保留以供診斷。

## Open Questions

- 實作啟用前仍需再次核對 TDCC 公開歷史查詢頁當時的使用規範；若背景自動操作不被允許，免費來源只能保證未來最新週快照持續累積，歷史自動補洞必須保持 blocked。
