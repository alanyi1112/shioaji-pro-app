## MODIFIED Requirements

### Requirement: 大戶與散戶獨立副圖

系統 MUST 將大戶持股與散戶持股提供為兩個可獨立選取的週頻複合 pane；每個 pane MUST 同時以比例線顯示持股比例，並以正負柱顯示相較前一筆實際發布週資料的百分點變化。pane 的預設標題列 MUST 只顯示精簡名稱、實際資料日期、持股比例、週變化、持股增減張數與級距選單，且級距選單 MUST 靠可用列最右側；級距精確範圍、持股總張數、持股人數、來源、資料頻率與投資人身分提醒 MUST 從預設標題列移除，並由右鍵「詳細資料」以表格提供。方式 B 同時勾選時 MUST 上下排列且共用相同 TDCC response；方式 A MUST 只顯示目前選取的一個 pane。TDCC 值 MUST 只屬於其實際 `dataDate`，其他交易日不得 forward-fill、插值或視為 0。

#### Scenario: 顯示預設大戶持股
- **WHEN** 大戶持股 pane 建立且有至少一筆 TDCC 分級 15 資料
- **THEN** pane MUST 以百分比線圖顯示分級 15 的持股比例
- **AND** 預設標題列 MUST 依序顯示「大戶持股」、實際資料日期、持股比例「持股」、週變化與張數變化「持股」，並將「1,000 張以上」級距選單靠最右側
- **AND** 預設標題列 MUST NOT 顯示官方精確級距、張數、人數、來源、資料頻率或投資人身分提醒

#### Scenario: 顯示預設散戶持股
- **WHEN** 散戶持股 pane 建立且具有 TDCC 分級 1 至 3 資料
- **THEN** pane MUST 以百分比線圖顯示三個分級加總比例
- **AND** 預設標題列 MUST 依序顯示「散戶持股」、實際資料日期、持股比例「持股」、週變化與張數變化「持股」，並將「10 張以下」級距選單靠最右側
- **AND** 精簡方式與可查看的詳細欄位 MUST 與大戶持股一致

#### Scenario: 顯示週變化柱
- **WHEN** 某週加總持股比例高於、低於或等於前一筆實際發布週資料
- **THEN** pane MUST 以本週比例減前週比例的百分點顯示柱值
- **AND** 增加柱使用台股紅色、減少柱使用綠色、零值使用中性色，標題列逐日讀值 MUST 同時顯示正負方向

#### Scenario: 顯示持股增減張數
- **WHEN** 某週具有前一筆實際發布週資料
- **THEN** 標題列 MUST 以本週聚合持股張數減前週聚合持股張數顯示「持股」與帶正負號的張數，不另寫「增減」文字
- **AND** 增加 MUST 顯示正號與台股紅色，減少 MUST 顯示負號與綠色，零值 MUST 使用中性色
- **AND** 右鍵詳細資料表 MUST 顯示相同的持股增減張數

#### Scenario: 只有一筆 TDCC 快照
- **WHEN** 查詢範圍只有一筆合法股權分散資料
- **THEN** pane MUST 顯示該筆比例資料點，且該 `dataDate` 的標題列週變化與持股增減逐日讀值 MUST 顯示「首筆／無前週比較」
- **AND** MUST NOT 畫出週變化柱、假的水平趨勢或每日補值

#### Scenario: 同一週某個分級缺漏
- **WHEN** 大戶或散戶計算所需的任一持股分級為缺漏或驗證失敗
- **THEN** 該 pane MUST 將該週標示為部分或無資料
- **AND** MUST NOT 將缺少分級視為零後繼續加總

#### Scenario: 游標停在 TDCC 未發布日
- **WHEN** 游標 `sessionDate` 不是任何一筆 TDCC 的實際 `dataDate`
- **THEN** 大戶／散戶標題列逐日讀值 MUST 明示「當日無資料」
- **AND** MUST NOT 把前一週比例或週增減顯示成游標當日資料
- **AND** 詳細資料表若另列最近一筆資料作為參考，MUST 明確標示其實際 `dataDate` 並與當日缺值狀態區分

### Requirement: 大戶散戶級距控制

系統 MUST 讓使用者從 TDCC 官方持股級距可精確組成的選項調整大戶下界與散戶上界；級距選單 MUST 使用精簡市場慣稱並在 holder 標題列靠右，實際股數範圍 MUST 由右鍵「詳細資料」表格清楚說明。

#### Scenario: 調整為支援的官方級距
- **WHEN** 使用者從選單選擇另一個支援的持股級距門檻
- **THEN** 前端 MUST 使用已載入的 levels 重新加總比例、股數及人數
- **AND** 精簡標題與已開啟的詳細資料表 MUST 同步更新，且 MUST NOT 因門檻切換再次呼叫 TDCC 上游

#### Scenario: 門檻包含無法切開的邊界
- **WHEN** 市場慣稱門檻與 TDCC 級距的精確下界不同，例如「1,000 張以上」對應 `1,000,001 股以上`
- **THEN** 級距選單 MUST 顯示精簡市場慣稱，詳細資料表 MUST 顯示實際官方範圍
- **AND** MUST NOT 隱藏、四捨五入或推估該邊界差異

## ADDED Requirements

### Requirement: TDCC holder 右鍵詳細資料表

大戶與散戶 pane MUST 在既有滑鼠右鍵與鍵盤功能表顯示「詳細資料」，且 MUST NOT 在標題列新增詳細資料按鈕。點選後 MUST 以結構化表格顯示目前 holder 讀值的完整內容，並提供可存取的關閉行為。

#### Scenario: 從右鍵功能表查看完整明細
- **WHEN** 使用者在大戶或散戶副圖按滑鼠右鍵並點選「詳細資料」
- **THEN** pane MUST 將精簡標題恢復至最新已發布的 holder snapshot，並顯示包含日期、持股比例、週變化、官方級距、張數、人數、來源、資料頻率與提醒的表格
- **AND** 表格值 MUST 與目前標題列日期、級距選擇及已繪製資料一致

#### Scenario: 以鍵盤開啟詳細資料
- **WHEN** 使用者在 holder pane 以 Context Menu 鍵或 `Shift+F10` 開啟功能表後選取「詳細資料」
- **THEN** 系統 MUST 顯示同一份表格並將焦點移入詳細資料區
- **AND** Escape 或點擊表格外 MUST 關閉表格並保留副圖可操作性

#### Scenario: 非 holder 副圖
- **WHEN** 使用者開啟法人、融資券、借券或券資比副圖的右鍵功能表
- **THEN** 系統 MUST NOT 顯示 TDCC「詳細資料」項目
- **AND** 原有線圖項目、回補與移除副圖行為 MUST 維持不變

#### Scenario: pane 移除或切換商品
- **WHEN** 詳細資料開啟期間移除 pane、切換商品或銷毀 controller
- **THEN** 系統 MUST 關閉並清理詳細資料 DOM 與事件 listener
- **AND** MUST NOT 留下浮層、舊商品明細或失效焦點
