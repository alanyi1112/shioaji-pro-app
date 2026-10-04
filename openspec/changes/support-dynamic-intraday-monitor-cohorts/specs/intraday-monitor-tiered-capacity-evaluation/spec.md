## ADDED Requirements

### Requirement: 歷史 Stage-160 證據不得與產品每日容量資格混用

Stage-160 的 immutable exact-cohort manifest、完整日證據與 reviewer GO MUST 保留原始商品、順序、日期及判定，僅作當次 stage 驗收。核准後的產品容量上限 MAY 被每日不同的合法商品組合使用，但每個組合 MUST 另行通過當日交易日、基準、設定 revision、session 及資源 Gate；產品每日就緒不得命名或呈現為歷史組合的重做驗收。既有 failed／partial evidence MUST NOT 被每日 plan 成功結果覆寫。

#### Scenario: 當日名單不同於歷史驗收名單

- **WHEN** 當日產品選出另一組不超過 160 檔的合法商品
- **THEN** 系統 MUST 保留歷史 Stage-160 bundle 不變，另存當日 plan 與 Gate 證據
- **AND** 不得以名單不同單獨撤銷已核准容量，也不得以歷史 GO 單獨宣稱新組合資料完整

#### Scenario: 查閱先前失敗驗收

- **WHEN** 使用者查看 9/23–9/29 已保存的 failed／partial 收據
- **THEN** 系統 MUST 保留其原始狀態與來源，不得以新動態名單機制改寫成成功
