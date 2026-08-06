## ADDED Requirements

### Requirement: 多圖重建必須隔離已銷毀圖表的非同步工作

系統 MUST 讓每次多圖 panel 重建擁有不可與舊畫面混用的生命週期識別，並在 panel 銷毀時取消或隔離所有可能操作 Lightweight Charts、series、controller、observer、listener、timer、animation frame 與 DOM 的延遲工作。已銷毀 generation 的 callback MUST NOT 呼叫已移除的圖表實例、改寫新 generation 狀態或造成未捕捉的 browser Console error。

#### Scenario: 快速連續切換圖表數量

- **WHEN** 使用者在前一批 panel 尚在載入或 layout 時，連續切換 1、2、3、4、6 或 8 圖
- **THEN** 每一批被取代的 panel MUST 先失效並停止後續圖表操作
- **AND** 最後一次選擇 MUST 顯示正確 panel 數量與 canonical 商品切片
- **AND** 6／8 圖 MUST 維持固定單一副圖模式
- **AND** browser Console MUST NOT 出現 `Value is null` 或其他已銷毀圖表生命週期錯誤

#### Scenario: 快速切換分類分頁

- **WHEN** 使用者在圖表仍載入時連續按下一頁或上一頁
- **THEN** 最後顯示的每個 panel MUST 對應最終頁碼的完整 canonical 商品切片
- **AND** 舊頁面的資料、layout、crosshair、overlay 或 resize callback MUST NOT 操作新頁面或已移除的 chart
- **AND** browser Console MUST 保持沒有未捕捉的圖表生命週期錯誤

#### Scenario: 快速切換市場或個人清單頁籤

- **WHEN** 使用者在前一頁籤 panel 尚未完成載入時切換至另一個市場或個人清單頁籤
- **THEN** 舊頁籤的 fetch、stream、timer、frame、observer 與 controller callback MUST 被取消或因 generation 不符而失效
- **AND** 最後頁籤 MUST 完整載入其商品與有效主副圖模式
- **AND** 舊頁籤 callback MUST NOT 覆蓋最終頁籤畫面或產生未捕捉錯誤

#### Scenario: panel teardown 可重複呼叫

- **WHEN** 同一個 panel 因重建、頁面卸載或上層清理而被重複要求銷毀
- **THEN** teardown MUST 具備冪等性
- **AND** Lightweight Charts 實例 MUST 最多移除一次
- **AND** 所有後續 callback MUST 將該 panel 視為已失效

#### Scenario: ATR 副圖建立自訂 price scale

- **WHEN** panel 啟用 ATR 技術副圖並建立 Lightweight Charts series
- **THEN** 系統 MUST 先建立使用 `atr` price scale 的 ATR series
- **AND** 系統 MUST 只在該 series 建立後設定 `atr` price scale 選項
- **AND** browser Console MUST NOT 出現 `Trying to apply price scale options with incorrect ID: atr`、`Value is null` 或其他自訂 price scale 初始化錯誤

#### Scenario: in-flight batch 期間以相同 panel ID 重建

- **WHEN** 頁面級 batch request 尚未回應，原 panel 被銷毀且新 panel 以相同 ID 訂閱不同商品、週期或參數
- **THEN** 舊 request 的 response item MUST 只在目前 subscription token 仍等於 request snapshot token 時投遞
- **AND** token 已變更的 response item MUST 被忽略
- **AND** coordinator MUST 為最新 subscriptions 補跑 request，不得把舊 payload 套用到新 panel
