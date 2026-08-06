## 1. 權限與 coverage 前置盤點

- [x] 1.1 記錄 HEAD、dirty scope、本機 D1 path／schema／integrity 與 simulation runtime，確保資料遷移不碰先前取消 change。
- [x] 1.2 以 `wrangler whoami` 與唯讀 aggregate query 確認既有 OAuth、權威 D1 identity、schema 與 allowlist table availability，不輸出 token 或個資。
- [x] 1.3 比較 remote／local 各資料族群 row count、distinct symbol、min／max source date 與代表 coverage，記錄 export／bounded backfill 決策。

## 2. Data-only export 與 staging 工具

- [x] 2.1 建立固定 market／candle／chip／TDCC／PE table allowlist 與 forbidden table／field gate，未知 schema fail closed。
- [x] 2.2 建立 repo 外 mode 700 暫存目錄，以 `wrangler d1 export --table --no-schema --remote` 只匯出需要的資料族群。
- [x] 2.3 以目前 migrations 建立 staging DB、匯入 export，驗證 table／column equality、row count、date coverage、material hash 與 `PRAGMA integrity_check`。
- [x] 2.4 加入 dry-run、安全摘要、錯誤 allowlist、export 清理與測試，確保 repo／log／report 不含 SQL values、個資或秘密。

## 3. 本機原子 seed 與復原

- [x] 3.1 seed 前建立 live DB 備份並驗證 integrity、schema revision、個人清單 row count／hash。
- [x] 3.2 以 attach staging 與單一 transaction 按明確欄位合併 allowlist tables，不清空 live DB、不修改個人清單與 Access tables。
- [x] 3.3 匯入後驗證 live integrity、row count、source date、coverage、material hash及個人清單 hash 不變，失敗時 rollback／restore。
- [x] 3.4 在 Application Support 保存去識別化 seed report，runtime status 分資料族群顯示 completed／partial／pending／blocked。

## 4. Coverage 與盤後功能驗收

- [x] 4.1 驗證實際 `.TW`、`.TWO`、ETF 代表商品的 canonical candle 與 daily chip coverage。
- [x] 4.2 驗證 TDCC 代表商品 distinct 官方週日期、17 級語意、continuous state 與缺值／上市前 gap。
- [x] 4.3 驗證 PE 代表商品 source／session date、verified／provisional／gap 與 percentile／river payload。
- [x] 4.4 驗證所有既有盤後 pane、詳細資料、PNG export、下載與未發布缺值畫面從本機 D1 正常使用。
- [x] 4.5 驗證 latest／history／TDCC／PE 本機回補及 run／coverage health；不足族群保持 incomplete 並執行 bounded official backfill。

## 5. 最終驗證

- [x] 5.1 完成 migration unit／contract／integration tests、MultiView lint／typecheck／build／tests、governance、audit、秘密掃描與 `git diff --check`。
- [x] 5.2 更新本機資料操作文件與安全驗收證據，執行 `openspec validate migrate-multiview-after-hours-data-to-local-d1 --strict`。
