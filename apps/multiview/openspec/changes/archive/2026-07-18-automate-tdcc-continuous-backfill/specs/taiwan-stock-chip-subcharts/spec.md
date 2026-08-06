## MODIFIED Requirements

### Requirement: 籌碼資料狀態與可及性

系統 MUST 在籌碼副圖顯示載入中、部分資料、資料過期、尚未發布、等待背景回補、背景回補中、回補未完成、來源阻擋、不適用與來源不可用狀態；普通股與 ETF 的每個 dataset MUST 獨立顯示狀態，大戶／散戶 MUST 使用目前 symbol 的 coverage／queue，而非全域工作狀態。series MUST 有文字 label，讀值與操作 MUST 不只靠顏色辨識。

#### Scenario: 使用過期 D1 資料
- **WHEN** API 回傳 rows 並標示 `stale_cache`
- **THEN** 副圖仍顯示最近成功資料
- **AND** 狀態區顯示資料日期與「資料可能過期」

#### Scenario: ETF 部分資料可用
- **WHEN** ETF 的法人與融資券可用，但借券或外資持股沒有來源紀錄
- **THEN** 可用 pane MUST 正常顯示，缺資料 pane MUST 顯示自己的安全原因
- **AND** MUST NOT 把整個 ETF 或所有籌碼選項標示為不適用

#### Scenario: 新增台股等待背景回補
- **WHEN** 目前 symbol 已建立 continuous-backfill queue 但尚未開始處理
- **THEN** 大戶／散戶 pane MUST 顯示「等待背景回補」與實際可用 coverage
- **AND** MUST NOT 顯示另一個 symbol 或全域 job 的進度

#### Scenario: 目前台股正在背景回補
- **WHEN** API 回傳目前 symbol 的 backfill status 為 running
- **THEN** pane MUST 顯示「背景回補中（x/y 週）」及既有資料
- **AND** 已完成週的比例線與週增減柱 MUST 保持可用

#### Scenario: 股權分散歷史尚未完整
- **WHEN** 大戶／散戶查詢範圍早於 D1 或免費官方來源可用的最早 TDCC 資料日期
- **THEN** 狀態區 MUST 顯示實際可用起日、missing weeks 與目前 symbol 的 partial／blocked 狀態
- **AND** MUST NOT 以空白日資料、外資持股或其他籌碼 series 補足

#### Scenario: 只有最新週快照但已排程
- **WHEN** API 只有一筆合法 `distributionRows` 且目前 symbol 為 queued 或 running
- **THEN** pane MUST 顯示實際排程狀態，不得只顯示「目前僅 1 期」
- **AND** 比例資料點 MUST 可辨識，週變化柱 MUST 保持空白直到有前一筆實際發布週

#### Scenario: 只有最新週快照且沒有工作
- **WHEN** API 只有一筆合法 `distributionRows` 且目前 symbol 沒有 queued／running 工作
- **THEN** pane MUST 顯示「目前僅 1 期／尚無前週比較」
- **AND** MUST NOT 以「累積中」暗示背景工作正在執行

#### Scenario: 歷史來源阻擋
- **WHEN** 目前 symbol 因 CAPTCHA、封鎖、格式漂移或不允許背景操作而設為 blocked
- **THEN** pane MUST 保留並顯示已成功資料及安全原因
- **AND** MUST NOT 顯示「回補中」或清除既有 series

#### Scenario: 完全沒有可用資料
- **WHEN** eligible 商品的指定 dataset 在請求範圍內沒有 D1 或上游資料
- **THEN** 該 pane 顯示安全且可理解的原因
- **AND** 不保留上一個商品的 series 或讀值

#### Scenario: 鍵盤與輔助辨識
- **WHEN** 使用者以鍵盤操作副圖選單或以非彩色方式閱讀圖表
- **THEN** 每個選項具有可聚焦 label 與狀態
- **AND** series 以名稱、線型／標記及文字讀值共同辨識
