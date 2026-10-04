## ADDED Requirements

### Requirement: Stage GO 只能授予 durable active limit

Stage 160 `GO` MUST 只授予 durable `approvedActiveLimit=160` 與對應 capacity approval provenance。每個後續交易日仍 MUST 獨立通過 current-session trade date、baseline、config revision、artifact bundle、generation、control-plane 與 data-plane Gate；approval MUST NOT 自動產生當日 subscription confirmation、data active、results 或 notification authority。

產品執行器在當日 current-session authority 有效且正式 Stage 160 approval 相符時，MUST NOT 以昨日可變 capture runtime 的 `failed`／`complete_go` 作為今日上限判定；但當日 subscription／data-plane authority 仍須等真實事件個別成立。

#### Scenario: GO 後的下一個交易日
- **WHEN** Stage 160 已於前一日核准，而下一交易日尚未建立 current session
- **THEN** 系統 MUST 保留 approved limit 160，但今日 data active MUST 為 0 且 status MUST 顯示 current session 未完成

#### Scenario: 下一交易日 Gate 通過
- **WHEN** durable approval 有效且下一交易日所有 current-session Gate 通過
- **THEN** runner MUST 以相同 approved limit 建立今日固定 cohort，data active 仍須逐檔第一筆合法 KBar 才能增加

### Requirement: Capacity decision 必須保存 reviewer type 與證據日期

每筆 GO／NO-GO／rollback decision MUST 保存 reviewer type、reviewer identity 的非敏感識別、reviewedAt、evidence trade date、bundle hash 與授權 provenance。產品與 UI MUST 使用這些欄位產生文案，不得依 `evaluationState=go` 推論為人工簽核或當日決策。

#### Scenario: 使用者委託 Codex 代理審閱
- **WHEN** Codex 依使用者明確委託完成 evidence-based GO／NO-GO review
- **THEN** decision MUST 保存 `reviewerType=codex_delegated` 與委託 provenance
- **AND** 後續顯示 MUST NOT 將其改寫為 human／user sign-off
