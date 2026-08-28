## ADDED Requirements

### Requirement: 台股日 K 必須依官方交易日證據判定連續性

系統 MUST 對 `.TW` 與 `.TWO` 的 `1d` history，在 requested display window、indicator warmup 與必要 raw buffer 範圍內建立預期交易日集合，並以交易所開市日與商品官方紀錄區分真實缺漏及合法無 candle 日期。系統 MUST NOT 以一般平日規則、插值、前值延伸或零量資料補造日 K。

#### Scenario: 官方證明商品於缺少日期有成交
- **WHEN** history 缺少某個交易所開市日
- **AND** TWSE／TPEx 官方商品日資料包含該日期及合法 OHLCV
- **THEN** 系統 MUST 將該日期分類為 `missing_traded_session`
- **AND** continuity MUST NOT 標示為 `complete`

#### Scenario: 休市日不列為缺口
- **WHEN** 兩根相鄰 candle 之間包含週末、國定休市或天然災害休市日
- **THEN** 不在官方 exchange session set 的日期 MUST NOT 列入 missing session
- **AND** 系統 MUST NOT 為該日期建立 candle

#### Scenario: 商品官方資料明確沒有成交 row
- **WHEN** 某日期為交易所開市日
- **AND** 官方商品資料明確顯示該商品尚未上市、停牌或沒有可用成交 row
- **THEN** 系統 MUST 以可診斷的排除原因保存該日期
- **AND** 系統 MUST NOT 以其他商品、前一交易日或估算值建立 candle

#### Scenario: 官方狀態無法取得
- **WHEN** exchange session 或商品官方資料因連線、HTTP、格式或 runtime 限制而無法安全確認
- **THEN** continuity MUST 為 `unknown` 或 `partial`
- **AND** 系統 MUST 保留既有合法 candles 並使用安全原因碼，不得宣稱 gap-free

### Requirement: 歷史足夠判斷必須包含範圍內連續性

系統 MUST 將 row count、coverage end 與 session continuity 分開判斷。即使總根數已達 required rows 或曾完成 full fetch，只要 requested scope 內存在未排除缺口、expected completed session 未到齊或 continuity evidence 已過期，history MUST NOT 被視為完整。

#### Scenario: 根數足夠但中間缺十個交易日
- **WHEN** `3008.TW` history 的總根數足以支援 requested rows
- **AND** 2026-07-31 與 2026-08-17 之間缺少官方證明有成交的 2026-08-03 至 2026-08-14 共十個交易日
- **THEN** 系統 MUST 偵測十個 `missing_traded_session`
- **AND** MUST NOT 因 row count 足夠、最新日期已到齊或既有 `full_window_complete=1` 回傳 continuity complete

#### Scenario: requested range 向更早日期擴大
- **WHEN** 較大 `display_count` 使 `requiredFrom` 早於既有 `continuity_from`
- **THEN** 系統 MUST 只將已稽核範圍視為有證據
- **AND** 擴大部分 MUST 重新稽核，不得沿用較小範圍的 complete 狀態

#### Scenario: 新交易日完成
- **WHEN** expected completed session 晚於既有 `continuity_through`
- **THEN** 系統 MUST 將新範圍標示為待刷新或待稽核
- **AND** 舊的 complete state MUST NOT 永久阻止尾端更新

### Requirement: 內部缺口必須觸發動態刷新與官方定點修復

系統 MUST 在固定 tail 無法涵蓋最早缺口時動態擴大 Yahoo request；Yahoo 合併後仍缺少且官方證明有成交的日期，系統 MUST 以該官方 row 定點修復並保存實際 provenance。任何上游失敗 MUST 保守保留 partial history，不得假造或自動刪除合法舊資料。

#### Scenario: 固定五日 tail 無法涵蓋舊缺口
- **WHEN** 最早 missing session 早於 Yahoo `5d` tail 可涵蓋範圍
- **THEN** 系統 MUST 選擇足以涵蓋最早缺口的 provider range 或升級為 full fetch
- **AND** MUST NOT 只刷新最新五日後再次將 history 標示 complete

#### Scenario: Yahoo full fetch 補回全部缺口
- **WHEN** 擴大 Yahoo request 回傳全部合法 missing sessions
- **THEN** 系統 MUST 依 time 合併、去重及 upsert rows
- **AND** 重新稽核通過後 continuity 才可標示 complete

#### Scenario: Yahoo 仍缺少官方有成交日期
- **WHEN** Yahoo 擴大刷新後仍缺少某日期
- **AND** 官方商品資料具有同日合法 OHLCV
- **THEN** 系統 MUST 使用官方 row 修復該日期
- **AND** `source`、更新時間與 provenance MUST 反映實際官方來源

#### Scenario: Yahoo 與官方來源均暫時失敗
- **WHEN** history 有可顯示資料但 refresh 與官方確認均失敗
- **THEN** API MUST 保留既有 candles 與 indicators
- **AND** continuity MUST 標示 partial 或 unknown，並公開安全 reason code
- **AND** 系統 MUST NOT 自動重試成多個未受控 request 或清除既有 history

### Requirement: Continuity state 與 cache 必須反映修復後真實狀態

系統 MUST 持久保存有範圍的 continuity status、checked range、missing count、缺漏日期、排除日期、reason code 與 checked time。`full_window_complete` MUST 可因範圍擴大、新缺口或 evidence 過期而回復未完成；history 新增或更正後，相關 payload cache MUST 以 `provider + symbol + interval` 精準失效。

#### Scenario: 舊 full fetch 沒有證明交易日連續
- **WHEN** 舊 state 只有 `full_window_complete=1` 而沒有當次 requested scope 的 continuity evidence
- **THEN** 系統 MUST 將 continuity 視為 unknown 並執行稽核
- **AND** MUST NOT 以舊 flag 跳過缺口檢查

#### Scenario: 修復新增 candle
- **WHEN** Yahoo 或官方修復新增至少一根 candle
- **THEN** 系統 MUST 更新 history 與 continuity state
- **AND** MUST 失效相同 provider、symbol、interval 的 Worker memory 與 D1 candle payload cache
- **AND** 本次 response MUST 使用修復後 canonical history

#### Scenario: Cache 失效寫入失敗
- **WHEN** history 已成功修復但持久化 payload cache 失效失敗
- **THEN** 本次 API MUST 仍回傳修復後資料
- **AND** cache metadata MUST 使用安全 reason code 標示失敗
- **AND** MUST NOT 回退到已知缺漏的舊 payload

### Requirement: API 與前端必須公開有界的連續性診斷

`/api/candles` MUST 以向後相容欄位公開 `complete`、`partial` 或 `unknown` continuity、稽核起訖、verified through、missing count 與有上限的 missing／excluded session dates。前端 MUST 在目前可視範圍存在已確認缺口時顯示資料不完整提示，且 MUST NOT 將 partial 或 unknown 呈現為完整。

#### Scenario: 回應為 gap-free
- **WHEN** requested scope 內所有預期交易日都有合法 candle 或官方證明的排除原因
- **THEN** `dataQuality` 或 `dataWindow` MUST 回傳 continuity complete 與 checked range
- **AND** missing count MUST 為零

#### Scenario: 可視範圍有已確認缺口
- **WHEN** display candles 範圍內存在 `missing_traded_session`
- **THEN** API MUST 回傳缺口數量與有界日期清單
- **AND** panel MUST 顯示中性的「日 K 資料不完整」或同等提示
- **AND** 主圖、指標與副圖 MUST NOT 以連線或補值跨越缺口造成偽造資料點

#### Scenario: 舊前端忽略新增欄位
- **WHEN** client 不讀取新增 continuity metadata
- **THEN** 既有 candles、indicators、quote 與 dataWindow 欄位 MUST 維持相容
- **AND** API MUST NOT 因新增 metadata 改變既有成功 HTTP response 的基本結構

### Requirement: 啟用商品必須具有逐商品稽核與驗收證據

系統 MUST 提供有界的逐商品 continuity 稽核摘要，至少包含 symbol、coverage end、continuity status、missing count、verified through 與 last checked。全域 D1 schema、migration 或 health 成功 MUST NOT 取代每個啟用商品的資料證據。

#### Scenario: 批次稽核啟用台股商品
- **WHEN** 維護流程稽核目前使用者啟用的 `.TW` 與 `.TWO` 商品
- **THEN** 系統 MUST 以有限 concurrency、每輪上限、cache 與 single-flight 執行
- **AND** 摘要 MUST 分開計算 complete、partial、unknown 與尚未稽核商品

#### Scenario: 大立光回歸驗收
- **WHEN** fixture 或測試 D1 重現 `3008.TW` 2026-07-31 直接跳到 2026-08-17 且總根數仍足夠
- **THEN** 自動測試 MUST 先證明缺少十個官方交易日，再證明修復後日期連續且 OHLC 合法
- **AND** 實際 MultiView browser 驗收 MUST 確認大立光 panel 已載入、日期無該段跳空、canvas 尺寸有效且 console 無新增錯誤

#### Scenario: 完整品質 gate
- **WHEN** 本變更準備完成
- **THEN** migration、unit、Worker integration、D1 逐商品稽核、cache invalidation 與 browser acceptance MUST 通過
- **AND** `npm run lint`、`npm test` 與 `openspec validate --all --strict` MUST 通過
