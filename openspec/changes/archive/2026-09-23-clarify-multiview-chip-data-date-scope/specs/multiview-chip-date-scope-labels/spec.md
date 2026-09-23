## ADDED Requirements

### Requirement: 群組顯示可驗證的資料截止日與頻率

系統 SHALL 在 MultiView 模式 B 的籌碼副圖群組標題中，依目前可見副圖實際使用的資料集，顯示 API `coverage[]` 提供的資料截止日與日／週頻率。

#### Scenario: 持股比群組顯示 TDCC 週資料日期

- **WHEN** 大戶持股、散戶持股或集保戶數副圖可見，且 `shareholder-distribution` coverage 的 `end` 為 `2026-09-18`
- **THEN** 持股比群組標題 SHALL 顯示 `TDCC（週）至 2026-09-18`

#### Scenario: 法人群組分別顯示不同截止日

- **WHEN** 可見法人副圖同時使用 `institutional-flow` 與 `foreign-holding`，且兩者 coverage 截止日不同
- **THEN** 法人群組標題 SHALL 分別顯示買賣超與外資持股的實際日期，不得合併為單一日期

#### Scenario: 融資券群組分別顯示不同資料集

- **WHEN** 可見融資券副圖同時使用 `margin-short` 與 `securities-lending`
- **THEN** 融資券群組標題 SHALL 分別顯示融資融券與借券的實際截止日及頻率

### Requirement: 日期範圍只涵蓋目前可見副圖

系統 MUST 從目前可見副圖的 `dataset` 或 `datasets` 定義推導群組日期標示，按照穩定順序去除重複資料集，且不得加入未被可見副圖使用的資料集。

#### Scenario: 單一法人副圖只需要買賣超資料

- **WHEN** 法人群組只顯示一個僅依賴 `institutional-flow` 的副圖
- **THEN** 群組標題 SHALL 只顯示買賣超日期，不顯示外資持股日期

#### Scenario: 組合副圖使用兩個資料集

- **WHEN** `foreign-flow-holding` 副圖可見
- **THEN** 法人群組標題 SHALL 同時顯示 `institutional-flow` 與 `foreign-holding` 的日期

### Requirement: 不得推測缺少的資料日期

系統 MUST 只使用對應資料集 coverage 的實際 `end` 作為截止日；不得使用 K 線日期、請求結束日、其他資料集日期或警示文字替代。

#### Scenario: coverage 缺少截止日

- **WHEN** 可見副圖依賴的資料集沒有可用的 `coverage.end`
- **THEN** 該資料集標示 SHALL 顯示 `尚無可驗證日期`，不得顯示推測日期

#### Scenario: payload 不可用

- **WHEN** 籌碼 payload 被清除或目前商品不支援籌碼資料
- **THEN** 所有可見群組的日期標示 SHALL 清除或顯示無法驗證，不得保留前一商品的日期

### Requirement: 資料截止日與游標日期保持獨立

系統 SHALL 將群組資料截止日視為 payload metadata，而非十字線 readout；游標移動不得改變群組日期標示，且群組日期標示 SHALL 隨群組 DOM 一起出現在 PNG 匯出結果中。

#### Scenario: 移動十字線

- **WHEN** 使用者把十字線移到較早的 K 線日期
- **THEN** 副圖 readout 可以顯示游標日期，但群組資料截止日 SHALL 維持 coverage 的實際截止日

#### Scenario: 匯出圖表

- **WHEN** 使用者在模式 B 匯出包含籌碼副圖的 PNG
- **THEN** 可見群組標題中的資料截止日 SHALL 包含於匯出畫面

### Requirement: 保留逐資料集警示

系統 SHALL 保留既有逐資料集警示，並將群組日期標示作為補充資訊；不得以單一全域「籌碼資料日期」取代各資料集狀態。

#### Scenario: 部分日資料落後

- **WHEN** 外資持股或融資融券資料落後於其他資料集
- **THEN** UI SHALL 同時顯示對應資料集警示與各群組的實際截止日
