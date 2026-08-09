## ADDED Requirements

### Requirement: 指標 readout 必須顯示逐項標籤與指定順序
主圖左上角與 K 棒價量共用的 indicator readout MUST 對 BOLL、均量與均線顯示每個數值的語意 prefix。BOLL MUST 依「上、中軌、下」順序顯示；均量與均線 MUST 依週期由小到大顯示，並以 `5MA`、`10MA` 等週期文字置於數值前。每組 prefix 與數值 MUST 使用該 output 的既有 series 顏色。此顯示規則 MUST NOT 改變 indicator 計算結果、output key、繪圖 series 建立順序、picker 完整名稱或持久化資料。

#### Scenario: 顯示 BOLL readout
- **WHEN** 使用者啟用 BOLL(20,2)，目前 candle 的 upper、mid、lower 數值分別為 952.9、937.5、922.2
- **THEN** readout MUST 依序顯示 `上 952.9`、`中軌 937.5`、`下 922.2`
- **AND** `上`、`中軌`、`下` MUST 分別和對應數值使用相同的 upper、mid、lower series 顏色
- **AND** row label MUST 保留目前參數化名稱 `BOLL(20,2)`

#### Scenario: 顯示均量與均線 readout
- **WHEN** 使用者同時啟用成交量均線與參考均線組
- **THEN** 成交量均線的 readout 名稱 MUST 顯示為「均量」，並以 `5MA`、`10MA`、`20MA` 等 prefix 顯示數值
- **AND** 參考均線組的 readout 名稱 MUST 顯示為「均線」，並以 `5MA`、`10MA`、`20MA`、`60MA`、`120MA` 等 prefix 顯示數值
- **AND** indicator picker MUST 仍顯示既有完整名稱，既有 instance type 與偏好資料 MUST 不變

#### Scenario: 指標數值缺值
- **WHEN** 某一指標週期尚未形成或沒有有限數值
- **THEN** 該週期 MUST 保留其標籤並顯示 `—`
- **AND** 其他週期的順序與標籤 MUST NOT 位移或遺失

#### Scenario: 窄版換行與可存取名稱
- **WHEN** 圖表寬度不足以在單行容納完整均線或均量 readout
- **THEN** UI MUST 只在 output 單位之間換行，單一 `prefix + value` MUST NOT 被拆開、裁切或覆蓋價格軸
- **AND** 每個可見 output 的 tooltip 或 accessible name MUST 同時包含 prefix 與目前值
- **AND** crosshair 高頻更新 MUST NOT 新增 assertive live region
