## Context

本機 MultiView 已在 repo 外建立 SQLite／D1 相容資料庫並完成 22 個 migration，個人清單也已獨立遷移；但 market、completed candle、台股籌碼、TDCC 與 PE 歷史尚未完整 seed。Cloudflare 的 `multichart-production` D1 是目前可驗證的權威副本，且 Wrangler 支援 `d1 export --table`，因此可以在不匯出使用者／Access tables 的前提下取得精確 allowlist 資料。

本 change 只讀取遠端 D1，不修改遠端資料、不觸發 workflow 或部署。正式資料是否完成以來源 table、實際 source date、row count、coverage 與本機 UI/API readback 為準，不以 OAuth 登入、HTTP 200 或 migration 成功冒充。

## Goals / Non-Goals

**Goals:**

- 以既有合法 OAuth session 唯讀盤點遠端與本機 schema／coverage，選擇最少重複請求的 seed 路徑。
- 只匯出公開市場與盤後資料 allowlist，讓 export 從產生時就不包含 user、Access、audit、secret 或交易資料。
- 在 staging DB 驗證後，以備份加單一 transaction 合併至本機 live DB，不破壞已遷移的個人清單。
- 驗證 `.TW`、`.TWO`、ETF、TDCC 與 PE 的 row count、source date、coverage、hash、API 與 UI 行為。
- 讓缺少 coverage 的資料族群維持 incomplete，並由官方 bounded backfill 接續。

**Non-Goals:**

- 不匯出 `user_tabs`、`user_instruments`、`access_users`、`access_audit_log` 或任何個人／授權資料。
- 不保存 Cloudflare token、cookie、完整 remote dump 或市場資料於 repo。
- 不修改 Cloudflare D1、不手動觸發 schedule、不部署 Sites／Cloudflare。
- 不 forward-fill 未發布資料，也不把 requested end date 寫成 source date。

## Decisions

### 1. 使用 Wrangler table allowlist export，不先匯出整庫再過濾

先用 aggregate query 取得 table count、min／max source date、distinct symbol／date 與代表商品 coverage。若現有 OAuth session 合法，再以 `wrangler d1 export --remote --no-schema --table ...` 直接限制輸出 table；不得先產生含 user／Access 資料的完整 dump。

初始 allowlist 分為：

- canonical market：`instrument_catalog`、`candle_history`、`candle_history_state`。
- daily chip：`taiwan_stock_chip_daily`、`taiwan_stock_chip_fetch_state`。
- TDCC data／coverage：`taiwan_stock_shareholder_distribution`、`tdcc_shareholder_backfill_week`、`tdcc_continuous_symbols`、`tdcc_continuous_items`。
- PE data／coverage：`taiwan_stock_pe_valuation_daily`、`taiwan_stock_pe_fetch_state`、`taiwan_stock_pe_control`。

`user_*`、`access_*`、`runtime_metadata`、cache、run／job／dispatch operational logs 與未知 table 預設排除。若實作盤點證明某個 operational state 是安全且恢復 coverage 必要，必須先更新 allowlist、spec 與測試，不得臨時使用 wildcard。

### 2. 先比較 coverage，再決定 export 或 bounded backfill

對每個資料族群比較遠端與本機 row count、symbol count、最早／最晚實際資料日期及代表商品 coverage。遠端有較完整且合法資料時採 table export；遠端沒有或資料較舊時，使用現有官方 provider 的 bounded backfill。這比逐週或逐日全部重抓更省請求，也避免把過時遠端資料當權威。

### 3. Remote export 只落在權限受限的 repo 外暫存目錄

使用 `mktemp -d` 建立 mode 700 暫存目錄，export、aggregate report 與 staging DB 都只存在該目錄；完成驗收後刪除 export SQL，僅在 Application Support 保存不含資料內容的安全報告與 checksum。輸出到終端的摘要不得包含 email、SQL values、完整 symbol 清單或秘密。

### 4. Staging-first、schema equality 與 live transaction merge

先以目前 migrations 建立 staging DB，匯入 allowlist SQL，執行 integrity、schema equality、row count、date coverage 與 material hash。live DB 寫入前由 `scripts/multiview-state backup` 建立可驗證備份；接著 attach staging，在單一 SQLite transaction 依 table 的明確欄位執行 upsert。不得 `DROP` 或清空 live DB，也不得改動個人清單 tables。

若 transaction、integrity 或 coverage gate 失敗，rollback 並保留原 live DB；restore 只接受通過 integrity 與 schema revision 的精確備份。

### 5. 驗收以資料族群與代表商品為單位

至少驗證上市普通股／ETF `.TW`、上櫃 `.TWO`、TDCC 有資料商品及 PE 有效商品；代表代號依 remote preflight 的實際 coverage 選擇，不在 proposal 預先猜測。TDCC 以 distinct 官方週日期與 17 級語意驗收，PE 以實際 source／session date、verified／provisional 狀態與缺值語意驗收。

UI／API 驗收涵蓋所有既有盤後 pane、詳細資料、PNG export、latest／history／TDCC／PE 回補、未發布 gap、partial／blocked／retry 與 run-specific health。某族群不完整時只將該族群標示 incomplete，不清除其他成功資料。

## Risks / Trade-offs

- [OAuth session 過期] → 停止遠端讀取，不讀 cookie、不建立 bypass；改用官方 bounded backfill，未完成族群保持 incomplete。
- [遠端 export 很大] → 先 aggregate、逐 table allowlist export、比較 coverage，避免不必要 table 與重抓。
- [schema drift 導致錯欄寫入] → staging migration、table／column equality gate、明確欄位 upsert，任何 drift fail closed。
- [匯入覆蓋較新本機資料] → 依 table 的 canonical key 與 source date／updated_at 規則只接受較新或同版本 material change；不以執行時間決定新舊。
- [SQLite transaction 或磁碟中斷] → live backup、單一 transaction、rollback、post-import integrity 與 hash readback。
- [公開市場資料 dump 意外進 Git] → repo 外暫存、`.gitignore` defense、staged artifact name scan 與秘密掃描。

## Migration Plan

1. 驗證既有 Wrangler OAuth、D1 identity 與唯讀權限，不輸出 token。
2. 對 allowlist tables 執行 remote／local aggregate preflight，產生去識別化差異摘要。
3. 對遠端較完整族群執行 `--table` data-only export；其他族群規劃 bounded official backfill。
4. 建立 staging DB、匯入並通過 schema、integrity、coverage 與 hash gate。
5. 備份 live DB，以 transaction 合併 allowlist tables，驗證個人清單 hash 未變。
6. 重啟 MultiView，驗證 API、盤後 pane、下載、回補、缺值與 health。
7. 刪除暫存 SQL／staging DB，只保存安全報告；未達門檻者維持 pending。

回滾時停止 5174，對備份執行 integrity check 後精確 restore，重啟並比對 schema、個人清單與代表商品；遠端 D1 從未被修改。

## Open Questions

- 各資料族群是否採 remote export 或官方 backfill，由當次 aggregate preflight 的實際日期與 coverage 決定。
- 代表 `.TW`、`.TWO`、TDCC 與 PE 商品由當次資料選出，驗收報告需保存選擇理由與來源日期。
