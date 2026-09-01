# taiwan-stock-screener-daily-ohlcv-history Specification

## Purpose
TBD - created by archiving change add-technical-pattern-filters-to-after-market-stock-screener. Update Purpose after archive.
## Requirements
### Requirement: 選股 OHLC 必須來自已核對的官方全市場日資料
系統 MUST 以 TWSE／TPEx 官方全市場日資料建立選股 OHLC。實作前 MUST 分市場核對最新批次與歷史日期報表的實際日期、open／high／low／close 欄位、價格基礎、交易範圍、授權、自動化限制與市場覆蓋；來源契約不相容時 MUST fail closed，不得改用 Yahoo、Shioaji、自選清單或畫面 K 棒冒充全市場資料。

#### Scenario: 官方欄位與日期契約通過
- **WHEN** 某市場批次的實際欄位、回傳日期、價格基礎與 universe revision 均通過驗證
- **THEN** 系統 MUST 保存 canonical OHLC、原欄位、mapping version、payload hash 與 fetchedAt

#### Scenario: 歷史端點忽略 requested date
- **WHEN** 歷史報表實際回傳日期不同於所要求的官方交易日
- **THEN** 系統 MUST 拒收該批次並回明確 reason，不得把回應重新標成要求日期

### Requirement: OHLC 正規化必須拒絕非法或不一致 K 棒
每筆 OHLC MUST 為有限正數並滿足 `high >= max(open,close)`、`low <= min(open,close)` 及 `high >= low`。無成交、停牌、缺欄、零值、非有限值、超出安全精度或日期不符 MUST 保存為明確缺漏／invalid evidence，不能補零、沿用前值或推算。

#### Scenario: 合法官方 K 棒
- **WHEN** open／high／low／close 皆為合法正數且符合 OHLC 邊界
- **THEN** 系統 MUST 以 canonical 價格精度保存該 symbol／session

#### Scenario: 缺少收盤價但其他欄位存在
- **WHEN** 官方列缺少 close 或 close 無法解析
- **THEN** 系統 MUST 將該商品日期標為 invalid，且不得由 open、昨收或報價快照推算 close

### Requirement: 本機 D1 必須保存至少 60 個官方市場交易日滑動窗
系統 MUST 在 repo 外本機 D1 以 `symbol + session_date` 冪等保存至少最新 60 個已驗證官方市場交易日，並保存當次 universe revision、逐市場 session receipts 與 retention anchors。清理 MUST 保留最新 60 日及仍被保留 snapshot 引用的日期，不得刪除其他產品的 candle history、TDCC、清單或交易資料。

#### Scenario: 完整滑動窗
- **WHEN** 最新官方市場交易日為 D 且前 59 個 session 均已處理
- **THEN** coverage MUST 顯示 60 個有序官方 session，並可逐市場核對 target／processed／missing

#### Scenario: Snapshot 引用較舊日期
- **WHEN** 保留中的 immutable snapshot 引用已超出最新 60 日的錨點
- **THEN** retention MUST 暫時保留該錨點，直到 snapshot 合法淘汰

### Requirement: 歷史 bootstrap 必須以市場日期批次且有界續跑
背景 operator MUST 以 `market + session` 建立 deterministic target、cursor 與 checkpoint，同一正式回應服務該市場當日全母體。每次 run MUST 有固定 request／時間 budget、single-flight、完整 fetch＋body timeout、冷卻、Retry-After 與有界 retry；中斷或本機休眠後 MUST 從未完成 target 續跑，不得改成逐商品無界併發。

#### Scenario: Run 達到 budget
- **WHEN** operator 尚有目標但已達 request 或時間上限
- **THEN** 系統 MUST 保存 target／processed／remaining／failed／overdue／cursor，並在下次從 cursor 續跑

#### Scenario: 同一市場日期重跑
- **WHEN** 某 market／session 已有相同或較新且完整的 verified receipt
- **THEN** operator MUST 重用完成狀態，不得再次抓取或重寫未變資料

#### Scenario: 來源 rate limit
- **WHEN** 官方來源回 429 或合法 Retry-After
- **THEN** operator MUST 進入有界冷卻並保存安全 reason，不得 busy-loop 或改找未核准入口

### Requirement: 新商品必須自加入母體起納入 OHLC 準備
當 universe revision 新增合法上市／上櫃普通股時，系統 MUST 依上市日與現有 60 日 session plan 只建立該商品可合法取得的必要歷史資料。系統 MUST NOT 將商品加入自選清單、啟動 Shioaji 訂閱、修改個人 TDCC 長歷史 target 或抓取上市前 K 棒。

#### Scenario: 新上市商品不足 21 日
- **WHEN** 新商品上市日至 D 少於 BOLL 所需交易日
- **THEN** 系統 MUST 保存可取得的官方 OHLC並回 `insufficient_history`，不得使用上市前日期或其他商品資料補足

#### Scenario: 既有商品新進母體但歷史可取得
- **WHEN** universe revision 首次納入某商品且官方歷史批次涵蓋必要日期
- **THEN** 背景 planner MUST 只補其缺少的 market／session rows，已驗證日期不得重抓

### Requirement: v3 發布必須以全市場批次終態為 gate
publisher MUST 先核對所有預期 market／session receipt、universe total、逐市場守恆與 snapshot staging row count。只有每個 target 已 collected 或為可解釋正式終態，且 staging rows 等於 universe total，才能原子發布 v3；部分日期、部分市場或只有自選清單資料時 MUST 保留最後合法 v2 snapshot。

#### Scenario: 個別商品有合法缺日
- **WHEN** 所有市場日期批次都已處理，但某商品因停牌或新上市缺必要 OHLC
- **THEN** 系統 MAY 發布涵蓋全母體的 v3 snapshot，該 row MUST 為明確 unknown，守恆計數仍須成立

#### Scenario: TPEx 某日期尚未處理
- **WHEN** TWSE 已完整但任一必要 TPEx session 尚未進入正式終態
- **THEN** 系統 MUST NOT 將 v3 宣告為全市場完成或發布部分 TPEx snapshot

### Requirement: Snapshot 技術證據必須 deterministic 且受版本保護
publisher MUST 以同一份有序 OHLC 與 canonical 公式計算分型、包含合併、BOLL P／D 及反轉 K，並保存 formula／normalization／source version。較舊、較稀疏或驗證較低的回應 MUST NOT 將既有合法結果降級；v1／v2／v3 rows、cursor 與 cache MUST 明確隔離。

#### Scenario: 相同資料重算
- **WHEN** 相同 universe、session、OHLC 與公式版本重跑 publisher
- **THEN** 結果、criteria evidence hash 與排序 MUST deterministic，且不得產生內容不同的新 snapshot

#### Scenario: 較新稀疏回應
- **WHEN** 同一 session 收到 fetchedAt 較新但缺 OHLC 的回應
- **THEN** 系統 MUST 保留既有 verified row並記錄稀疏回應，不得清空合法 K 棒或衍生結果

### Requirement: UI 與 GET 不得觸發 OHLC 回補或行情副作用
選股 status／results GET 與 UI 重整、套用條件、排序、翻頁、展開 evidence MUST 只讀本機 immutable snapshot。它們 MUST NOT 呼叫官方 provider、Yahoo、Shioaji Kbars、行情訂閱、background dispatch、DDL、runtime 管理或任何交易 API。

#### Scenario: 重複篩選技術條件
- **WHEN** 使用者以相同 snapshot 重複篩選、排序及翻頁
- **THEN** provider／回補／Shioaji／交易呼叫計數 MUST 維持零

#### Scenario: v3 bootstrap 尚未完成
- **WHEN** UI 查詢時 OHLC background progress 仍有 remaining
- **THEN** UI MUST 顯示 preparation pending 或最後合法 v2 狀態，且不得由 GET 派送補資料

### Requirement: Live 驗收必須證明全市場資料與實際畫面一致
完成前 MUST 對本機 D1 執行 integrity、schema、60 日 session、TWSE／TPEx 母體、逐日期筆數、unknown reasons、snapshot 原子性與 progress 終態核對；並以原始三 K頂／底、纏論頂／底、兩種 BOLL 首次穿越、missing／insufficient、新商品及未加入清單商品跑完整 API 分頁與實際 UI 驗收。Fixture 或單一商品成功 MUST NOT 代替全市場 live evidence。

#### Scenario: 全市場 background 終態
- **WHEN** full run 宣告完成
- **THEN** target／processed／remaining／failed／overdue MUST 與逐市場／日期 receipts 守恆，remaining／failed／overdue 只有在規格允許的正式終態下才能為零

#### Scenario: 實際點選未加入清單商品
- **WHEN** live API 篩出不在自選清單的技術型態商品並由 UI 點選
- **THEN** 指定日 K 圖 MUST 顯示同商品與可核對日期，console 無錯誤，且自選清單、行情連線與交易狀態不變
