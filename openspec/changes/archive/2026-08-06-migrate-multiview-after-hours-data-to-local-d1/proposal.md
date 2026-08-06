## Why

本機 MultiView 的 schema 與個人清單已可用，但盤後 market／chip／history coverage 尚未從權威資料來源遷入，因此 runtime 只能顯示 `multiview_after_hours=unknown`，也不能證明既有籌碼副圖、TDCC、本益比河流、下載與回補在本機 D1 完整運作。現在需要用最少重複請求、可稽核且不搬移個資的方式完成 seed 與功能驗收。

## What Changes

- 重新確認既有 Cloudflare OAuth 授權、權威 D1 名稱、schema、table row count、source date 與 coverage；只使用官方 CLI／API，不讀 browser cookie、不建立 bypass、不輸出 token。
- 先以 aggregate query 比較權威 D1 與本機 D1 的 market／candle／chip／TDCC／PE coverage，再選擇直接 data-only export 或官方 bounded backfill，避免重新下載已存在的資料。
- 建立固定 allowlist 的市場資料匯出／匯入工具；只允許公開或授權使用的 market／chip／history rows 與必要 pipeline state，排除 Access、audit、user、tab、instrument、secret、credential、交易及帳戶資料。
- 匯入前對本機 SQLite 建立帶時間與 schema revision 的備份，先驗證備份 integrity，再以單一 transaction 匯入；任一步驟失敗都不得替換目前可用資料庫。
- 匯入後執行 `PRAGMA integrity_check`、table row count、最早／最晚 source date、coverage 與 material hash 驗收，至少涵蓋 `.TW`、`.TWO`、ETF、TDCC 52 週語意與 PE 代表商品。
- 實際驗證所有既有盤後 pane、詳細資料、圖片匯出、下載、latest／history／TDCC／PE 回補、未發布缺值與 run／coverage health 都能由本機 D1 正常工作。
- 若權威 D1 沒有某一資料族群或合法授權不可用，該族群 MUST 走既有官方 bounded backfill 並維持 incomplete，禁止以空資料、requested end date 或 forward-fill 冒充完成。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `multiview-after-hours-data`: 增加權威 D1 data-only export、公開市場資料 allowlist、最少重複請求決策、transaction seed、代表商品 coverage 與本機盤後功能終驗要求。
- `multiview-local-runtime`: 增加本機 D1 seed／restore 的原子切換、去識別化健康摘要與資料族群 incomplete 邊界。

## Impact

- 工具：`apps/multiview/scripts/` 的 D1 preflight／export／seed／verify 工具，以及 `scripts/multiview-state` 的備份與 restore 路徑。
- 資料：repo 外 `~/Library/Application Support/RealTimeStock/MultiView/` SQLite、備份及去識別化 migration report；repo 不保存 D1 export 或市場資料 dump。
- MultiView Worker／UI：盤後 health、coverage、source date、下載／回補與缺值狀態驗收；不改變來源欄位、單位或發布日語意。
- Cloudflare：僅以既有合法 OAuth session 執行唯讀 metadata／query／export，不修改遠端 D1、不觸發部署或遠端排程。
- 安全：禁止匯出或保存 Access、audit、user、email、secret、credential、帳戶、CA、委託及交易資料。
