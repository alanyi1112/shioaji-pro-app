## ADDED Requirements

### Requirement: MultiView 必須提供去識別化的 document-local 驗收計數
MultiView MUST 在目前 browser document 維護固定版本的安全驗收快照，內容只得包含 panel、SSE、canonical demand、subscribe、unsubscribe、行情 request、indicator full-recompute、render churn、long task、bounded duration、JS heap 可用性／總量與 allowlist reason code。快照 MUST NOT 包含商品代號清單、行情內容、個人清單、帳戶、CA、token、secret 或可回推出個人的時間序列。

#### Scenario: 八圖含重複商品
- **WHEN** 同一 document 顯示八圖且至少兩圖為相同 canonical 商品
- **THEN** 驗收快照 MUST 顯示一條 document SSE，且 active canonical demand 不得因重複 panel 增加

#### Scenario: 讀取驗收快照
- **WHEN** 本機 browser 驗收工具讀取快照
- **THEN** 系統 MUST 回傳固定安全 schema 與 bounded 計數
- **AND** schema 測試 MUST 拒絕 symbol、quote、account、credential 或任意未列名欄位

### Requirement: 多圖效能驗收必須保存可重現證據
系統 MUST 對 1／2／3／4／6／8 圖、重複商品、快速切換與背景／前景循環保存 panel、SSE、subscription、request、render、long task、JS heap 可用性與畫面錯誤摘要。平台不支援的數值 MUST 標示 `unsupported`，不得補造數值。

#### Scenario: 完成多圖矩陣
- **WHEN** 驗收工具依序完成所有圖數與 lifecycle 情境
- **THEN** 證據 MUST 證明 SSE 不超過一條、重複商品訂閱去重、舊 demand 可釋放、無未處理錯誤且指標結果保持一致
