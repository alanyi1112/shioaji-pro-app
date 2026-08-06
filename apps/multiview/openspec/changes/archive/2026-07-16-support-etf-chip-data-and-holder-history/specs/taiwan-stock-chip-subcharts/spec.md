## ADDED Requirements

### Requirement: 台股籌碼副圖選單

系統 MUST 在每個圖表面板的單一「副圖」選單中，以可辨識的「技術指標」與「籌碼資料」群組提供既有 RSI、KD、MACD、ATR，以及外資買賣超、投信買賣超、自營商買賣超、三大法人合計、外資持股、融資、融券、借券、大戶持股及散戶持股選項。工具列 MUST NOT 再提供獨立「籌碼」按鈕。系統 MUST 在 eligible 台股普通股與 ETF 的 `1d` 週期依 dataset 載入籌碼資料；技術指標的計算與同圖複選行為 MUST 保持不變。

#### Scenario: 從單一副圖選單選擇三大法人合計
- **WHEN** 使用者在 eligible 普通股或 ETF 日 K 面板展開「副圖」並選擇「三大法人合計」
- **THEN** 面板依目前 A／B 模式顯示對應籌碼 pane
- **AND** 只請求目前 K 線資料範圍所需的 `institutional-flow` 資料
- **AND** 工具列不顯示另一個「籌碼」入口

#### Scenario: 以鍵盤操作合併選單
- **WHEN** 使用者以鍵盤展開「副圖」選單並巡覽選項
- **THEN** 技術指標與籌碼資料群組及每個選項 MUST 具有可聚焦 label 與可辨識狀態
- **AND** 焦點順序 MUST NOT 經過已移除的獨立籌碼按鈕

#### Scenario: 切換到非日 K
- **WHEN** 籌碼副圖已選取且使用者把週期切換為 `1h`、`1wk` 或其他非 `1d` 週期
- **THEN** 系統清除舊籌碼 series 並顯示「籌碼資料僅支援日 K」
- **AND** MUST NOT 顯示先前日 K 的籌碼資料

#### Scenario: 切換到 ETF
- **WHEN** 籌碼副圖已選取且使用者切換到商品目錄確認的 TWSE／TPEx ETF 日 K
- **THEN** 系統 MUST 請求並顯示各 dataset 的獨立 availability
- **AND** 一個 pane 無資料時其他可用 pane MUST 繼續顯示

#### Scenario: 切換到真正不支援商品
- **WHEN** 籌碼副圖已選取且使用者切換到海外商品、權證、未知或停用商品
- **THEN** 系統顯示中性不適用狀態
- **AND** MUST NOT 發出籌碼上游請求

#### Scenario: 分別選擇大戶與散戶
- **WHEN** 使用者在 eligible 台股普通股或 ETF 日 K 面板選擇「大戶持股」及「散戶持股」
- **THEN** 面板 MUST 依目前模式替換單一共用槽位或建立兩個獨立週頻 pane
- **AND** 兩個顯示項目 MUST 共用 D1 中相同日期範圍的 TDCC 股權分散資料

## MODIFIED Requirements

### Requirement: 大戶與散戶獨立副圖

系統 MUST 將大戶持股與散戶持股提供為兩個可獨立選取的週頻複合 pane；每個 pane MUST 同時以比例線顯示持股比例，並以正負柱顯示相較前一筆實際發布週資料的百分點變化。pane MUST 顯示門檻、持股比例、週增減、持股張數、持股人數、方向、頻率及資料日期。方式 B 同時勾選時 MUST 上下排列且共用相同 TDCC response；方式 A MUST 只顯示目前選取的一個 pane。

#### Scenario: 顯示預設大戶持股
- **WHEN** 大戶持股 pane 建立且有至少一筆 TDCC 分級 15 資料
- **THEN** pane MUST 以百分比線圖顯示分級 15 的持股比例
- **AND** 讀值 MUST 顯示「1,000 張級距大戶」、實際為 `1,000,001 股以上`、持股張數、人數、資料日期與 TDCC 來源

#### Scenario: 顯示預設散戶持股
- **WHEN** 散戶持股 pane 建立且具有 TDCC 分級 1 至 3 資料
- **THEN** pane MUST 以百分比線圖顯示三個分級加總比例
- **AND** 讀值 MUST 顯示「10 張以下」、加總持股張數、人數、資料日期與 TDCC 來源

#### Scenario: 顯示週變化柱
- **WHEN** 某週加總持股比例高於、低於或等於前一筆實際發布週資料
- **THEN** pane MUST 以本週比例減前週比例的百分點顯示柱值
- **AND** 增加柱使用台股紅色、減少柱使用綠色、零值使用中性色，文字讀值 MUST 同時顯示正負方向與「百分點」

#### Scenario: 只有一筆 TDCC 快照
- **WHEN** 查詢範圍只有一筆合法股權分散資料
- **THEN** pane MUST 顯示該筆比例資料點、日期與「首筆／無前週比較」
- **AND** MUST NOT 畫出週變化柱、假的水平趨勢或每日補值

#### Scenario: 同一週某個分級缺漏
- **WHEN** 大戶或散戶計算所需的任一持股分級為缺漏或驗證失敗
- **THEN** 該 pane MUST 將該週標示為部分或無資料
- **AND** MUST NOT 將缺少分級視為零後繼續加總

### Requirement: 籌碼副圖時間軸與十字線同步

所有實際顯示的籌碼 pane MUST 以 `sessionDate`／`dataDate` 與主 K 線及目前可見的技術副圖同步 visible range、crosshair、resize、聚焦模式及向左載入；沒有資料的交易日 MUST 保留 gap。每個 pane MUST 使用完整 candle 日期的 time anchor，使日頻與週頻資料共用相同 X 座標。方式 A 被替換而隱藏的副圖 MUST NOT 參與同步或以零尺寸更新。

#### Scenario: 主圖平移與縮放
- **WHEN** 使用者平移或縮放主 K 線
- **THEN** 所有實際顯示的副圖 MUST 顯示相同交易日期範圍
- **AND** 同步過程不得形成循環更新或跳動

#### Scenario: 籌碼副圖移動十字線
- **WHEN** 使用者在任一籌碼 pane 移動十字線
- **THEN** 主圖、目前可見的技術副圖及其他作用中的籌碼 pane MUST 同步到相同或最近的交易日
- **AND** 所有讀值使用同一個 `sessionDate` 或實際 TDCC `dataDate`

#### Scenario: 方式 A 切換共用槽位內容
- **WHEN** 使用者在技術副圖與籌碼 pane 間替換作用內容
- **THEN** 新顯示的 chart MUST 立即套用主圖目前 visible range 與可用尺寸
- **AND** 已隱藏 chart MUST NOT 接收 crosshair 或 resize 更新

#### Scenario: 向左載入更早歷史
- **WHEN** 主 K 線載入更早 candles 且籌碼副圖已啟用
- **THEN** 前端只查詢新增的日期缺口
- **AND** 合併後的籌碼 rows 不重複、不改變既有日期值的順序

#### Scenario: 對齊每週股權分散資料
- **WHEN** 大戶／散戶副圖顯示於日 K 面板
- **THEN** 每個比例線資料點與週變化柱 MUST 只對齊 TDCC 回傳的實際 `dataDate`
- **AND** 其他交易日 MUST 保留 gap，不得 forward-fill、插值或複製前一週比例

### Requirement: 籌碼資料狀態與可及性

系統 MUST 在籌碼副圖顯示載入中、部分資料、資料過期、尚未發布、歷史不足、不適用與來源不可用狀態；普通股與 ETF 的每個 dataset MUST 獨立顯示狀態。series MUST 有文字 label，讀值與操作 MUST 不只靠顏色辨識。

#### Scenario: 使用過期 D1 資料
- **WHEN** API 回傳 rows 並標示 `stale_cache`
- **THEN** 副圖仍顯示最近成功資料
- **AND** 狀態區顯示資料日期與「資料可能過期」

#### Scenario: ETF 部分資料可用
- **WHEN** ETF 的法人與融資券可用，但借券或外資持股沒有來源紀錄
- **THEN** 可用 pane MUST 正常顯示，缺資料 pane MUST 顯示自己的安全原因
- **AND** MUST NOT 把整個 ETF 或所有籌碼選項標示為不適用

#### Scenario: 股權分散歷史尚未完整
- **WHEN** 大戶／散戶查詢範圍早於 D1 或免費官方來源可用的最早 TDCC 資料日期
- **THEN** 狀態區 MUST 顯示實際可用起日與「較早週資料未保存」
- **AND** MUST NOT 以空白日資料、外資持股或其他籌碼 series 補足

#### Scenario: 只有最新週快照
- **WHEN** API 只有一筆合法 `distributionRows`
- **THEN** pane MUST 顯示資料日期與「首筆／歷史累積中」
- **AND** 比例資料點 MUST 可辨識，週變化柱 MUST 保持空白

#### Scenario: 完全沒有可用資料
- **WHEN** eligible 商品的指定 dataset 在請求範圍內沒有 D1 或上游資料
- **THEN** 該 pane 顯示安全且可理解的原因
- **AND** 不保留上一個商品的 series 或讀值

#### Scenario: 鍵盤與輔助辨識
- **WHEN** 使用者以鍵盤操作副圖選單或以非彩色方式閱讀圖表
- **THEN** 每個選項具有可聚焦 label 與狀態
- **AND** series 以名稱、線型／標記及文字讀值共同辨識

## REMOVED Requirements

### Requirement: 台股個股籌碼副圖選單

**Reason**: 原 requirement 將 ETF 一律視為不支援商品，無法呈現來源實際提供的 ETF 籌碼資料。

**Migration**: 由新增的「台股籌碼副圖選單」取代；既有合併副圖入口、技術指標、A／B 模式與普通股操作保持相容。
