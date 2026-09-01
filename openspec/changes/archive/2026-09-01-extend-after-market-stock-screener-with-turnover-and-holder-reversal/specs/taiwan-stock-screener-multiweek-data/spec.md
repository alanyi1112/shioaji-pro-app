## ADDED Requirements

### Requirement: 日資料必須保存正式成交值及可比較來源契約

選股日資料 MUST 從與成交量相同的正式日列保存成交值：TWSE 使用已核對的 `TradeValue`，TPEx 使用已核對的 `TransactionAmount`，歷史報表 MUST 使用經逐市場驗證的等價欄位。每筆 MUST 保存 provider、source date、原欄位、幣別、交易範圍、正規化版本與非負精確整數元；兩市場或本期／前期契約不相容時 MUST 回 `incomparable_source`，不得以猜測欄位補值。

#### Scenario: 解析萬元門檻與官方元值

- **WHEN** 使用者設定 1,234.56 萬，官方成交值為 12,345,600 元
- **THEN** 系統 MUST 以精確整數判定相等並通過，不得因浮點或格式化誤差失敗

#### Scenario: 成交值欄位缺漏

- **WHEN** 正式日列有成交股數但缺少或無法解析成交值
- **THEN** 系統 MUST 保留合法成交量、將成交值標為 unknown 並記錄來源原因，不得以成交量、成交筆數或零值代替

#### Scenario: 兩市場日期尚未對齊

- **WHEN** TWSE 與 TPEx 最新成交值來源日不同
- **THEN** publisher MUST 維持上一份共同 D 的合法 snapshot 或標示等待，不得把不同日期合併為同一成交值條件

### Requirement: 選股 TDCC 資料必須保留至少六個相鄰官方週期

選股專用資料層 MUST 對每個 universe 商品保存最新至少六個、由官方期間證據確認相鄰且通過完整 17 級驗證的 TDCC 週期，足以判斷反轉前最多四次同方向變化與最新反轉。prune MUST 依官方週期集合執行，不得只取資料表最近六筆；稀疏、失敗或較新但不完整的資料 MUST NOT 覆蓋最後已驗證列。

#### Scenario: 發布六期 series

- **WHEN** 商品最新六個官方週期均完整有效
- **THEN** v2 snapshot MUST 按日期順序包含六期第 15 級比例與必要 provenance，且不夾入非官方日期

#### Scenario: 第七期到達

- **WHEN** 新官方週期通過驗證並發布
- **THEN** 資料層 MUST 保留新的六期滑動窗，只有在沒有任何受保留 snapshot／checkpoint 依賴時才可移除更舊選股列

### Requirement: 全市場六期資料必須由有界且可恢復的背景工作補足

首次升級、新商品加入與中斷恢復時，背景 operator MUST 以完整官方 universe 建立每檔所缺週期清單，先重用通過相同完整性與來源版本驗證的本機列，再依固定 request／時間 budget、single-flight、timeout、冷卻及有界 retry 補取。工作 MUST 保存 target、processed、remaining、failed、overdue、cursor 與各週期 checkpoint；MUST NOT 由 GET 查詢或 UI 操作觸發，也不得加入個人 TDCC 長歷史佇列。

#### Scenario: 首次由兩期升級為六期

- **WHEN** universe 有 1,975 檔但選股表僅有最新兩期
- **THEN** operator MUST 只建立每檔缺少的最多四期工作，分批續跑並在期間將相應反轉狀態標為 `history-pending`

#### Scenario: 新商品加入母體

- **WHEN** 官方名冊加入一檔新普通股
- **THEN** operator MUST 從加入後開始收集並只回補該商品可合法取得的必要六期，不等待加入自選清單或開啟圖表

#### Scenario: 來源限速或本機休眠

- **WHEN** 工作遇到 rate limit、timeout、來源冷卻或本機休眠
- **THEN** 已驗證列與 checkpoint MUST 保留，下次只續作 remaining；不得提高為無界併發、重跑已完成項目或清空全市場資料

#### Scenario: 歷史來源不可合法自動取得

- **WHEN** 某必要週期受到 CAPTCHA、登入、封鎖、授權或自動化限制而無法合法取得
- **THEN** 系統 MUST 停止該來源路徑並保留 `history-pending`／可讀原因，等待自然累積或核准來源，不得繞過限制或偽造完成

### Requirement: 核准的歷史批次鏡像必須固定版本、完整驗證且只能補缺

本次六期升級 MAY 使用使用者明確核准的 TDCC `1-5` 公開歷史 CSV 鏡像，但 MUST 固定 exact repository commit、逐期 URL、原始位元組數與 SHA-256，MUST NOT 接受 redirect、環境變數或任意外部 URL。六期 MUST 在任何寫入前全部通過 UTF-8、精確欄名、單一預期日期、唯一證券代號、每檔完整 1–17 級、整數精度、調整與合計驗證；最新鏡像期 MUST 與同次取得的 TDCC 官方全市場資料逐商品完全相同。

鏡像 MUST 只以冪等 insert 補入缺列，MUST NOT 覆蓋任何既有 `full-17` 官方 OpenAPI、官方歷史表單或合法本機列。provenance MUST 同時保留 TDCC provider、鏡像 exact URL、SHA-256、固定 commit、抓取時間與 normalization version。任一檔驗證失敗時 MUST 在寫入前拒絕整批鏡像、保存非敏感原因，並回退既有官方逐商品有界流程；一般 schedule MUST NOT 自動啟用鏡像。

#### Scenario: 最新鏡像與官方批次相同

- **WHEN** 六個固定 CSV 全部通過 manifest 與 17 級驗證，且最新一期對本機 universe 的每筆資料與 TDCC 官方 OpenAPI 完全相同
- **THEN** operator MAY 以鏡像補入缺少的歷史列，既有官方列 MUST 維持原 provenance 不變

#### Scenario: 固定檔遭修改或最新期不一致

- **WHEN** 任一期 SHA-256、日期、欄名、級距、合計或最新期官方對帳不一致
- **THEN** operator MUST 在任何鏡像寫入前拒絕整批，MUST NOT 部分匯入或更新 manifest，並只使用既有官方逐商品回退流程

### Requirement: v2 snapshot 必須原子保存全市場資料準備狀態

publisher MUST 對完整 universe 每檔恰建立一筆 v2 snapshot row，包含可用日成交值、最多六期 TDCC series、各資料族群狀態與 provenance。snapshot metadata MUST 記錄 universe／formula／schema version、D、TDCC 週期集合、total、完整與缺漏計數、背景 remaining／failed／overdue 及生成時間；發布 MUST 為 immutable 且原子。部分歷史未完成 MUST 不得阻止其他商品或未要求多週的模式判定，但 MUST NOT 宣稱全資料 ready。

#### Scenario: 部分商品尚待歷史回補

- **WHEN** 全母體已處理但 100 檔仍缺反轉所需週期
- **THEN** snapshot MUST 仍含全部商品，metadata MUST 顯示 100 檔 history pending，已完整商品可判定且缺漏商品為 unknown

#### Scenario: 發布中斷

- **WHEN** v2 staging 尚未完成便發生錯誤
- **THEN** API MUST 繼續提供上一份完整發布的 snapshot，不得讓部分新列與舊列混合

### Requirement: 本機唯讀 API 不得觸發資料準備或外部副作用

v2 status／results API MUST 僅查詢本機 D1 已發布 snapshot，所有 mode、週數、百分點、成交值、排序、cursor、limit 與 version MUST 受固定 schema 驗證。重複查詢、翻頁與缺歷史 MUST NOT 產生 provider request、backfill dispatch、Shioaji subscription、委託或 runtime 管理；hosted target MUST 不啟用此路由。

#### Scenario: 查詢 history-pending 商品

- **WHEN** 使用者反覆篩選仍缺六期的商品
- **THEN** API MUST 每次只回既有 snapshot 的 unknown 與 checkpoint 摘要，不得因查詢次數增加外部 request

#### Scenario: 非法週數或成交值

- **WHEN** 請求包含 N=0、N=5、負成交值、超界小數、未知 mode 或任意 upstream URL
- **THEN** API MUST 有界拒絕且不存取外網、不回傳 stack 或秘密

### Requirement: 完成驗收必須證明全市場、六期與來源守恆

完成證據 MUST 包含正式來源 review、實際 D、六個 TDCC 官方週期、TWSE／TPEx 母體與處理數、成交值有值／缺漏數、六期完整／pending 數、target／processed／remaining／failed／overdue、三態守恆與結果 hash。測試及實際 UI／API 驗收 MUST 涵蓋兩市場代表商品、不在自選清單的商品、兩種四週反轉、成交值邊界、缺中間週、來源冷卻、續跑及 v1 遷移；僅 fixture 或全域成功時間 MUST NOT 取代 live evidence。

#### Scenario: 宣告背景補資料完成

- **WHEN** 實作者要將六期背景準備標記完成
- **THEN** 證據 MUST 顯示當次 universe 的 remaining、failed、overdue 均為 0，或把合法且不可取得的項目明確列為已接受 unknown 並保持對應任務未勾選

#### Scenario: 宣告介面完成

- **WHEN** 實作者要將進階選股介面標記完成
- **THEN** 必須在實際本機服務核對 DOM、可見控制、console、API 分頁與點選結果連動 K 線，且選股操作不得改寫自選清單、交易草稿或 simulation runtime
