## MODIFIED Requirements

### Requirement: 大戶與散戶獨立副圖

系統 MUST 將大戶持股與散戶持股提供為兩個可獨立選取的週頻複合 pane；每個 pane MUST 同時以比例線顯示持股比例，並以正負柱顯示相較前一筆實際發布週資料的百分點變化。pane MUST 永久標示「週資料／當週最後營業日」，tooltip MUST 顯示門檻、持股比例、週增減、持股張數、持股人數、方向、頻率及實際資料日期。方式 B 同時勾選時 MUST 上下排列且共用相同 TDCC response；方式 A MUST 只顯示目前選取的一個 pane。TDCC 值 MUST 只屬於其實際 `dataDate`，其他交易日不得 forward-fill、插值或視為 0。

#### Scenario: 顯示預設大戶持股
- **WHEN** 大戶持股 pane 建立且有至少一筆 TDCC 分級 15 資料
- **THEN** pane MUST 以百分比線圖顯示分級 15 的持股比例
- **AND** tooltip MUST 顯示「1,000 張級距大戶」、實際為 `1,000,001 股以上`、持股張數、人數、資料日期與 TDCC 來源

#### Scenario: 顯示預設散戶持股
- **WHEN** 散戶持股 pane 建立且具有 TDCC 分級 1 至 3 資料
- **THEN** pane MUST 以百分比線圖顯示三個分級加總比例
- **AND** tooltip MUST 顯示「10 張以下」、加總持股張數、人數、資料日期與 TDCC 來源

#### Scenario: 顯示週變化柱
- **WHEN** 某週加總持股比例高於、低於或等於前一筆實際發布週資料
- **THEN** pane MUST 以本週比例減前週比例的百分點顯示柱值
- **AND** 增加柱使用台股紅色、減少柱使用綠色、零值使用中性色，tooltip MUST 同時顯示正負方向與「百分點」

#### Scenario: 只有一筆 TDCC 快照
- **WHEN** 查詢範圍只有一筆合法股權分散資料
- **THEN** pane MUST 顯示該筆比例資料點，且該 `dataDate` 的 tooltip MUST 顯示日期與「目前僅 1 期／尚無前週比較」
- **AND** MUST NOT 畫出週變化柱、假的水平趨勢或每日補值

#### Scenario: 同一週某個分級缺漏
- **WHEN** 大戶或散戶計算所需的任一持股分級為缺漏或驗證失敗
- **THEN** 該 pane MUST 將該週標示為部分或無資料
- **AND** MUST NOT 將缺少分級視為零後繼續加總

#### Scenario: 游標停在 TDCC 未發布日
- **WHEN** 游標 `sessionDate` 不是任何一筆 TDCC 的實際 `dataDate`
- **THEN** 大戶／散戶 tooltip MUST 明示「當日無發布資料」
- **AND** MUST NOT 把前一週比例或週增減顯示成游標當日資料
- **AND** 若另列最近一筆資料作為參考，MUST 明確標示其實際 `dataDate` 並與當日缺值狀態區分

### Requirement: 籌碼資料狀態與可及性

系統 MUST 在籌碼副圖顯示載入中、部分資料、資料過期、尚未發布、歷史不足、實際回補進度、不適用與來源不可用狀態；普通股與 ETF 的每個 dataset MUST 獨立顯示狀態。series MUST 有文字 label，讀值與操作 MUST 不只靠顏色辨識。只有 API 證明存在 queued 或 running backfill job 時，UI 才可宣稱歷史回補中。

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
- **THEN** 狀態區 MUST 顯示實際可用起日、已保存週數與「較早週資料未保存」
- **AND** MUST NOT 以空白日資料、外資持股或其他籌碼 series 補足

#### Scenario: 只有最新週快照且沒有回補工作
- **WHEN** API 只有一筆合法 `distributionRows`，且 backfill 狀態不是 queued 或 running
- **THEN** pane MUST 顯示資料日期與「目前僅 1 期／尚無前週比較」
- **AND** 比例資料點 MUST 可辨識，週變化柱 MUST 保持空白
- **AND** MUST NOT 顯示「歷史累積中」或其他暗示背景下載的文字

#### Scenario: 歷史回補正在執行
- **WHEN** API 回傳 backfill 狀態為 queued 或 running，並提供已完成與預期週數
- **THEN** pane MUST 顯示「歷史回補中（x/y 週）」或同等可辨識進度
- **AND** MUST 繼續顯示 D1 目前已驗證的比例點與週變化柱

#### Scenario: 歷史回補部分失敗
- **WHEN** API 回傳 backfill 狀態為 partial 或 failed
- **THEN** pane MUST 保留已驗證資料並顯示「回補未完成」及安全原因
- **AND** MUST NOT 清除已成功週或偽裝為 completed

#### Scenario: 完全沒有可用資料
- **WHEN** eligible 商品的指定 dataset 在請求範圍內沒有 D1 或上游資料
- **THEN** 該 pane 顯示安全且可理解的原因
- **AND** 不保留上一個商品的 series 或讀值

#### Scenario: 鍵盤與輔助辨識
- **WHEN** 使用者以鍵盤操作副圖選單或以非彩色方式閱讀圖表
- **THEN** 每個選項具有可聚焦 label 與狀態
- **AND** series 以名稱、線型／標記及文字讀值共同辨識
