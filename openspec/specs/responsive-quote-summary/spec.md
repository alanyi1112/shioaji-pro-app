# responsive-quote-summary Specification

## Purpose
TBD - created by archiving change compact-kline-quote-summary-reference-colors. Update Purpose after archive.
## Requirements
### Requirement: 非指數行情摘要在寬版必須呈現三列
當 K 線圖容器寬度足以完整容納內容時，系統 MUST 將非指數商品的行情摘要呈現為四欄三列，並把每個欄位標題與數值保留在同一個不可拆開的資訊單位。

#### Scenario: 股票行情摘要使用三列排列
- **WHEN** 非指數 K 線圖容器位於寬版 breakpoint，且行情資料可用
- **THEN** 第一列 MUST 依序顯示「開、高、低、量」及各自數值
- **AND** 第二列 MUST 依序顯示「參考、漲停、跌停、時間」及各自數值
- **AND** 第三列 MUST 依序顯示「委買、買量、委賣、賣量」及各自數值
- **AND** 每一個標題 MUST 與自己的數值顯示在同一列

#### Scenario: 欄位資料缺少
- **WHEN** 任一行情欄位沒有有效資料
- **THEN** 系統 MUST 在原欄位位置顯示 `—`
- **AND** 缺值 MUST NOT 造成其後欄位位移到錯誤標題下

### Requirement: 商品資訊區與摘要必須依容器寬度響應排列
系統 MUST 依個別 K 線圖容器的 inline size 調整商品資訊區與行情摘要，不得只依整個瀏覽器 viewport 判斷。寬度不足時 MUST 優先保留完整內容，可增加列數或把摘要移到商品資訊區下方。

#### Scenario: 中等寬度圖表
- **WHEN** 圖表不足以讓商品資訊區與四欄摘要安全地左右並排，但仍可容納四欄摘要
- **THEN** 系統 MUST 將商品資訊區與摘要改為上下排列
- **AND** 摘要 MUST 保持四欄三列

#### Scenario: 極窄圖表或大字體
- **WHEN** 個別圖表寬度或目前字體倍率不足以完整容納四欄摘要
- **THEN** 系統 MUST 將摘要降為較少欄數並增加列數
- **AND** 所有標題、價格、數量與時間 MUST 完整可讀，不得被裁切或以省略號隱藏
- **AND** 標題與對應數值 MUST NOT 被拆到不同列

#### Scenario: 同一工作區具有不同寬度圖表
- **WHEN** 同一 viewport 同時存在兩張以上不同寬度的 K 線圖
- **THEN** 每張 QuoteBoard MUST 依自己的容器寬度選擇排版
- **AND** 一張圖的 breakpoint MUST NOT 強迫其他圖採用相同排列

### Requirement: 商品資訊區必須保留主要行情資訊
商品資訊區 MUST 完整顯示商品代碼、名稱、最新價、漲跌、漲跌幅與既有漲跌停狀態，並以有界的響應式尺寸配置和摘要共享空間。

#### Scenario: 字體倍率放大
- **WHEN** 使用者把介面字體倍率設定為 1.15 或 1.3
- **THEN** 商品代碼、名稱、最新價、漲跌及漲跌幅 MUST 保持可讀
- **AND** 商品資訊區與摘要 MUST NOT 相互覆蓋

#### Scenario: 標準看盤使用特大字級
- **WHEN** 標準看盤工作區約為 1499×821 CSS px、K 線面板約為 926px 寬，且字體倍率為 1.3
- **THEN** 商品代碼、名稱、最新價、漲跌與漲跌幅 MUST 完整顯示且不得互相遮蓋
- **AND** 四欄三列摘要的量、時間與賣量最右欄 MUST 完整留在面板內
- **AND** 系統 SHOULD 優先回收商品資訊區與摘要之間的閒置軌道及間距，不得以縮小文字、折行或省略數字解決

#### Scenario: 主視窗與獨立視窗
- **WHEN** 同一 K 線圖分別顯示於工作區主視窗或 popout
- **THEN** 系統 MUST 套用相同的容器響應與完整顯示規則

### Requirement: 摘要數字必須穩定對齊
行情摘要的價格、數量與時間 MUST 使用 tabular numbers；每個 metric MUST 保持 label/value 的可辨識間距，且不同即時數值長度不應造成整個摘要明顯跳動。

#### Scenario: 即時行情數字長度改變
- **WHEN** 最新行情使價格位數、成交量或買賣量增加
- **THEN** 對應 metric MUST 保持標題與數值關係清楚
- **AND** 其他列 MUST NOT 因單一數值更新而重疊或被裁切
