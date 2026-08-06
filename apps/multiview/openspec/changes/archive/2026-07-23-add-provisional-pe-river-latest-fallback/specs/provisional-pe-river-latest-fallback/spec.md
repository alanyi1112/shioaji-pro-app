## ADDED Requirements

### Requirement: 官方延遲時只能使用 bounded FinMind 暫代尾端

系統 MUST 在 latest lane 先取得 TWSE／TPEx 官方 OpenAPI；只有 FinMind `TaiwanStockPER` 與 `TaiwanStockPrice` 對相同 exchange、canonical symbol 與較新 `sessionDate` 提供有限正數 P/E／close，而官方 `sourceDate` 確實落後時，才能建立 `finmind_provisional_latest`。系統 MUST NOT 呼叫 TWSE／TPEx 一般日期查詢網頁、付費資料或其他未核准來源作為 fallback。

#### Scenario: 官方與 FinMind 日期相同
- **WHEN** 官方 OpenAPI 已包含 FinMind 最新共同交易日
- **THEN** 系統 MUST 使用官方 row 且不得建立相同日期的 provisional row

#### Scenario: FinMind 比官方新一個 completed session
- **WHEN** FinMind 同日 P/E／close 日期晚於官方 `sourceDate`，且該 session 已完成
- **THEN** 系統 MUST 建立明確標示 provider 與 validation status 的 provisional candidate
- **AND** 系統 MUST 保留官方實際 `sourceDate`，不得將 requested date 冒充官方日期

#### Scenario: 官方日期查詢網頁已有較新資料
- **WHEN** TWSE／TPEx 一般日期查詢網頁比免費 OpenAPI 新但沒有可驗證的自動化授權
- **THEN** production runner MUST NOT 呼叫、解析或爬取該網頁
- **AND** 系統 MUST 僅使用經核准的 OpenAPI 與 FinMind 暫代流程

### Requirement: 暫代 candidate 必須同日配對且限制數量與完成時間

系統 MUST 以 `sessionDate` join FinMind P/E 與 close，不得依陣列順序配對；P/E 與 close 必須都是有限正數。單一商品最多只能保留三個晚於官方日期的 provisional completed sessions，Asia/Taipei 當日資料在 18:30 前不得視為 completed session。

#### Scenario: 同日有效 P/E 與 close
- **WHEN** 相同商品、exchange 與 `sessionDate` 的 FinMind P/E／close 都是有限正數
- **THEN** 系統 MUST 計算 `provisionalReferenceEps = close / PER`
- **AND** row MUST 保存實際 provider、source date、fetched timestamp 與 provisional status

#### Scenario: 日期不同或數值無效
- **WHEN** P/E／close 日期不一致，或任一值為空、零、負數或非有限值
- **THEN** 系統 MUST 保留 gap 且不得產生 provisional reference EPS

#### Scenario: 盤中手動執行 latest lane
- **WHEN** workflow 在 Asia/Taipei 18:30 前取得當日 FinMind row
- **THEN** 系統 MUST NOT 將當日 row 寫成 completed provisional session

#### Scenario: 官方延遲超過三個 completed sessions
- **WHEN** FinMind 已有超過三個晚於官方 `sourceDate` 的共同交易日
- **THEN** 系統 MUST 將 provisional tail 限制為最多三個 session 並回報 `provisional_capped`
- **AND** 系統 MUST NOT 自動放寬上限或把其餘日期算入 verified coverage

### Requirement: verified coverage 與 provisional display coverage 必須分離

系統 MUST 分別保存及回傳 `verifiedEnd`、`displayEnd`、`officialSourceDate` 與 `provisionalDates`。`finmind_provisional_latest` MUST NOT 增加 verified sample count、完成 official checkpoint、標示 official fresh 或取代既有 `official_verified` row。

#### Scenario: 新增一個 provisional session
- **WHEN** verified coverage 結束於 D-1 且 D 日 provisional candidate 通過正規化
- **THEN** `verifiedEnd` MUST 保持 D-1，`displayEnd` MUST 可前進至 D
- **AND** `provisionalDates` MUST 明列 D 且來源狀態 MUST 為等待官方核對

#### Scenario: 重跑相同 provisional payload
- **WHEN** scheduler 或 workflow 重複攝取相同商品與日期的 provisional row
- **THEN** D1 MUST 冪等維持單一 row 與相同 coverage 語意
- **AND** job、checkpoint 與 provider budget MUST NOT 因重跑而製造重複完成紀錄

#### Scenario: 晚到 provisional request 遇到官方 row
- **WHEN** 同一 canonical key 已存在 `official_verified` row
- **THEN** 較低信任的 FinMind provisional row MUST NOT 覆蓋或降級官方 row

### Requirement: provisional 尾端不得改變 verified percentile

系統 MUST 只使用截至 `verifiedEnd` 的 verified 有效正 P/E 樣本計算 P10／P30／P50／P70／P90。provisional point 只能使用既有 multiplier 與自身 provisional reference EPS 計算價格座標，不得納入五年分布、252 筆門檻或補齊歷史 gap。

#### Scenario: 加入一個極端 provisional P/E
- **WHEN** 最新 provisional P/E 遠高於既有五年 verified 分布
- **THEN** response 的五個 percentile multiplier MUST 與加入前完全相同
- **AND** 只有該 provisional 日期的五條價格座標能依 provisional reference EPS 延伸

#### Scenario: verified 歷史不足 252 筆
- **WHEN** verified 有效樣本少於 252 筆，即使加入 provisional row 後總數達到 252
- **THEN** 系統 MUST 維持 `insufficient_history` 且不得繪製正式河流

### Requirement: 官方到齊後必須逐項追認並由官方 row 取代

系統 MUST 對相同 exchange、canonical symbol 與 `sessionDate` 的 FinMind provisional row 及官方 row 比較 P/E 與 close；兩項 absolute difference 都不超過 `0.01` 才算來源相符。reference EPS 是核對後重新計算的衍生值，不是第三個獨立核對欄位。

#### Scenario: P/E 與 close 都在容許範圍
- **WHEN** `abs(finmindPe - officialPe) <= 0.01` 且 `abs(finmindClose - officialClose) <= 0.01`
- **THEN** 系統 MUST 以官方 P/E／close 重新計算 reference EPS並原子取代 provisional row 為 `official_verified`
- **AND** 系統 MUST 清除該日 pending、記錄 overlap date 並推進 verified coverage

#### Scenario: 任一數值超過容許範圍
- **WHEN** 官方 P/E／close 有效，但任一 absolute difference 大於 `0.01`
- **THEN** 系統 MUST 以官方 row 取代可見 provisional row並保存 `source_mismatch`
- **AND** 系統 MUST 停用該商品後續 provisional fallback、保留既有 verified 歷史且不得讓 FinMind 覆蓋官方值

#### Scenario: 官方同日明確沒有有效 P/E
- **WHEN** 官方 row 已包含該商品與日期，但 P/E 為空、`-`、零、負數或不可計算
- **THEN** 系統 MUST 移除該日 provisional 可見點並保存官方 gap／安全 reason
- **AND** 系統 MUST NOT 繼續把 FinMind P/E 顯示成有效官方估值

#### Scenario: 官方仍停在前一交易日
- **WHEN** 官方 OpenAPI 尚未提供 provisional 日期
- **THEN** 系統 MUST 保持 pending 且不得宣稱追認成功
- **AND** 後續排程 MUST 依 bounded retry 再次核對

### Requirement: provisional 寫入與追認完成狀態必須原子化

系統 MUST 以 D1 atomic batch 或等價 transaction 同步更新 valuation row、validation／provider state、coverage date 與 job／checkpoint。只有必要寫入全部成功後才能標示 completed；任何較舊或較低信任寫入都不得覆蓋官方 row。

#### Scenario: 追認批次全部成功
- **WHEN** 官方 row、validation state、coverage 與 checkpoint 都成功寫入
- **THEN** job MUST 才能標示 completed，且後續 API MUST 同時看到一致的官方 row 與 verified coverage

#### Scenario: coverage 更新失敗
- **WHEN** valuation row 或其他批次步驟成功但 coverage／state 任一步驟失敗
- **THEN** 系統 MUST NOT 提前保存 completed 狀態
- **AND** 下一次 run MUST 能冪等重試而不遺失 provisional 或官方資料

### Requirement: latest 排程與 health 必須揭示 provisional 狀態

系統 MUST 在每次背景 run 先處理 official latest，再處理 provisional candidate／reconciliation，最後才處理 history lane。health MUST 分開彙總 official fresh、provisional pending、provisional capped、source mismatch、retry waiting、最後官方日期與最後顯示日期，且不得洩漏上游 body 或秘密值。

#### Scenario: 休市或來源日期未前進
- **WHEN** 官方與 FinMind source date 都未前進
- **THEN** runner MUST 只更新安全 heartbeat，不得建立假 row 或假 coverage

#### Scenario: FinMind 暫時限流
- **WHEN** latest request 回傳 402、429、retryable 5xx 或 retry-after
- **THEN** runner MUST 保存 allowlist reason、attempt 與 bounded next retry
- **AND** 已驗證河流、K 線與其他商品 MUST 繼續可用

#### Scenario: 查詢單一商品 health
- **WHEN** 該商品存在一個等待追認的 provisional 日期
- **THEN** health MUST 同時揭示 `verifiedEnd`、`displayEnd`、`officialSourceDate` 與 pending count
- **AND** health MUST NOT 把該商品列為 official fresh

### Requirement: provisional fallback 必須維持既有授權與安全邊界

系統 MUST 維持 private／custom、非商業、來源顯名與不提供 FinMind 原始資料 dump 的既有邊界。provisional API 只能揭示河流顯示所需的單日值、衍生點、coverage、provider 與安全狀態，不得新增秘密、代理 API 或未授權資料介面。

#### Scenario: 未授權呼叫 private ingest
- **WHEN** request 未通過既有 Sites 身分／bypass 與估值 ingest 授權
- **THEN** 系統 MUST fail closed 且不得寫入 provisional 或官方 row
- **AND** response／log MUST NOT 洩漏 secret、cookie、token 或驗證細節

#### Scenario: 正式站不再是 private custom
- **WHEN** 部署準備改為 public、workspace-wide 或商業用途
- **THEN** provisional FinMind fallback MUST 進入 `license_review_required` 並停止發布
