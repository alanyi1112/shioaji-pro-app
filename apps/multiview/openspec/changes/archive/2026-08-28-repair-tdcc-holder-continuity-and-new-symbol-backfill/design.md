## Context

詳見 `proposal.md`。目前新增商品已由 Worker background work 建立 continuous target、queue 並嘗試 GitHub workflow dispatch；本機沒有該 dispatch token 時，target 只能等週六主同步或週日重試。TDCC 最新 OpenAPI lane 只提供目前週全市場快照，歷史 lane 才能從官方日期選單建立最近一年計畫，兩條 lane 必須持續分離。

現有 `tdcc_continuous_symbols.expected_weeks`／`completed_weeks` 會取 coverage row count 與既有值的最大值，`completed` 因而可能在中間缺週時保持不變。`recordTdccLatestSnapshot` 只前進 `latest_snapshot_date`，不會證明計畫已涵蓋新週。`tdcc_continuous_items` 已能保存逐 symbol／date 狀態與合法 gap reason，適合作為日期身分的權威 ledger。

TDCC 歷史表單必須維持已授權的可見表單、單一併發、至少一秒間隔、有限批次、CAPTCHA／WAF fail-closed 與秘密不落地邊界。既有日 K 線 change、其他籌碼來源、production 交易與服務生命週期不在本 change 的授權範圍。

## Goals / Non-Goals

**Goals:**

- 讓每個 active symbol 的 TDCC 完整度可由官方日期與逐日期 evidence 重算。
- 最新快照前進後能自動產生 reconcile 工作，不漏掉中間官方週次。
- 新增商品在本機五分鐘內由既有 runner 接手，遠端仍沿用受保護 dispatch。
- holder panes 在任何 partial／queued／退化回應下保留已驗證資料並顯示真實進度。
- 以 additive、可回滾方式修復既有 target，不重抓完整商品或刪除已驗證 rows。

**Non-Goals:**

- 不把 TDCC 週資料轉成日資料，也不 forward-fill、插值或補零。
- 不擴張成全市場歷史掃描；只處理目前 active canonical targets。
- 不在 Worker request 內同步操作 TDCC 歷史表單或等待 51 週完成。
- 不新增付費來源、繞過來源保護、改動登入清單資料或啟用真實交易。

## Decisions

### 1. 以日期 ledger 為權威，symbol counters 只作投影

每次歷史 runner 取得官方日期集合後，為最近 51 個官方日期（包含合法上市前日期）建立或更新 `tdcc_continuous_items`。每個日期只有下列 resolved evidence 才算完成：

- `taiwan_stock_shareholder_distribution` 存在通過 17 級 validator 的 `symbol + data_date`；
- item 明確完成為 `pre_listing`；
- item 明確完成為 `not_published`。

`expected_weeks`、`completed_weeks`、`failed_weeks`、`missing_dates_json` 與 coverage 起訖全部由 ledger／資料列聚合重算，禁止再用 saved row count 的最大值維持舊 counters。這能在不變更 UI API 主要 shape 的前提下修正完成判斷。

替代方案是只比較 row count；它無法分辨中間缺週，已由大立光案例證明不可採用。另一個替代方案是另建完整官方日期表；目前 active target 規模有限，既有 item ledger 已具 lease／status／error 欄位，新增全域表只會增加同步一致性成本。

### 2. 增加「計畫已核對至哪個官方日期」證據

對 continuous symbol 加入 additive `official_plan_through` 與 `coverage_verified_at`（實際命名可依 migration 慣例調整，但語意不得改變）。最新 OpenAPI 寫入若發現 `latest_snapshot_date` 晚於 `official_plan_through`，只保存真實新 row，並將非 running／blocked target 降為 `queued` 或 `partial`、清除完成假象，交由歷史 runner 取得官方日期集合後 reconcile。

不能用固定每七天推算中間日期，因連假會改變最後營業日。最新 lane 只負責標記 reconcile-required；歷史 lane 才能建立官方日期身分。

### 3. 本機用低成本 queue watcher 完成立即 handoff

保留週六 22:30 主同步與週日 22:30 隔日重試，再新增最多每五分鐘一次的本機 LaunchAgent watcher。watcher 先呼叫本機受保護 control plane 取得 runnable／overdue queue 計數；沒有工作就成功結束，不建立 TDCC session、不下載歷史頁。存在工作時才取得 host single-flight、建立 run id，並呼叫既有 continuous runner；D1 lease 仍是跨入口的最終 owner 權威。

不讓 Worker 直接啟動 host process，避免 Web request 取得任意程序權限。也不把歷史查詢改成每五分鐘固定執行，避免無工作時對官方來源產生流量。

Sites／Cloudflare 維持既有受保護 GitHub dispatch；dispatch 不可用時必須 truthful degraded 並保留 queue。這次不建立另一條高頻遠端 GitHub cron，避免免費額度與重複時鐘成本。

### 4. Reconciliation 是 additive 且逐 symbol 有界

首次部署後，以受保護 runner 對所有 active targets 建立官方 51 週日期計畫：

1. 將現有合法 rows 與既有合法 gap item 對映到官方日期。
2. 補建缺少 item，重新投影 counters／status。
3. 只 claim missing／failed-retryable dates，不重抓 resolved dates。
4. 保留 blocked reason、lease 與 retry-after；不自動解鎖 CAPTCHA／candidate mismatch。

大立光會產生 `2026-08-07`、`2026-08-14` 兩個 item；晶呈科技會以 `2026-08-21` 已保存 row 為 resolved 起點，建立其餘官方日期工作。單輪仍遵守 symbol、週數與總時間上限，未完成工作由後續 watcher／週末 runner 接續。

### 5. API 與 holder UI 使用同一份 evidence

個股籌碼 API 的 TDCC coverage／backfill 增加 `officialPlanThrough`、`coverageVerifiedAt`、`queuedSince`、handoff 狀態及 bounded missing dates；不回傳使用者清單、credential 或完整上游 body。大戶、散戶與集保戶數共用相同 `shareholder-distribution` slice 與 backfill state。

前端狀態優先序為 blocked／failed、running、handoff overdue、queued／partial、history gap、available。series 仍採 verified-slice 非退化 reconcile；新 row 或 gap evidence 改善後才使 cache 失效並重畫。最新一週可顯示，但「首筆」readout 與歷史進度是兩個不同訊息，不能互相取代。

### 6. 驗收以逐 symbol 日期集合與實際畫面為準

自動測試需覆蓋：53 筆但缺兩個中間日期不得完成、latest 晚於 plan 會降級、新商品一週資料建立 51 週計畫、本機 watcher no-op／single-flight／五分鐘 handoff、合法 gap、重複 runner、API redaction 與前端非退化更新。

實際驗收分開核對本機、Sites 保留站與 Cloudflare 正式站；每個環境都要以自身 D1／run 證據為準。至少在本機以大立光與晶呈科技確認 D1 日期、API payload、DOM 狀態、Canvas series 與 console，不能以全域 health 或 source inspection 取代。

## Risks / Trade-offs

- [五分鐘 watcher 增加本機程序喚醒] → 先做本機 queue-only probe，無工作時不連 TDCC，並以 host single-flight 防止重疊。
- [官方日期頁暫時不可用時完成狀態會停在 partial] → 保留既有 rows、retry-after 與 truthful status；最新 OpenAPI lane 繼續保存新週。
- [migration 重新計算可能讓多檔 completed 暫時降級] → additive migration 只加證據欄位，正式 reconcile 完成前保留 series；不刪除資料。
- [51 檔同時 reconcile 造成來源壓力] → 先以 D1 evidence 建 item，僅缺週進入官方查詢，維持單一併發、間隔與批次上限。
- [遠端 dispatch 缺設定仍無法立即啟動] → 明確顯示 degraded、保留 durable queue，部署驗收必須檢查 dispatch 設定；不把 queue 成功冒充 runner 已開始。
- [既有操作手冊與排程漂移] → 同一 change 更新週末 schedule、隔日重試與新 watcher 說明，並用 workflow/runtime contract tests 鎖定。

## Migration Plan

1. 先加入 additive D1 欄位／index 與投影 helper，舊讀取路徑在欄位尚未回填時保守顯示 partial。
2. 部署 API／runner reconciliation 與測試，再啟用本機 queue watcher；週末既有排程保持不變。
3. 以受保護 dry-run 列出 active targets、官方日期與將新增的 items，確認不觸及使用者／登入資料。
4. 執行 bounded reconciliation，先核對大立光兩個缺週與晶呈科技 51 週計畫，再完成全部 active targets。
5. 驗證 D1、API、Browser DOM／Canvas／console 與 scheduler handoff；遠端環境需各自取得授權後另行部署與驗收。

回滾時停用新 watcher 並回退應用程式；additive 欄位與 item evidence 保留，舊程式可忽略，不刪除已補回的公開 TDCC rows。若新投影有誤，以部署前只含 TDCC 公開表的備份及逐日期稽核修復，不回復整個含個人資料的 D1。
