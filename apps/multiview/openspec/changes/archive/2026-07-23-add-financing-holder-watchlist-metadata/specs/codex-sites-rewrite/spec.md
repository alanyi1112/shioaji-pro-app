## MODIFIED Requirements

### Requirement: 使用者清單持久化

系統 MUST 使用 Sites D1 保存使用者自訂頁籤與商品清單，並以 Sites 伺服器端使用者識別隔離資料。每個新加入的台股商品 MUST 同時保存伺服器判定的 `addedAt`、可選 `recommender` 及加入紀錄識別碼；既有項目缺少可信加入日期時 MUST 以 nullable 欄位與 `legacy_unknown` 向後相容，不得偽造日期。系統 MUST NOT 因這些 metadata 建立投資報酬、報酬率、理論上下限或績效追蹤資料。

#### Scenario: 儲存個人頁籤
- **WHEN** 已識別使用者新增或修改個人頁籤
- **THEN** 重新載入頁面後 MUST 取得該使用者保存的資料
- **AND** 其他使用者不得讀取或寫入這些內容

#### Scenario: 儲存新加入商品的 metadata
- **WHEN** 已識別使用者在個人頁籤加入台股商品並填寫推薦人
- **THEN** D1 MUST 原子保存商品、伺服器加入日期、推薦人及加入紀錄識別碼
- **AND** 重新載入或從另一裝置登入後 MUST 顯示相同資料

#### Scenario: migration 遇到既有商品
- **WHEN** D1 既有清單項目沒有 `addedAt`
- **THEN** migration MUST 保留該項目並設定 `addedAt=null` 與 `legacy_unknown`
- **AND** MUST NOT 使用 migration 執行日、檔案時間或最後修改日冒充加入日期

#### Scenario: 刪除後重新加入
- **WHEN** 使用者刪除某商品後再次加入
- **THEN** 系統 MUST 建立新的加入紀錄識別碼及新的伺服器加入日期
- **AND** MUST NOT 恢復前一筆已刪除紀錄的 metadata

#### Scenario: 不建立績效資料
- **WHEN** 系統保存、讀取或更新清單商品的加入日期與推薦人
- **THEN** D1 與 API MUST NOT 建立績效結果、交易日窗口或投資報酬欄位
- **AND** 前端 MUST NOT 因 metadata 變更觸發價格追蹤計算
