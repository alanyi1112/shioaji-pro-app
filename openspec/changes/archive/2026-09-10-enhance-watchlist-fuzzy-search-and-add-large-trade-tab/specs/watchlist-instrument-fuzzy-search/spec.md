## ADDED Requirements

### Requirement: 台股可用代號或股名模糊搜尋
系統 SHALL 讓使用者在自選清單以台灣股票代號或股名搜尋候選，並對查詢與候選文字執行 Unicode NFKC、大小寫折疊、前後空白移除及常見空白／分隔符號正規化。系統 SHALL 支援名稱完全相等、前綴、包含及最低信心以上的近似比對。

#### Scenario: 以完整股名搜尋
- **WHEN** 使用者輸入目錄中存在的完整台股股名
- **THEN** 系統顯示對應商品，且候選同時包含代號、股名、交易所與商品類型

#### Scenario: 以部分或近似股名搜尋
- **WHEN** 使用者輸入台股股名的一部分或通過最低相似度的近似文字
- **THEN** 系統依決定性分數排序顯示相符候選，而非要求使用者先知道股票代號

#### Scenario: 正規化全半形與分隔符號
- **WHEN** 使用者輸入包含全半形差異、大小寫、空白或常見分隔符號的查詢
- **THEN** 系統以正規化後的文字比對，且同一商品不因字形格式差異重複出現

### Requirement: 搜尋候選排序與合併具決定性
系統 SHALL 依代號完全相等、代號前綴、名稱完全相等、名稱前綴、名稱包含，以及名稱 bigram Dice／edit similarity 取高的相似度依序評分，並以 `securityType + exchange + code` 作為候選唯一鍵。相同輸入與相同資料集合 MUST 產生相同順序。

#### Scenario: 精確代號優先
- **WHEN** 一個候選的代號與查詢完全相等，另有候選僅名稱近似
- **THEN** 精確代號候選排列在名稱近似候選之前

#### Scenario: 跨來源候選去重
- **WHEN** MultiView 目錄與既有本機商品搜尋回傳同一 `securityType + exchange + code`
- **THEN** 系統只顯示一個合併候選，並優先保留正式股名及較完整欄位

#### Scenario: 同分穩定排序
- **WHEN** 多個候選取得相同搜尋分數
- **THEN** 系統以交易所、代號及名稱作穩定排序，不因非同步回應順序改變

### Requirement: 非同步搜尋不得顯示過期結果
系統 SHALL 對台股名稱搜尋設定有界 timeout、取消機制及查詢識別；較舊查詢的延遲回應 MUST NOT 覆寫較新查詢的候選或狀態。

#### Scenario: 舊查詢晚於新查詢完成
- **WHEN** 使用者連續改變輸入，且第一個請求晚於第二個請求回傳
- **THEN** 系統只呈現第二個查詢的候選與狀態

#### Scenario: 使用者清除輸入
- **WHEN** 搜尋請求尚未完成而使用者清除輸入
- **THEN** 系統取消或忽略該請求，並清除候選及目前選取

### Requirement: 搜尋來源失敗時安全降級
系統 SHALL 優先使用 MultiView 台灣商品目錄補足股名候選，並在該來源 timeout、離線或 schema 無效時降級為既有本機商品搜尋。降級狀態 MUST 與真正無結果分開呈現，且純代號仍 SHALL 可走既有 contract 查詢流程。

#### Scenario: MultiView 搜尋服務離線
- **WHEN** `/api/instrument-search` 無法在 timeout 內提供有效回應
- **THEN** 系統繼續顯示本機可用候選，並呈現搜尋來源降級狀態而非錯誤宣稱沒有商品

#### Scenario: 降級後以精確代號加入
- **WHEN** MultiView 搜尋服務離線且使用者輸入有效台股代號
- **THEN** 系統仍可透過既有 Shioaji contract API 驗證並加入商品

#### Scenario: 所有候選來源皆無結果
- **WHEN** 所有可用搜尋來源完成且均無符合最低信心的候選
- **THEN** 系統顯示無結果狀態，且不建立未驗證商品

### Requirement: 使用者必須明確選取模糊候選
系統 SHALL 支援滑鼠與 `ArrowUp`、`ArrowDown`、`Enter`、`Escape` 鍵盤操作候選。`Enter` MUST 只提交目前明確選取的候選、唯一精確候選或有效純代號；多個模糊候選存在時 MUST NOT 把原始股名當成商品代號提交。

#### Scenario: 鍵盤選取候選
- **WHEN** 使用者以方向鍵移到候選並按下 Enter
- **THEN** 系統提交該候選的 canonical 商品識別，而非輸入框的顯示文字

#### Scenario: 未選取的模糊名稱
- **WHEN** 多個模糊候選存在且使用者未明確選取任何一個便按下 Enter
- **THEN** 系統保持候選清單並要求選取，不自動加入可能錯誤的商品

#### Scenario: 關閉候選
- **WHEN** 使用者按下 Escape
- **THEN** 系統關閉候選清單並清除目前選取，但保留輸入文字供後續修改

### Requirement: 加入自選清單前驗證 canonical contract
系統 MUST 將搜尋候選視為顯示與選取資料，並在建立自選清單項目前透過既有 Shioaji contract API 驗證 canonical 商品。驗證失敗、商品類型不符或回應過期時 SHALL NOT 建立自選清單項目。

#### Scenario: 候選通過 contract 驗證
- **WHEN** 使用者選取候選且 Shioaji contract API 回傳一致的 canonical 商品
- **THEN** 系統以 canonical code、name、exchange 與 security type 建立自選清單項目

#### Scenario: 目錄候選已過期
- **WHEN** 搜尋候選存在但 contract API 無法驗證該商品
- **THEN** 系統顯示驗證失敗並保持清單不變

### Requirement: 不改變非台股商品與行情訂閱行為
系統 SHALL 保留非台股商品既有搜尋及加入流程；搜尋與候選顯示 MUST NOT 新增行情 subscription、broker write、下單或交易狀態變更。

#### Scenario: 搜尋非股票商品
- **WHEN** 使用者選擇既有支援的非台股股票商品類型
- **THEN** 系統沿用原本商品搜尋及 contract 驗證流程

#### Scenario: 僅瀏覽搜尋候選
- **WHEN** 使用者輸入與瀏覽候選但未加入商品
- **THEN** 系統不建立行情 subscription 且不呼叫任何交易寫入 API
