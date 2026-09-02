## ADDED Requirements

### Requirement: TDCC 盤後工作必須先重用 verified market periods 再補官方缺口

本機 scheduler、Sites workflow 與 Cloudflare workflow MUST 在官方 TDCC continuous history claim 前，先以資料庫中已 verified 的全市場 period rows 對 active targets 執行 coverage reconciliation；符合官方 period plan 的完整 rows MUST 精準完成相同 items，官方 runner 只可 claim remaining dates。Archive reconciliation、official latest 與 official history MUST 共用 single-flight、lease、checkpoint、request／time budget 與可重入終態，不得形成彼此重複或競爭的無界工作。

#### Scenario: 新商品已存在預先匯入資料

- **WHEN** 使用者新增一檔 active TDCC target，而資料庫已保存該商品多個 verified market periods
- **THEN** scheduler MUST 先以本機 rows 更新 completed／remaining，再只 dispatch 或 claim 缺少的官方日期
- **AND** 不得為已完成日期重新呼叫 TDCC 歷史表單

#### Scenario: Archive lane 暫時不可用

- **WHEN** manifest、GitHub transport、hash 或 staging run 失敗
- **THEN** 既有 official latest／history scheduler MUST 按原 bounded 契約繼續處理 remaining
- **AND** 系統不得停止官方 pipeline、清空已驗證資料或將 archive 失敗誤報為官方資料失效

### Requirement: TDCC health 必須分離快速補入與官方完整度

盤後 health 與逐商品 status MUST 分別呈現 archive manifest／receipt version、archive target／processed／remaining／failed／overdue、archive imported weeks、official verified weeks、51 週 expected／completed／remaining、最近 official source date、最後成功 run 與安全 reason code。單一 HTTP 200、archive seed 完成、官方 scheduler 曾執行或最新一期存在，均不得單獨表示 51 週完整。

#### Scenario: 快速補入完成但仍缺官方歷史

- **WHEN** 某商品的所有核准 archive periods 已匯入，但 51 週 plan 仍有缺口
- **THEN** health MUST 顯示 archive complete 與 official backfill pending，並回報精確 distinct week counts
- **AND** 整體不得標示 full complete

#### Scenario: Archive 與 official 都完整

- **WHEN** 所有 archive receipts 已完成且逐商品 51 週 plan 的 remaining、failed、overdue 都為零
- **THEN** health 才可將該商品標示 completed
- **AND** run evidence MUST 能追溯每個 completed date 的 verified row 與來源類型

### Requirement: Archive operator 不得改變 runtime 與交易生命週期

Archive seed、period reconciliation、官方補缺與驗收 MUST 是 data-only 工作，MUST NOT bootout、bootstrap、停止或切換 Shioaji simulation API、business-session watchdog、5173、5174、其他盤後 pipeline、行情連線或交易服務。任一 archive request MUST NOT 建立訂閱、委託、帳戶或 CA 操作。

#### Scenario: 背景 seed 正常或失敗

- **WHEN** operator 開始、續跑、完成、timeout 或 rollback archive period
- **THEN** 既有 runtime／行情／交易服務狀態 MUST 保持不變
- **AND** runtime 生命週期事件與交易呼叫計數 MUST 為零
