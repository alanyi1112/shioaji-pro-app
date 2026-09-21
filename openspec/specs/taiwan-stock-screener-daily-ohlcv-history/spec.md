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

背景 operator MUST 以 `market + session` 建立 deterministic target、cursor 與 checkpoint，同一正式回應服務該市場當日全母體。planner MUST 以目前 universe、listing date、既有 canonical rows、來源 schema 與 receipt coverage 算出實際缺口，不得僅因 universe revision、商品名稱或無關市場異動就使所有已驗證 target 失效。每次 run MUST 有固定 request／時間 budget、single-flight、完整 fetch＋body timeout、冷卻、Retry-After 與有界 retry；中斷或本機休眠後 MUST 從未完成 target 續跑，不得改成逐商品無界併發。

#### Scenario: Run 達到 budget

- **WHEN** operator 尚有目標但已達 request 或時間上限
- **THEN** 系統 MUST 保存 target／processed／remaining／failed／overdue／cursor，並在下次從 cursor 續跑

#### Scenario: 同一市場日期重跑

- **WHEN** 某 market／session 已有相同或較新且完整的 verified receipt，且目前 universe 的合資格商品 rows 已涵蓋
- **THEN** operator MUST 重用完成狀態，不得再次抓取或重寫未變資料

#### Scenario: Universe revision 只移除或改名

- **WHEN** universe revision 改變但既有 symbol 集合沒有新增合資格商品，或只發生名稱／分類 metadata 更新
- **THEN** 已驗證 60 日 OHLC targets MUST 維持完成，不得重新排入 120 個全量工作

#### Scenario: 來源 rate limit

- **WHEN** 官方來源回 429 或合法 Retry-After
- **THEN** operator MUST 進入有界冷卻並保存安全 reason，不得 busy-loop 或改找未核准入口

### Requirement: 新商品必須自加入母體起納入 OHLC 準備

當 universe revision 新增合法上市／上櫃普通股時，系統 MUST 依上市日、現有 60 日 session plan 與逐商品 canonical row coverage，只建立該商品可合法取得且實際缺少的歷史資料。市場日報雖可服務整個市場，既有商品的已驗證 rows 與 receipts MUST 保留；系統 MUST NOT 將商品加入自選清單、啟動 Shioaji 訂閱、修改個人 TDCC 長歷史 target 或抓取上市前 K 棒。

#### Scenario: 新上市商品不足 21 日

- **WHEN** 新商品上市日至 D 少於 BOLL 所需交易日
- **THEN** 系統 MUST 保存可取得的官方 OHLC 並回 `insufficient_history`，不得使用上市前日期或其他商品資料補足

#### Scenario: 既有商品新進母體但歷史可取得

- **WHEN** universe revision 首次納入某商品且官方歷史批次涵蓋必要日期
- **THEN** 背景 planner MUST 只補該商品缺 row 所在市場／日期，其他市場與已有完整 coverage 的日期不得重抓

#### Scenario: 每日 window 推進一日

- **WHEN** universe symbol 集合未變且最新完整交易日由 D-1 推進至 D
- **THEN** planner MUST 只新增 D 的 TWSE／TPEx 必要 target，並重用其餘 59 日的已驗證 coverage

### Requirement: v3 發布必須以全市場批次終態為 gate

publisher MUST 先核對所有預期 market／session receipt、universe total、逐市場守恆、snapshot staging row count 與日期一致性。只有每個 target 已 collected 或為可解釋正式終態、staging rows 等於 universe total，且 `base.expectedSessionDate`、`base.anchors.daily.current`、`technicalAnchors.through` 與 `effectiveSessionDate` 完全相等，才能原子發布 v3；部分日期、部分市場、只有自選清單資料或 mixed-session 時 MUST 保留最後合法 snapshot。

#### Scenario: 個別商品有合法缺日

- **WHEN** 所有市場日期批次都已處理，但某商品因停牌或新上市缺必要 OHLC
- **THEN** 系統 MAY 發布涵蓋全母體的 v3 snapshot，該 row MUST 為明確 unknown，守恆計數仍須成立

#### Scenario: TPEx 某日期尚未處理

- **WHEN** TWSE 已完整但任一必要 TPEx session 尚未進入正式終態
- **THEN** 系統 MUST NOT 將 v3 宣告為全市場完成或發布部分 TPEx snapshot

#### Scenario: 日量已到 9 月 2 日但技術 OHLC 只到 9 月 1 日

- **WHEN** v2 `anchors.daily.current` 為 2026-09-02，而 OHLC progress 的 `through` 為 2026-09-01
- **THEN** publisher MUST 回明確 pending／mixed-session reason並拒絕發布 v3
- **AND** MUST NOT 將 2026-09-02 日量與 2026-09-01 分型／布林證據組合成同一 snapshot

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

### Requirement: v4 選股歷史必須保存至少 130 個官方 OHLCV 交易日

系統 MUST 以 TWSE／TPEx 已核對的官方全市場歷史日報，在 repo 外本機 D1 冪等保存每檔至少最新 130 個完整市場交易日的 open、high、low、close 與 `volume_shares`。實作前 MUST 分市場核對實際成交量欄名、股／張單位、requested date、價格基礎、授權、自動化限制與市場覆蓋；成交量 MUST 為可精確保存的非負整數股數。來源不相容、缺欄、日期錯置、單位不明或非法值 MUST fail closed，不得以成交值、Shioaji Snapshot、Yahoo 或畫面量柱推算。

#### Scenario: 官方 OHLCV 欄位完整

- **WHEN** 某市場日期回應的 OHLC、成交股數、回傳日期與 universe revision 均通過驗證
- **THEN** 系統 MUST 保存 canonical OHLCV、原欄位、成交量單位、mapping version、payload hash 與 fetchedAt

#### Scenario: 只有 OHLC 沒有成交量

- **WHEN** 既有 row 的 OHLC 合法但歷史來源沒有可核對成交量欄位
- **THEN** OHLC MAY 保留，v4 OHLCV coverage MUST 將該商品／日期標為明確缺漏且 OBV 為 unknown，不得把舊 OHLC receipt 視為完整 OHLCV

#### Scenario: 130 日 retention

- **WHEN** 最新官方 session 推進一日
- **THEN** retention MUST 保留最新 130 日、仍被 immutable snapshot 引用的錨點及必要 source evidence，且不得刪除其他產品資料

### Requirement: v4 OHLCV bootstrap 必須有獨立 capability receipt 並可續跑

planner MUST 以 `market + session + sourceMappingVersion + dataCapability=ohlcv-v4` 建立 deterministic targets、cursor 與 checkpoint；舊 60 日 OHLC receipt 可證明已保存的價格，但 MUST NOT 直接完成含成交量的 v4 target。每個市場日期的正式回應 MUST 服務當日全母體，run MUST 具有 fixed request／time budget、single-flight、完整 fetch＋body timeout、冷卻、Retry-After 及有界 retry；中斷、休眠或 rate limit 後只從缺口續跑，不得逐商品無界抓取。

#### Scenario: 既有 60 日升級

- **WHEN** 60 日 OHLC 完整但全部缺 `volume_shares`
- **THEN** planner MUST 安排對應 market／session 的 v4 target 補成交量，再補新增約 70 個 session，不得重建個人清單或 TDCC 歷史佇列

#### Scenario: Budget 到期

- **WHEN** 尚有 v4 targets 但本輪達 request、時間或來源冷卻上限
- **THEN** 系統 MUST 保存 target／processed／remaining／failed／overdue／cursor 及 safe next eligible time，下一輪只續跑未完成 target

#### Scenario: 新上市商品

- **WHEN** 合資格商品上市少於 130 個交易日
- **THEN** 系統 MUST 只保存上市日起可取得的官方 OHLCV，長期指標不足回 `insufficient_history`，不得抓取上市前資料或以其他商品補齊

### Requirement: v4 發布必須以全市場 OHLCV 與日期一致性為 gate

publisher MUST 在 staging 核對 130-session plan、逐市場 receipts、universe 守恆、canonical row coverage、formula／source version 與日期 anchors。只有所有預期 target 已 collected 或為可解釋正式終態、staging row 等於 universe total，且 daily current、technical through 與 `effectiveSessionDate` 完全一致，才能原子發布 v4。部分市場、mixed-session、只含自選清單或使用舊 OHLC receipt 代替 OHLCV 時 MUST 保留最後合法 snapshot。

#### Scenario: 個別商品因停牌缺量

- **WHEN** 全部市場日期批次已正式處理，但個別商品無成交而缺合法 volume
- **THEN** publisher MAY 以明確 unknown row 納入全母體 v4，守恆與逐條件缺漏 MUST 仍成立

#### Scenario: 任一 TPEx 日期未完成

- **WHEN** TWSE 完整但必要 TPEx OHLCV target 仍非正式終態
- **THEN** 系統 MUST NOT 宣告 v4 ready 或發布部分上櫃結果

### Requirement: UI 與 GET 不得觸發 v4 OHLCV 回補

選股 status／results GET、UI 重整、套用均線／背離條件、排序、翻頁與展開 evidence MUST 只讀本機 immutable snapshot。這些動作 MUST NOT 呼叫官方 provider、Shioaji Kbars／Snapshot 作歷史補值、background dispatch、DDL、runtime 管理或交易 API。

#### Scenario: v4 尚在背景準備

- **WHEN** v4 progress 仍有 remaining 且使用者啟用新條件
- **THEN** UI MUST 顯示 preparation pending／coverage，不得由 GET 啟動補資料或回傳舊 v3 rows 冒充 v4 結果

#### Scenario: 重複翻頁

- **WHEN** 使用者在同一 v4 snapshot 重複排序及翻頁
- **THEN** provider、回補、行情訂閱與交易呼叫計數 MUST 維持零

### Requirement: v4 Live 驗收必須覆蓋全市場與指標底稿

完成前 MUST 對本機 D1 執行 integrity、additive schema、130-session plan、TWSE／TPEx 母體、逐日期筆數與成交量單位、unknown reasons、receipt 守恆、snapshot 原子性及 progress 終態核對；並對均線六種模式、六種背離來源、兩方向、zero-reset、missing／insufficient、新商品及未加入清單商品跑 API 全分頁與實際 UI 驗收。

#### Scenario: 宣告 v4 background 完成

- **WHEN** full run 準備宣告完成
- **THEN** target／processed／remaining／failed／overdue MUST 與逐市場 receipts 守恆，remaining／failed／overdue MUST 為零或只有規格明列且已逐筆解釋的正式終態

#### Scenario: 實際 UI 核對訊號

- **WHEN** live API 篩出未加入清單的均線或背離商品並由 UI 點選
- **THEN** 指定日 K 圖 MUST 顯示同商品與可核對日期，結果 evidence MUST 與 D1 重算一致，console 無錯誤且交易與行情連線狀態不變

### Requirement: 日 K snapshot 必須提供近期收盤新高 evidence

選股 OHLCV feature MUST 能對 2–120 個相鄰官方交易日計算目前 close 是否嚴格高於前 N-1 日所有 close。evidence MUST 保存 lookback sessions、目前 close／date、先前最高 close／date、price basis、source mapping version 與 material hash；不得使用盤中 high、調整前後混合價格或圖表 viewport rows。

#### Scenario: 完整 120 日歷史

- **WHEN** 商品有 through `effectiveSessionDate` 的 120 個相鄰 canonical OHLCV sessions
- **THEN** publisher MUST 可建立 2–120 日任一合法 lookback 的新高 feature，且相同 snapshot 重算產生相同 hash

#### Scenario: 停牌或上市歷史不足

- **WHEN** official session plan 中商品合法停牌，或上市後可用 rows 少於 N
- **THEN** feature MUST 回傳 `insufficient_history`、`suspended` 或對應可驗證原因，不得複製前一 close 補滿 N 日

### Requirement: 日 K snapshot 必須提供收盤價突破 SMA evidence

選股 OHLCV feature MUST 對 SMA5、SMA10、SMA20、SMA60 使用與既有指標相同的 reference SMA 公式，保存前一與目前 session 的 close、SMA、session date、period、price basis、formula version 與 evidence hash。只有前一 close 小於或等於前一 SMA 且目前 close 大於目前 SMA時，向上突破才為 pass。

#### Scenario: 收盤價跨越 SMA60

- **WHEN** 連續 OHLCV 足以暖機 SMA60，前一日 close 不高於 SMA60，而目前 close 高於 SMA60
- **THEN** feature MUST 產出向上突破 pass evidence，且不得以 SMA5 穿越 SMA20 的黃金交叉 evidence 代替

#### Scenario: 均線暖機不足

- **WHEN** canonical history 少於 period 或含無法驗證的必要 session
- **THEN** feature MUST 為 unknown 並回報 `indicator_warmup`、`missing_ohlcv` 或 `non_adjacent_sessions`

### Requirement: 新價格 feature 必須綁定既有 130 日完整性責任

近期新高與 SMA feature MUST 只從 v4／後續版本的 130-session canonical OHLCV snapshot 建立，且 through date MUST 等於 snapshot `effectiveSessionDate`。`full_window_complete`、row count、較新圖表 K 棒或單一市場成功 MUST NOT 取代逐商品 continuity 與雙市場 universe coverage 驗證。

#### Scenario: row count 足夠但中間缺一日

- **WHEN** 商品有至少 130 rows，但 official session sequence 中間存在未分類缺口
- **THEN** publisher MUST 拒絕該商品的新高與 SMA current evidence，直到缺口被修復或合法分類
