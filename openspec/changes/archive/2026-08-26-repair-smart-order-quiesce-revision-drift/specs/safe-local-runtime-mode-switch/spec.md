## ADDED Requirements

### Requirement: Runtime install 必須分離應用服務與 smart-order 的 Node authority

系統 MUST 讓 smart-order sidecar、diagnostics、repository probe 與 mode lease 使用符合 Node LTS `>=24.15.0 <25` 的持久化 private Node contract；Web、MultiView、watchdog 與資料 pipeline MUST 使用獨立的 application Node authority。application Node 不得改變、繞過或降級 smart-order 的版本、平台、generation、sender fence 或 write-master 安全閘門。

#### Scenario: 持久化 Node 無法由 LaunchAgent 讀取 Documents source
- **WHEN** smart-order Node 符合安全版本但 macOS 不允許該 binary 從背景讀取 repository 的 UI 或 pipeline source
- **THEN** Web、MultiView、watchdog 與資料 pipeline MUST 能改用 application Node 啟動
- **AND** smart-order sidecar MUST 繼續使用原本的持久化 Node contract

#### Scenario: Application Node 不符合 smart-order 版本範圍
- **WHEN** application Node 為 Node 25 以上，但持久化 smart-order Node 符合 Node LTS 安全範圍
- **THEN** 一般應用服務 MAY 使用 application Node
- **AND** smart-order sidecar、diagnostics、repository probe 與 mode lease MUST NOT 使用該 application Node

### Requirement: 安全 quiesce 不得被相同 epoch 的保守 revision 前進鎖死

當 durable repository 的 current runtime epoch、sender fence 與 API generation 均與 authenticated sidecar 相同時，lifecycle quiesce MUST 以 transaction 內讀取的目前 repository revision 執行單向安全收斂；controller 的 expected revision 因 continuity invalidation 或其他保守狀態前進而落後時，MUST NOT 要求 force bootout。此例外 MUST 只適用於關閉 dispatch 的 quiesce，不得套用交易或一般業務 mutation。

#### Scenario: Continuity invalidation 後執行安裝
- **WHEN** 同一 runtime epoch 因 continuity gap 從 revision 0 前進至 revision 1，controller 隨後要求 graceful stop
- **THEN** repository MUST 以 revision 1 作為 quiesce source revision，原子前進至 `quiescing`
- **AND** lifecycle operation identity、journal 與回傳 revision MUST 綁定 revision 1

#### Scenario: Epoch 或 generation 已改變
- **WHEN** quiesce 的 runtime epoch、sender fence 或 API generation 不再是 repository current authority
- **THEN** repository MUST fail-closed 且不得建立 lifecycle fence、暫停策略或停止服務

#### Scenario: 仍有 lifecycle obligation
- **WHEN** repository 目前 lifecycle projection 含 strategy、intent、order、reservation、claim、obligation 或 reconciliation blocker
- **THEN** quiesce MUST 回到 `observe_only` 或 `reconciling` 並回報 drain blocked
- **AND** runtime install MUST NOT bootout sidecar

#### Scenario: 已有不同 operation 的 quiesce
- **WHEN** durable runtime 已處於 `quiescing` 且 operation 與新請求不同
- **THEN** repository MUST 拒絕新請求並保留原 durable operation identity
