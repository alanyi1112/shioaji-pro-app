## ADDED Requirements

### Requirement: 本機 D1 seed 報告必須去識別化且可重現
系統 MUST 在 Application Support 保存不含資料內容的 seed report，記錄 schema revision、allowlist table、remote／staging／local row count、date coverage、material hash、備份識別、結果與 allowlist reason code。報告 MUST NOT 包含 SQL values、完整 symbol 清單、email、user ID、Access／audit、secret、credential、帳戶或交易資料。

#### Scenario: 查看 seed 結果
- **WHEN** 使用者或 runtime status 讀取最近一次 seed report
- **THEN** 系統 MUST 分資料族群顯示 completed／partial／pending／blocked、source date、processed 與 remaining 安全摘要
- **AND** 不得只因 D1 可開啟或 integrity 為 ok 就顯示盤後資料完整

### Requirement: 市場資料匯入不得破壞本機個人狀態
市場資料 seed、restore 與 bounded backfill MUST 與 `user_tabs`、`user_instruments` 及 RealTimeStock watchlist 隔離。任何市場資料 transaction 前後 MUST 比對本機個人清單 row count 與 material hash，差異時 MUST rollback 或停止啟用。

#### Scenario: 匯入市場資料
- **WHEN** allowlist staging DB 合併至 live DB
- **THEN** 個人清單 row count、tab／instrument 排序與 material hash MUST 保持不變
- **AND** 不得建立或修改 Access、audit 或交易資料
