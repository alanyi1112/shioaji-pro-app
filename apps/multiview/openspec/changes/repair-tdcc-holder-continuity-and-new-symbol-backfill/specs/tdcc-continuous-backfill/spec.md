## ADDED Requirements

### Requirement: TDCC 完整度必須由官方週次身分證明

系統 MUST 以 TDCC 官方歷史日期集合建立逐 symbol 日期計畫，並將已驗證分布資料、合法 `pre_listing` 與合法 `not_published` 視為各自可稽核的 resolved date；row count、最新快照日期、請求成功時間或 `expectedWeeks === completedWeeks` 單獨成立時 MUST NOT 宣告歷史完整。`completed` MUST 同時滿足至少最近 51 個官方週次均已規劃、每個計畫日期均 resolved、沒有 missing／failed date，且計畫已涵蓋最新官方 `dataDate`。

#### Scenario: 筆數足夠但中間缺少官方週次
- **WHEN** 某 symbol 已保存至少 51 筆分布資料，但官方日期集合中的 `2026-08-07`、`2026-08-14` 或任一中間日期沒有資料列或合法 gap item
- **THEN** 該 symbol MUST 顯示 `queued` 或 `partial`，並將每個缺少日期建立為 gap item
- **AND** 系統 MUST NOT 因總筆數足夠而保留 `completed`

#### Scenario: 最新 OpenAPI 快照晚於已驗證計畫
- **WHEN** 最新官方 OpenAPI 保存新的 `dataDate`，但目前 symbol 的官方日期計畫尚未涵蓋至該日期
- **THEN** 系統 MUST 將該 symbol 標示為需要 reconcile 並保持可 claim
- **AND** 下一次 runner MUST 取得官方日期集合、補建介於舊計畫與最新日期間的日期工作，再重新計算完成狀態

#### Scenario: 合法上市前或查無資料週
- **WHEN** 官方日期屬於商品上市前，或官方表單合法回覆該 symbol 在該日期查無資料
- **THEN** 系統 MUST 以 `pre_listing` 或 `not_published` resolved item 保存日期與原因
- **AND** MUST NOT 建立虛構分布資料、forward-fill 或只增加匿名完成筆數

#### Scenario: 逐 symbol 完整度重新計算
- **WHEN** operator、migration 後 reconciliation 或 durable scheduler 稽核既有 active targets
- **THEN** 系統 MUST 從官方日期計畫及逐日期 resolved evidence 重新計算 expected、completed、missing 與狀態
- **AND** MUST 保留已驗證 rows，只建立缺少工作並修正錯誤狀態

### Requirement: 新增 TDCC target 必須完成有界背景交接

新增或重新啟用合格台股後，系統 MUST 先耐久保存 target 與 queue，再於 deployment 可用的背景執行面完成 runner handoff；遠端 deployment MUST 嘗試既有受保護 workflow dispatch，本機 deployment MUST 由不依賴 GitHub token 的 queue watcher 在最晚五分鐘內接手 runnable target。完整歷史 MAY 分批完成，但系統 MUST 可證明工作已排隊、已被接手或因安全原因無法啟動，不得只留下無限期 `queued`。

#### Scenario: 本機新增商品且 GitHub dispatch 未設定
- **WHEN** 本機使用者新增一檔合格台股，target 已排隊但 GitHub dispatch 不可用
- **THEN** 本機 queue watcher MUST 在最晚五分鐘內偵測 runnable target，並以既有 single-flight／lease runner 接手
- **AND** 沒有 runnable target 時 watcher MUST 成功 no-op，且不得查詢 TDCC 歷史來源

#### Scenario: 遠端 workflow dispatch 成功
- **WHEN** Sites 或 Cloudflare deployment 保存新 target 且受保護 dispatch 設定完整
- **THEN** 系統 MUST 將對應 deployment 的 TDCC workflow 啟動請求送出並保存安全結果
- **AND** 不得將另一個 deployment 的 run、D1 或 credential 當成已接手證據

#### Scenario: 遠端 dispatch 不可用
- **WHEN** 遠端 deployment 缺少 dispatch 設定、GitHub API 失敗或被節流
- **THEN** target／queue MUST 保留，API 與 health MUST 顯示 `dispatch_not_configured`、`dispatch_failed` 或同等 allowlist 狀態
- **AND** 系統 MUST NOT 宣稱 runner 已開始，既有 durable scheduler 與手動受保護入口 MUST 仍可接手

#### Scenario: 重複 watcher 與週末排程相遇
- **WHEN** queue watcher、週末主要同步、隔日重試或手動受保護 run 同時嘗試接手相同 target
- **THEN** run id、lease 與 single-flight MUST 讓同一 symbol／date 只有一個有效 owner
- **AND** 其他執行 MUST 安全 no-op 或處理不同可 claim 工作
