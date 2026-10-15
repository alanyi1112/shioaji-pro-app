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

### Requirement: 收尾驗證拒絕必須保留真實資料與具體資源診斷

本 Requirement 的完整 capture／replay／Stage 資源報告 MUST 僅適用於明確選用的 legacy diagnostic，不能成為現行 daily 的必要依賴。daily MUST 依 `intraday-monitor-daily-runtime` 保留輕量真實來源、資源與故障證據，不得以 Stage 報告缺席撤銷已保存的合法 observation 或另造完整 capture。

正式收尾 MUST 使用鎖定 plan 的原資源預算，逐欄保存量測值、門檻、比較方向與拒絕 reason code；未知或不合法量測 MUST NOT 變成零或通過。啟動、每五分鐘及首次超標、最終收尾 MUST 保存有界非敏感資源診斷；盤中樣本的磁碟值只代表啟動量測，最終收尾仍重新核對磁碟。若真實完整 session 及 replay 已完成而資源驗證拒絕，MUST 先以不可覆寫 writer 保存含資料、replay、原量測與拒絕原因的主 capture，再回報失敗；正式驗收／bundle／通知權限仍不得授予。失敗 sidecar MUST 分辨主檔真正保存與未保存，已保存時附核實 SHA-256。缺少原全日量測的事後 SQLite 或盤後來源對照 MUST 明記事後稽核，不得冒稱原排程成功。

#### Scenario: 全日資料完整但資源預算超標
- **WHEN** 同日 160×270 真實資料與 replay 均已完成，但資源量測超過原 plan 預算
- **THEN** 系統 MUST 保存主 capture 的 session／replay／量測／拒絕原因與 failure sidecar，且正式驗收 MUST 為 false
- **AND** MUST NOT 放寬預算、丟掉主資料、覆寫失敗收據或只留下不可歸因的通用錯誤

#### Scenario: 原失敗程序未保存資源峰值
- **WHEN** 舊程序只有通用失敗 sidecar 與 SQLite observation，沒有原 capture 或全日資源量測
- **THEN** 事後對照 MUST 保留原件、明列資源 unknown，MUST NOT 用目前資源值或盤後基準補造原正式驗收
