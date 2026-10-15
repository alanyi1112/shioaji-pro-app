## ADDED Requirements

### Requirement: Stage 容量審閱與日常運作必須以模式區分

原 Stage capture／bundle／資源審閱／GO 契約 MUST 在 diagnostic 模式保留原語意，既有 artifact 與 failed 原值不得改寫。daily 模式 MUST 使用有效 durable capacity approval 及當日實際 session／來源／基準／資源保護，不必每日生成新 Stage capture／bundle 或取得 GO；未要求的診斷證據不得導致 daily Gate 拒絕。

日常模式的現有上限 MUST 維持 active 160／configured 200，不得藉模式遷移提高容量、取消 headroom 或自動啟用動態名單。daily 結果不得反向取得 Stage capacity approval，v2 基準不得當成 v1 Stage source validation。

#### Scenario: Stage 報告不存在但日常資格合法

- **WHEN** 今日 daily qualification 通過且歷史 durable 容量核准有效，但未執行 diagnostic
- **THEN** 系統 MUST 正常監控並顯示 diagnostics not_requested，不得要求每日重新 GO

#### Scenario: 診斷故障不撤銷合法日常資料

- **WHEN** 選用 Stage 報告組裝／replay 失敗，但已保存合法日常 observation
- **THEN** 系統 MUST 保留日常資料與原容量核准，另列診斷失敗，不得倒改當日結果或把診斷宣稱通過

#### Scenario: 容量或資源安全不成立

- **WHEN** durable approval 無效、實際容量超限或日常 backpressure／磁碟保護觸發
- **THEN** daily MUST 拒絕或安全退化並記錄原因，不得用取消 Stage 報告當作跳過安全 Gate 的理由
