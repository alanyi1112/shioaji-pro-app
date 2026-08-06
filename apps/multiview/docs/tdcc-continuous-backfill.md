# TDCC 背景持續回補操作手冊

## 執行契約

- GitHub Actions 每日 `02:15 UTC` 檢查一次；TDCC 股權分散表本身是週資料，不是每日資料。
- 每次工作先保存最新 OpenAPI 快照，再從 D1 動態 claim 新增或缺週的台股普通股／ETF。
- 單次最多 claim 4 檔、每檔最多處理 12 個缺週、請求至少間隔 1 秒，總執行時間不超過 20 分鐘。
- CAPTCHA、來源封鎖、候選證券不一致或頁面結構漂移會停止該檔並標示 `blocked`；不得規避來源保護機制。
- 停用 workflow 只會停止後續工作，不會刪除 D1 已保存資料。

## 來源規範核對（2026-07-17）

- [TDCC 集保戶股權分散表](https://www.tdcc.com.tw/portal/zh/smWeb/qryStock) 明確標示資料按每週最後一個營業日編製、歷史保存一年，並建議多檔需求使用開放資料專區下載。
- 官方頁面未提供允許資料中心背景自動操作可見歷史表單的明確文字，因此程式預設 **不啟用** Playwright 歷史 lane；必須由維運者完成使用規範確認後，才可設定 `TDCC_HISTORY_AUTOMATION_ENABLED=true`。
- 即使啟用，也只允許網站已加入的動態目標、單一併發、最低一秒間隔與有限批次；不得繞過 CAPTCHA、WAF、rate limit 或其他來源限制。
- 最新 OpenAPI lane 與歷史表單 lane 分離；歷史 lane fail closed 時仍可每日保存未來新週快照。

## 必要設定

Sites runtime 需設定：

- `TDCC_CONTINUOUS_BACKFILL_SECRET`：只供受保護 control plane 使用。
- `TDCC_HISTORY_AUTOMATION_ENABLED=true`：完成來源規範核對後才可明確啟用；缺少時歷史 claim 會 fail closed。

Cloudflare 正式站由 GitHub Environment `cloudflare-production` 的 variable `TDCC_HISTORY_AUTOMATION_ENABLED` 控制。`scripts/cloudflare-config.mjs` 只有在該值精確為 `true` 時才啟用，其餘值一律產生 `false`；不得直接修改已忽略的 `.wrangler.cloudflare.generated.jsonc`，否則下一次部署會覆蓋。

GitHub repository secrets 需設定：

- `SITES_BYPASS_TOKEN`
- `TDCC_CONTINUOUS_BACKFILL_SECRET`

秘密只可存於 Sites／GitHub 的 secret store，不得寫入 repo、OpenSpec、log 或 issue。旋轉時先更新 Sites，再更新 GitHub secret，手動執行一次 `workflow_dispatch` 驗證，最後撤銷舊值。

## 啟用、停用與診斷

1. 確認正式 `/api/health` 的 `shareholderDistributionContinuous` 已顯示目標數與 scheduler heartbeat。
2. 手動執行 `TDCC continuous backfill` workflow，確認 latest refresh、claim、heartbeat、ingest、complete 均成功。
3. 驗證一檔普通股與一檔 ETF 的個股籌碼 API，coverage 與 missing weeks 必須各自獨立。
4. 驗收完成後保留每日 schedule。

緊急停用時可停用 GitHub Actions workflow，或把 Sites 的 `TDCC_HISTORY_AUTOMATION_ENABLED` 改為 `false`。後者會讓歷史工作固定回傳 `history_automation_not_permitted`，最新官方 OpenAPI 快照仍可獨立執行。

## Cloudflare 首次歷史復原

Cloudflare D1 與 Sites D1 是獨立資料庫。若 Cloudflare 只有最新一週，禁止直接搬移整個 Sites D1，因為整庫可能含登入名單與個人清單；也不要重跑 `historyAutomationEnabled=false` 的排程，該排程只會保存最新 OpenAPI 快照。

正確流程如下：

1. 由本機執行 `scripts/tdcc-history-backfill.mjs` 的 `--dry-run`、`--snapshot-output`，只從 TDCC 公開歷史表單低速擷取目前 Cloudflare active targets。正式復原至少使用最近 51 個官方週。
2. 工具逐商品逐週驗證 17 級資料，並將 `published`、`pre_listing`、`not_published` 明確分開；快照與 checkpoint 必須放在 repo 外的權限 `0600` 暫存目錄，不得提交。
3. 以 `scripts/tdcc-history-recovery.mjs --snapshot=... --output-sql=...` 驗證快照並產生 additive SQL。只允許寫入 `taiwan_stock_shareholder_distribution`、`tdcc_continuous_items`、`tdcc_continuous_symbols` 與 TDCC market fetch state；SQL 摘要只輸出商品數、週數、資料列數與 SHA-256。
4. 寫入前以 `wrangler d1 export` 只備份上述 TDCC 公開資料表與 fetch state；不得把整個含個人資料的 D1 匯出成修復 artifact。
5. 套用 SQL 後，以安全聚合查詢核對每個 active symbol 的 coverage、實際 published rows、51 個 completed items、零 missing dates，以及 `00919.TW`、`2330.TW` 的大戶／散戶歷史 UI。

復原 SQL 對 `symbol + data_date` 採 material changed-only upsert；同一快照重跑不會只因 `source_fetched_at` 不同而重寫既有歷史。暫存快照、SQL 與備份完成驗證後應從暫存目錄移除，不得放入 Git、OpenSpec 或部署 artifact。
