# watchlist-item-metadata Specification

## Purpose
TBD - created by archiving change add-financing-holder-watchlist-metadata. Update Purpose after archive.
## Requirements
### Requirement: 清單商品加入日期

系統 MUST 為「我的清單」每個新加入的台股商品保存由 Worker 以 `Asia/Taipei` 判定的 `addedAt` 與 stable `itemId`；相同商品刪除後重新加入 MUST 建立新的加入日期及 item ID。既有無法證明加入日期的項目 MUST 保留 `null` 與 `legacy_unknown`，不得以 migration 日期、最後修改日或檔案時間冒充歷史加入日。

#### Scenario: 新增台股商品
- **WHEN** 已識別使用者將台股商品加入「我的清單」
- **THEN** Worker MUST 以伺服器接收時間所對應的台北日期保存 `addedAt`
- **AND** UI MUST 在商品旁顯示加入日期

#### Scenario: 升級既有清單
- **WHEN** migration 遇到沒有可信加入日期的既有商品
- **THEN** 系統 MUST 將狀態保存為 `legacy_unknown` 並在 UI 顯示「日期未知」
- **AND** MUST NOT 以 migration 日期、最後修改日或其他推測值補入

#### Scenario: 刪除後重新加入
- **WHEN** 使用者刪除某商品後再次加入
- **THEN** 系統 MUST 建立新的 `itemId` 與新的伺服器加入日期
- **AND** MUST NOT 恢復前一筆已刪除紀錄的加入日期

### Requirement: 清單商品推薦人

系統 MUST 為台股清單商品提供可選且可編輯的 `recommender`，並在 D1 以使用者及 item ID 隔離保存。Worker MUST 正規化前後空白、限制長度、拒絕不允許的控制字元；前端輸出 MUST escaping，不得將內容解讀為 HTML。

#### Scenario: 新增或修改推薦人
- **WHEN** 已識別使用者新增商品時填寫推薦人，或之後修改推薦人
- **THEN** Worker MUST 驗證並保存正規化後的文字
- **AND** reload 或同一使用者從另一裝置登入後 MUST 顯示相同內容

#### Scenario: 拒絕不合法輸入
- **WHEN** 推薦人超過允許長度或包含不允許的控制字元
- **THEN** Worker MUST 拒絕更新並保留原值
- **AND** UI MUST 顯示可理解的欄位錯誤，不得把原始內容插入 HTML

### Requirement: 清單 metadata 使用者隔離

清單加入日期、日期狀態與推薦人 API MUST 以伺服器端使用者識別查找 item，且 MUST NOT 信任前端單獨傳入的 user ID。其他使用者不得讀取、推測或修改這些 metadata。

#### Scenario: 拒絕讀取他人項目
- **WHEN** 使用者請求不屬於自己的 watchlist item ID
- **THEN** Worker MUST 回傳授權錯誤
- **AND** response MUST NOT 洩露商品、加入日期或推薦人

### Requirement: 不提供投資報酬追蹤

清單 metadata 功能 MUST NOT 計算或顯示投資報酬、報酬率、可能最大／最小報酬、理論上下限或 1／2／3／4／5／20 日價格表現。系統 MUST NOT 因商品加入日期建立相關按鈕、API、D1 欄位、快取、背景排程或價格資料請求。

#### Scenario: 顯示含加入日期的商品
- **WHEN** 使用者查看已保存加入日期與推薦人的清單商品
- **THEN** UI MUST 只顯示 metadata 編輯與既有清單操作
- **AND** MUST NOT 顯示「績效追蹤」或任何投資報酬計算入口

#### Scenario: 保存 metadata
- **WHEN** 使用者新增商品或修改推薦人
- **THEN** Worker MUST 只處理清單 metadata
- **AND** MUST NOT 觸發 candles、公司行動、交易日窗口或績效快取流程
