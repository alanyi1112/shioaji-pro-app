## ADDED Requirements

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
