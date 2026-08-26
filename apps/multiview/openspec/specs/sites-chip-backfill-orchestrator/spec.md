# sites-chip-backfill-orchestrator Specification

## Purpose
TBD - created by archiving change move-chip-backfill-orchestration-into-sites-runtime. Update Purpose after archive.
## Requirements
### Requirement: 籌碼回補編排部署於 Sites Worker

系統 MUST 將目標同步、最新 TDCC 快照、日籌碼批次挑選、heartbeat、續跑與完成判定實作於隨網站發布的 Sites Worker；外部 scheduler MAY 喚醒受保護 tick，但 MUST NOT 自行決定上述業務流程。

#### Scenario: GitHub cron 喚醒背景工作
- **WHEN** GitHub Actions 的真實 `schedule` event 到達執行時間
- **THEN** workflow MUST 只呼叫受保護的 Sites orchestrator start／tick
- **AND** latest 與 daily 的目標及完成判定 MUST 由 Worker／D1 回應決定

#### Scenario: Sites runtime 取得原生排程事件
- **WHEN** 部署環境向 Worker 發送 `scheduled` event
- **THEN** `scheduled` handler MUST 啟動相同 orchestrator 程式
- **AND** MUST NOT 依賴前端流量或 ChatGPT 排程

### Requirement: 每日與每週編排責任必須分離

orchestrator MUST 支援可稽核的 `daily` 與 `tdcc-weekly` scope；`daily` MUST 只處理日籌碼 due symbols，`tdcc-weekly` MUST 只處理 TDCC 最新週快照與歷史 adapter 邊界。為相容既有入口，系統 MAY 接受 `combined`，但新排程 MUST NOT 使用它。

#### Scenario: 每日籌碼排程執行
- **WHEN** 每日 workflow 以 `daily` scope 啟動 run
- **THEN** Worker MUST 執行日籌碼 discovery、有限批次預熱與完成判定
- **AND** MUST NOT 讀取 TDCC 最新週快照或建立 TDCC continuous run

#### Scenario: 每週 TDCC 排程執行
- **WHEN** 每週 workflow 以 `tdcc-weekly` scope 啟動 run
- **THEN** Worker MUST 同步 target、驗證並保存 TDCC 最新週快照
- **AND** MUST NOT 執行日籌碼 discovery 或預熱

### Requirement: 受保護 tick 可有限批次續跑

orchestrator MUST 以 D1 保存 run phase、heartbeat、預期交易日、已處理數、剩餘 due 與安全錯誤碼；每個 tick MUST 使用有限批次，並可由後續 tick 冪等續跑至完成。

#### Scenario: 目標數超過單次批次
- **WHEN** 本輪 due symbols 多於單一 Worker tick 的安全批次
- **THEN** tick MUST 保存已處理與剩餘數量並回傳 `done=false`
- **AND** 後續 tick MUST 從尚未於冷卻期內嘗試的 due symbol 繼續

#### Scenario: 重複 start 或 tick
- **WHEN** 相同 run id 因網路重送而再次 start 或 tick
- **THEN** D1 狀態與資料寫入 MUST 維持冪等
- **AND** MUST NOT 建立平行的相同 run 或重複計算已完成批次

### Requirement: Orchestrator health 可安全稽核

`/api/health` MUST 回報最近 orchestrator run 的 scope、trigger、phase、status、expectedSessionDate、processedSymbols、remainingSymbols、heartbeat 與 allowlist reason；MUST NOT 暴露 secret、授權 header、cookie、上游完整 response 或使用者身分資料。

#### Scenario: 官方資料尚未發布
- **WHEN** tick 成功連線但實際 coverage 尚未到 expectedSessionDate
- **THEN** health MUST 區分 `source_not_published` 與程式失敗
- **AND** MUST 保留既有 D1 資料與下一輪續跑能力

#### Scenario: Orchestrator 完成
- **WHEN** latest 已檢查且本輪沒有可處理的 daily due symbol
- **THEN** health MUST 顯示完成 phase、零剩餘 due 與最新 heartbeat
- **AND** 使用者 MUST 能分辨此終態與外部歷史 source adapter 狀態

### Requirement: 外部喚醒失敗必須安全收尾

受保護 tick 的回應 MUST 提供只含 allowlist 欄位的 workflow 摘要，包括 `phase`、`status`、`processedSymbols`、`remainingSymbols`、`pendingSymbols` 與 `reason`；外部喚醒者遇到 HTTP 失敗、無效回應或 tick 上限時，MUST 透過受保護失敗終結點關閉 orchestrator run 與對應 TDCC run，且 retryable 失敗 MUST 保存下一次可重試時間。

#### Scenario: Tick 上限到期仍未完成
- **WHEN** workflow 已達允許的 tick 次數且 Worker 仍回傳 `done=false`
- **THEN** workflow MUST 只記錄安全 phase／計數／reason 摘要
- **AND** MUST 以 `tick_limit_exceeded` 將 orchestrator 標記 failed、將 TDCC run 標記 failed／retry-waiting，且歷史 adapter MUST NOT 執行

#### Scenario: Start 或 tick 發生 HTTP 失敗
- **WHEN** 受保護 request timeout、回傳非成功 HTTP 或不符合摘要契約
- **THEN** workflow MUST NOT 輸出 response body、secret、header 或 cookie
- **AND** MUST 嘗試以 allowlist reason 執行冪等失敗收尾；Worker 自身錯誤處理也 MUST 關閉已建立的兩種 run 狀態

#### Scenario: 失敗收尾重送
- **WHEN** workflow trap 與 Worker error handler 對相同 run 重複執行失敗收尾
- **THEN** 已完成 run MUST NOT 被改寫為失敗
- **AND** 已失敗 run MUST 維持原 retry 終態，不得因重送延後下一次可重試時間

### Requirement: TDCC 歷史來源 adapter 邊界

需要可見表單 session 的 TDCC 歷史資料 MAY 由外部 source adapter 讀取，但 target、claim、plan、lease、validator、ingest 與完成狀態 MUST 由 Sites Worker／D1 管理；adapter MUST NOT 再執行 latest 或 daily 編排。

#### Scenario: 歷史 queue 有缺週
- **WHEN** Sites Worker claim 一個合法 TDCC 歷史工作
- **THEN** adapter MAY 依 plan 讀取官方歷史表單並送回受保護 ingest
- **AND** Worker MUST 驗證並保存資料與 queue 終態

#### Scenario: 沒有歷史缺口
- **WHEN** Worker 回報沒有可 claim 的歷史工作
- **THEN** adapter MUST 成功 no-op 結束
- **AND** MUST NOT 重新執行 TDCC latest 或日籌碼預熱

### Requirement: 排程喚醒必須在資源上限內持續處理多批目標

scheduled handler MUST 在同一 run 內執行有上限的多個 tick，直到 `done=true`、沒有進度或達到合約上限；MUST NOT 在仍有大量 due symbols 時固定只執行一個 symbol 後結束。

#### Scenario: 五十個目標等待每日預熱
- **WHEN** scheduled handler 啟動 daily run 且 due symbols 多於單一 tick batch
- **THEN** handler MUST 以相同 run id 接續處理後續 tick
- **AND** 達到上限時 MUST 保留 processed／remaining 計數與 checkpoint 供下一次接續

### Requirement: 單一目標錯誤不得中止整批預熱

orchestrator MUST 隔離逐 symbol 的 eligibility、provider 或 response validation 錯誤，將其記錄為 allowlist reason 後繼續處理其他 due symbols；只有 run state、D1 或整體契約無法維持時才可將整輪標示 failed。

#### Scenario: 一檔商品回傳 invalid_response
- **WHEN** 批次中一個 symbol 的供應者回應無法驗證，但後續 symbol 仍可處理
- **THEN** orchestrator MUST 保留該 symbol 的安全失敗原因並繼續後續目標
- **AND** run 的 processed 與 remaining 計數 MUST 反映實際進度，不得停在零

