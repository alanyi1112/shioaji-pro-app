## ADDED Requirements

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
