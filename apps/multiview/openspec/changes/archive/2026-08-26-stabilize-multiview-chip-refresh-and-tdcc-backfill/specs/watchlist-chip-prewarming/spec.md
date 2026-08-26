## ADDED Requirements

### Requirement: 日籌碼健康狀態必須使用自身 orchestrator 紀錄

watchlist 日籌碼預熱 health MUST 使用最近的 `daily` 或相容 `combined` chip backfill orchestrator heartbeat、status 與 safe reason；MUST NOT 使用 TDCC continuous run 的 heartbeat 代表日籌碼排程狀態。預熱完成條件 MUST 使用正式來源可持續提供且足以涵蓋圖表需求的最近一年資料，不得要求來源無法穩定提供的兩年範圍而讓所有目標永久 pending。

#### Scenario: 日籌碼成功但 TDCC scheduler 過期
- **WHEN** 最近 daily orchestrator 已成功更新，而 TDCC continuous scheduler heartbeat 已過期
- **THEN** watchlist prewarming health MUST 依 daily orchestrator 顯示目前狀態
- **AND** TDCC health MUST 獨立顯示 `scheduler_stale`，兩者不得互相覆蓋

#### Scenario: Daily orchestrator 失敗
- **WHEN** 最近 daily orchestrator run 為 failed 且帶有 allowlist reason
- **THEN** health MUST 顯示日籌碼失敗或 degraded 狀態及安全 reason
- **AND** MUST 保留各資料集最新實際 source date 供判讀

#### Scenario: 新商品已具一年日資料
- **WHEN** 新商品四種日籌碼資料均已涵蓋最近一年且最新 source date 到達 expected session
- **THEN** health MUST 將該商品計為 ready
- **AND** MUST NOT 因缺少一年以前資料而每天重新排入 due queue
