## ADDED Requirements

### Requirement: 產品每日監控名單必須在已核准容量內動態封存

正式產品運作 MUST 將已核准同時監控容量與歷史 Stage 驗收的商品身分分開。系統 MUST 自已儲存、已去重且合法的最多 200 檔候選中，按啟用狀態、合約 eligibility 與穩定優先順序，為每個適用交易日選出不超過 160 檔並保存不可變的 daily cohort plan；160 檔只代表容量上限，不代表固定商品清單。plan MUST 包含目標交易日、設定 revision/hash、選入與候補商品及原因、容量核准版本和 plan hash。當日 session MUST NOT 因某檔缺資料而輪替或補位，亦不得增加第二個 login／訂閱或推定 provider physical headroom 已釋放。

#### Scenario: 商品集合相同但順序改變

- **WHEN** 合法名單未超過容量上限，且使用者只變更商品順序
- **THEN** 系統 MUST 維持相同入選商品集合，不得因索引位移將商品判為身分不符或錯配 baseline

#### Scenario: 候選超過容量上限

- **WHEN** 已啟用且 eligible 的候選有 200 檔
- **THEN** 系統 MUST 依儲存優先順序只規劃前 160 檔，剩餘 40 檔 MUST 顯示容量候補
- **AND** session 中途即使有商品退化也 MUST NOT 自動補位

### Requirement: 每日商品基準必須以身分鍵值驗證並隔離缺口

每個入選商品 MUST 以 `targetTradeDate + previousApplicableTradeDate + canonicalSymbol` 對應逐商品 baseline，並驗商品合約／市場、官方交易日、分鐘 coverage、單位、收盤對帳、來源版本、hash 與 provenance；MUST NOT 依清單陣列位置對應或借用其他商品基準。逐商品驗證失敗 MUST 僅使該商品不可比較與不可通知；其他合法商品 MAY 維持其已證實的資料能力，但系統 MUST 分別報告 plan 數、baseline-ready 數、data-active 數與完整 160 檔就緒判定。

#### Scenario: 只缺一檔上一交易日基準

- **WHEN** 160 檔 daily plan 中 159 檔基準通過，而一檔缺完整基準
- **THEN** 缺失商品 MUST 顯示 `waiting_baseline`、不得比較或通知，其餘 159 檔 MAY 維持合法監控
- **AND** 系統 MUST 顯示 baseline-ready 為 159，MUST NOT 宣稱完整 160 檔就緒

#### Scenario: 商品順序與 baseline manifest 順序不同

- **WHEN** 每檔商品及日期均有合法基準，但 baseline manifest 的排列順序與當日 plan 不同
- **THEN** resolver MUST 依商品與日期鍵值配對，不得因排列不同而拒絕或錯用其他商品的累積量

### Requirement: 設定修訂必須可稽核且不得回填未知操作者

每筆設定 mutation MUST 在原子 revision 驗證後保存不可覆寫的去敏稽核紀錄，至少包含提交時間、可信來源類型、前後 revision/hash、商品增刪／啟停／排序差異、結果與 correlation id。既有資料未留下操作者證據時 MUST 標示 `unknown`，MUST NOT 推定是使用者或排程所為。稽核紀錄不得含帳密、token、API key 或其他機密。

#### Scenario: 舊 revision 沒有操作者資料

- **WHEN** 系統查詢導入稽核前的既有設定修訂
- **THEN** MUST 保留可證實的 revision 與清單差異，操作者來源 MUST 顯示為未知，不得補造自然人身分

#### Scenario: 衝突的設定寫入

- **WHEN** 一個分頁使用過期 revision 提交修改
- **THEN** 系統 MUST 原子拒絕寫入、保留既有設定並記錄去敏衝突結果
