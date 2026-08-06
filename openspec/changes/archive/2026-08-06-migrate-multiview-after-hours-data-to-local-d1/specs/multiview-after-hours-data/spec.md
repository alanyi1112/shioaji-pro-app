## ADDED Requirements

### Requirement: 權威 D1 匯出必須從來源端限制為市場資料 allowlist
系統 MUST 在既有合法 OAuth session 下，以 Wrangler table allowlist 唯讀匯出 canonical market、candle、daily chip、TDCC 與 PE 資料。匯出 MUST 從產生時排除 user、tab、instrument ownership、Access、audit、secret、credential、帳戶、CA、委託、交易與未知 table；不得先匯出整庫再過濾。

#### Scenario: 合法授權且遠端 coverage 較完整
- **WHEN** aggregate preflight 證明遠端 D1 的某資料族群比本機完整
- **THEN** 系統 MUST 只對該族群的 allowlist tables 執行 data-only export
- **AND** 遠端 D1 MUST 保持唯讀，不得觸發 workflow、排程或部署

#### Scenario: 沒有合法授權
- **WHEN** 既有 OAuth session 不可用或唯讀 D1 request 被拒絕
- **THEN** 系統 MUST 停止遠端讀取，不得讀 cookie 或建立 bypass
- **AND** 對應資料族群 MUST 改走官方 bounded backfill 並保持 incomplete，直到 coverage 實際通過

### Requirement: 本機 seed 必須 staging-first 且原子可回復
每次 seed MUST 先在 repo 外、權限受限的 staging DB 套用目前 migrations、匯入 allowlist 資料並通過 schema equality、row count、date coverage、material hash 與 `PRAGMA integrity_check`。live DB 寫入前 MUST 建立通過 integrity 的備份，並在單一 transaction 以明確欄位合併；不得清空 live DB 或修改個人清單 tables。

#### Scenario: seed 成功
- **WHEN** staging 與備份 gates 全部通過且 transaction 完成
- **THEN** live DB MUST 通過 post-import integrity、row count、coverage 與 hash readback
- **AND** 個人清單的 row count、排序與 hash MUST 與匯入前一致

#### Scenario: schema drift 或匯入失敗
- **WHEN** table／column schema 不相容、transaction 失敗或 post-import gate 不通過
- **THEN** 系統 MUST rollback 並保留原 live DB 與備份
- **AND** 不得把該資料族群標示為完成

### Requirement: 盤後 coverage 必須以實際來源日期與代表商品證明
盤後資料驗收 MUST 保存每個 allowlist table 的 row count、distinct symbol、最早／最晚實際 source date、代表 `.TW`、`.TWO`、ETF、TDCC 與 PE coverage。TDCC MUST 使用 distinct 官方週日期與合法級距語意；PE MUST 使用實際 session／source date 與 verification 狀態。不得以 requested end date、空資料、排程曾執行或 HTTP 200 冒充 coverage。

#### Scenario: 某資料族群只有部分 coverage
- **WHEN** 代表商品缺少必要日期、TDCC 週數或 PE verified 資料
- **THEN** health 與 UI MUST 只將該族群標示 partial／pending／blocked 並顯示安全 reason code
- **AND** 其他已通過族群 MUST 保持可用

### Requirement: 既有盤後功能必須由本機 D1 完成可見驗收
所有既有盤後 pane、詳細資料、PNG export、下載、latest／history／TDCC／PE 回補、未發布 gap 與 run／coverage health MUST 從本機 D1 實際讀取並通過驗收。來源欄位、單位、發布日、缺值及不 forward-fill 契約 MUST 保持不變。

#### Scenario: 本機盤後資料完整
- **WHEN** 代表商品的本機 D1 coverage 通過且 UI 載入盤後功能
- **THEN** pane、詳細資料與匯出 MUST 顯示相同實際 source date 與資料語意
- **AND** runtime status MUST 顯示各資料族群的 completed／partial／pending，而不是單一模糊狀態
