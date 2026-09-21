# stock-screener-watchlist-integration Specification

## Purpose
TBD - created by archiving change open-after-market-stock-screener-in-new-tab-and-add-results-to-watchlist. Update Purpose after archive.
## Requirements
### Requirement: 每筆選股結果必須提供獨立的加入清單動作

選股結果卡片右上方 MUST 提供可辨識為「加入清單」的獨立按鈕。按鈕在可操作狀態被 pointer hover 時 MUST 以清楚的前景色、邊框與背景 highlight 回饋，且不得只依賴游標變化。按鈕與結果內容的 mouse、touch 及 keyboard action MUST 互斥：只有明確啟用按鈕才可要求修改自選清單；點選或以鍵盤啟用結果內容 MUST 只沿用 K 線連動，MUST NOT 隱性加入商品。

#### Scenario: 從結果右上方加入商品

- **WHEN** 使用者在一筆合法選股結果按下「加入清單」
- **THEN** 系統 MUST 只送出該商品的指定清單 mutation，不得同時送出 chart pick 或改動交易商品與草稿

#### Scenario: 點選結果內容不加入清單

- **WHEN** 使用者點選或以鍵盤啟用結果內容而未啟用「加入清單」
- **THEN** 系統 MUST NOT 建立清單、加入商品或顯示商品已加入

#### Scenario: 鍵盤走訪結果卡片

- **WHEN** 使用者以鍵盤走訪結果卡片
- **THEN** 結果內容與「加入清單」MUST 各自取得可見焦點及可辨識名稱，啟用任一 action MUST NOT 穿透到另一 action

#### Scenario: Hover 加入清單按鈕

- **WHEN** pointer hover 在可操作的「加入清單」按鈕
- **THEN** 按鈕 MUST 顯示可辨識的 highlight，移開後 MUST 恢復原樣，且不得觸發 chart pick 或 watchlist mutation

### Requirement: 商品必須冪等加入名稱精確為「選股」的自選清單

系統 MUST 將結果的代碼、市場與商品種類解析並驗證為合法台股 STK 合約，再尋找正規化後名稱精確為「選股」的個人自選清單。清單不存在時 MUST 自動建立；商品已存在時 MUST 回覆可辨識的 `already_present` 成功終態而不建立重複合約。此流程 MUST NOT 切換目前作用中的清單、改寫其 storage identity 或把商品加入其他同名以外的清單。

#### Scenario: 第一次加入且選股清單不存在

- **WHEN** 後端沒有名稱精確為「選股」的個人清單，且使用者加入合法商品
- **THEN** 系統 MUST 建立「選股」清單並使該商品持久存在於該清單一次
- **AND** 使用者目前作用中的其他清單 MUST 保持作用中且內容不變

#### Scenario: 加入尚未存在的第二檔商品

- **WHEN** 「選股」清單已存在但不含目前商品
- **THEN** 系統 MUST 以該清單的後端 id 加入 canonical 合約，且不得建立第二個「選股」清單

#### Scenario: 重複加入相同商品

- **WHEN** 「選股」清單已含相同 canonical 合約，或使用者在 pending 期間重複啟用按鈕
- **THEN** 系統 MUST 保持單一商品項目並顯示「已加入」或等價成功狀態，不得重複寫入

#### Scenario: 兩個分頁同時建立選股清單

- **WHEN** 兩個同源分頁在尚未看見「選股」清單時同時要求加入商品
- **THEN** 系統 MUST 以後端結果重抓並收斂到唯一合法的「選股」清單；若無法判定唯一目標 MUST fail closed 並提示錯誤

#### Scenario: 結果無法解析為合法合約

- **WHEN** 結果缺少市場、種類不符或代碼解析成與結果不一致的合約
- **THEN** 系統 MUST 阻止寫入並顯示可重試或可診斷原因，MUST NOT 以代碼字串猜測其他合約

### Requirement: 加入狀態必須以後端確認為準並跨分頁收斂

加入清單按鈕 MUST 區分可操作、加入中、已加入／原已存在與失敗狀態。只有後端 create／add 成功，或重抓後確認 canonical 合約已存在，才可顯示成功。成功後系統 MUST 發出不含機密資料的同源清單失效通知，使其他主頁重抓最新清單；通知 MUST NOT 改變其他頁目前作用中的清單。

#### Scenario: 後端完成持久化

- **WHEN** 後端確認商品已加入「選股」清單
- **THEN** 按鈕 MUST 顯示已加入，重新載入選股頁及開啟「選股」自選清單後仍 MUST 看見該商品一次

#### Scenario: 自選清單 API 失敗

- **WHEN** create、add 或確認重抓失敗，且後端未能證明商品已存在
- **THEN** 按鈕 MUST 離開 pending 並顯示失敗與可重試狀態，MUST NOT 只更新本機陣列或宣稱已加入

#### Scenario: 其他頁目前使用不同清單

- **WHEN** 選股分頁成功加入商品，而主交易頁目前作用中的清單不是「選股」
- **THEN** 主交易頁 MUST 可刷新清單 metadata，但 MUST 保持原清單作用中、原選取商品及圖表／交易狀態不變

### Requirement: 加入清單不得產生交易或 runtime 副作用

加入清單流程 MUST 僅呼叫合約解析及自選清單讀寫能力，MUST NOT 發出委託、智慧下單、帳務寫入、行情訂閱、選股資料回補、provider 抓取、DDL 或 runtime 啟停請求。

#### Scenario: 加入一檔選股商品

- **WHEN** 使用者成功或失敗地嘗試將結果加入「選股」清單
- **THEN** 交易草稿、下單商品、simulation runtime、5173／5174 服務、選股 snapshot 與既有行情連線 MUST 保持不變
