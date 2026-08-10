## ADDED Requirements

### Requirement: 台股報價與漲跌價差必須依商品升降單位格式化
系統 MUST 對 TSE／OTC 的 STK 報價使用商品升降單位所需的小數位，不得固定顯示多餘的小數。普通股票 MUST 依 `<10: 0.01`、`10–<50: 0.05`、`50–<100: 0.1`、`100–<500: 0.5`、`500–<1000: 1`、`≥1000: 5`；ETF MUST 依 `<50: 0.01`、`≥50: 0.05`。ETF MUST 優先以 canonical contract category 辨識，只有 category 缺失時才可使用代號 fallback。百分比、非台股及非 STK MUST 保持既有格式。

#### Scenario: 普通股票跨價位級距
- **WHEN** canonical contract 為普通股票且報價分別位於 49.95、50、100、500 與 1000
- **THEN** UI MUST 分別顯示 `49.95`、`50.0`、`100.0`、`500` 與 `1,000`
- **AND** 不得一律補成兩位小數或只依數值大小套用通用格式

#### Scenario: ETF 使用不同級距
- **WHEN** canonical contract category 表示 ETF，且報價為 52.30
- **THEN** UI MUST 顯示 `52.30`
- **AND** 系統 MUST NOT 套用普通股票 `50–<100` 的一位小數規則

#### Scenario: 上櫃或英文字尾 ETF
- **WHEN** canonical category 表示 ETF，商品為上櫃 ETF 或代號含英文字尾
- **THEN** UI MUST 依 ETF 升降單位顯示
- **AND** 系統 MUST NOT 只因交易所或代號不是純數字而退回普通股票規則

#### Scenario: 漲跌價差使用昨收級距
- **WHEN** 普通股票昨收位於 100–<500 級距且即時漲跌為正 24.5
- **THEN** 漲跌價差 MUST 顯示 `+24.5`
- **AND** 漲跌百分比 MUST 保持既有兩位小數格式

#### Scenario: 主要報價面板一致
- **WHEN** 同一台股商品同時出現在自選清單、排行榜、主報價摘要、五檔、逐筆成交或 tray
- **THEN** 所有絕對報價與漲跌價差 MUST 使用同一 contract-aware formatter
- **AND** 漲跌停紅底／綠底規則與面板點選連動 MUST 保持不變

#### Scenario: metadata 不足或非台股商品
- **WHEN** category 缺失、商品不是 TSE／OTC STK，或數值不是有限數
- **THEN** category 缺失的台股 STK MAY 使用安全的代號 fallback，其他商品 MUST 沿用既有 formatter
- **AND** 系統 MUST NOT 猜測 ETF 身分、改變下單 tick validation 或顯示非有限數
