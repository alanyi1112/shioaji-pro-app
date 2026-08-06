## ADDED Requirements

### Requirement: K 線歷史必須以穩定 key 快取並共用
系統 MUST 以 `provider + symbol + interval` 作為 K 線歷史 key，不得將 `display_count` 納入歷史身分；不同 display window MUST 從同一份已合併歷史裁切回應。

#### Scenario: 不同 display window 共用歷史
- **WHEN** 相同 provider、symbol 與 interval 依序請求 160 根與 320 根 display candles
- **THEN** 系統 MUST 以同一份 history 判斷資料是否足夠
- **AND** 系統 MUST NOT 因 `display_count` 不同建立互不相干的逐 K 棒歷史

#### Scenario: 不同 interval 不混用
- **WHEN** 同一 symbol 分別請求 `1d` 與 `1wk`
- **THEN** 系統 MUST 使用不同 history key
- **AND** 任一 interval 的 candle MUST NOT 出現在另一 interval 的回應

#### Scenario: 不同 provider 不混用
- **WHEN** 相同 symbol 由不同 provider 提供不同資料語意
- **THEN** 系統 MUST 將 provider 納入 history key
- **AND** 系統 MUST NOT 只以 symbol 判斷快取命中

### Requirement: 同 key 上游刷新必須 single-flight
系統 MUST 在同一 Worker instance 內合併相同 `provider + symbol + interval` 的進行中上游刷新，讓一般載入、歷史補載、多 panel 與背景預取共用結果；不同 key MUST 可獨立處理。

#### Scenario: 多個 panel 同時請求同一商品
- **WHEN** 多個 panel 同時要求相同 history key，且資料需要向上游刷新
- **THEN** Worker MUST 只啟動一個該 key 的上游工作
- **AND** 所有 caller MUST 使用該工作合併後的 history 依各自 display window 產生回應

#### Scenario: 同 key 不同 display window 同時請求
- **WHEN** 160 根與 320 根請求同時發生且共用相同 history key
- **THEN** 系統 MUST 協調成一個可滿足當次最大 required rows 的刷新流程，或讓較小工作完成後只補真正不足範圍
- **AND** 系統 MUST NOT 同時下載兩份相同上游資料窗

#### Scenario: 不同商品可並行
- **WHEN** 多個 panel 請求不同 history key
- **THEN** 系統 MUST 允許不同 key 並行取得資料
- **AND** 一個 key 的刷新 MUST NOT 在不必要的時間內阻塞其他 key

### Requirement: D1 必須保存正規化日週月 K 線歷史
系統 MUST 使用 D1 `candle_history` 保存 yfinance `1d`、`1wk`、`1mo` K 線，並以 `provider + symbol + interval + time` 唯一識別一根 candle；其他 interval MUST 維持短期快取與上游流程，不得未經 retention 設計無限制寫入 D1。

#### Scenario: Migration 建立唯一 candle row
- **WHEN** `candle_history` migration 套用
- **THEN** table MUST 能保存 provider、symbol、interval、time、open、high、low、close、volume、quote_time、source、source_updated_at 與 fetched_at
- **AND** 同一 `provider + symbol + interval + time` MUST 只能存在一筆 row

#### Scenario: 日週月 K 跨部署重用
- **WHEN** Worker restart、redeploy 或 isolate 更換後收到已保存 yfinance `1d`、`1wk` 或 `1mo` history 的請求
- **THEN** 系統 MUST 先查詢 D1 history
- **AND** D1 資料足夠且仍符合刷新規則時 MUST 不重新下載整段歷史

#### Scenario: 分鐘 K 不永久累積
- **WHEN** `/api/candles` 處理非 `1d`、`1wk`、`1mo` interval
- **THEN** 系統 MUST 不因本變更將該 interval 無限制寫入 `candle_history`
- **AND** 既有短期快取、single-flight 與 provider 流程 MUST 繼續運作

### Requirement: D1-first 流程必須只補不足或需更新資料
系統 MUST 先以 D1 或已載入 history 判斷 requested display window、warmup 與台股 raw buffer 是否足夠，再決定是否呼叫上游；provider 無法精準指定缺口時，系統 MUST 使用其支援的最小合理範圍並保存合併結果。

#### Scenario: D1 已有足夠歷史
- **WHEN** D1 已保存足以支援 requested display window、warmup 與必要 raw buffer 的資料
- **AND** 該 key 尚未到 interval refresh 時點
- **THEN** API MUST 直接使用 D1 history 產生 payload
- **AND** API MUST NOT 重新下載相同資料窗

#### Scenario: D1 只有部分歷史
- **WHEN** D1 rows 不足以支援 requested display window 與 warmup
- **THEN** 系統 MUST 以既有 rows 為合併基礎
- **AND** 系統 MUST 向上游取得缺漏區間或 provider 可提供的最小合理歷史範圍
- **AND** 成功結果 MUST 寫回 D1 後再裁切回應

#### Scenario: 已到達 provider 最早邊界
- **WHEN** D1 與上游合併後仍無法增加更早 candle
- **THEN** `dataWindow.hasMoreBefore` MUST 表示沒有更多更早資料
- **AND** 前端 MUST 能停止在相同邊界重複補載

### Requirement: Candle 必須依 time 合併去重並允許尾端修正
系統 MUST 將 D1、記憶體與上游 rows 依 candle `time` 合併，較新的合法 row MUST 覆蓋同 time 舊 row，合併結果 MUST 依 time 遞增排序並以受控 batch upsert。

#### Scenario: 重疊資料窗不產生重複 candle
- **WHEN** D1 history 與上游回應包含重疊 candle time
- **THEN** 合併結果與 `/api/candles` display candles MUST 每個 time 只出現一次
- **AND** candle list MUST 依 time 遞增排序

#### Scenario: 收盤後修正盤中暫時 K 棒
- **WHEN** D1 已保存某交易日 candle
- **AND** 上游稍後回傳相同 time 的較新 OHLCV、quote time 或來源更新時間
- **THEN** 系統 MUST 以新 row 覆蓋舊 row並更新 fetched metadata
- **AND** 後續 API MUST 回傳修正後 candle

#### Scenario: 大量 rows 分批寫入
- **WHEN** 系統需要將多根 candle 寫入 D1
- **THEN** 系統 MUST 使用有上限的 batch upsert
- **AND** 單一 request MUST NOT 因無限制 SQL statements 超出 D1 限制

### Requirement: 快取刷新與失敗必須保守標示
系統 MUST 依 interval 使用不同 freshness／refresh 規則；持久化資料足夠不得永久阻止最新尾端刷新，D1 hit 也不得自動等同報價 fresh 或 verified。

#### Scenario: History 仍新鮮且足夠
- **WHEN** history 在該 interval 的有效期限內且 rows 足夠
- **THEN** 系統 MUST 可直接使用快取產生回應
- **AND** cache metadata MUST 表示 `hit` 或等效狀態

#### Scenario: History 已過期但尾端刷新成功
- **WHEN** 持久化 rows 足夠但已到刷新時點
- **THEN** 系統 MUST 取得至少能更新最新尾端的上游資料
- **AND** 合併與 upsert 完成後 metadata MUST 表示 `refreshed` 或等效狀態

#### Scenario: 上游失敗但仍有舊 history
- **WHEN** refresh 或 backfill 失敗且 D1 或既有 history 仍有可顯示資料
- **THEN** API MUST 保留既有 candle 與 indicators
- **AND** quote freshness 或 cache metadata MUST 明確標示 stale
- **AND** response MUST NOT 包含秘密或完整上游錯誤

#### Scenario: Yahoo-backed 商品完全沒有可用資料
- **WHEN** Yahoo-backed 商品的 D1、記憶體與上游都無法提供合法 candle
- **THEN** API MUST 維持既有安全錯誤 response 與 HTTP status
- **AND** 系統 MUST NOT 以 sample candle 冒充該 Yahoo-backed 商品的真實市場資料
- **AND** Hyperliquid 既有 sample fallback 不在本變更範圍內

### Requirement: 合併後資料必須維持 warmup、正規化與時間對齊
系統 MUST 先合併歷史、再執行台股日 K 無成交占位正規化，使用完整合法 rows 計算 indicators，最後將 candles 與所有 indicator series 裁切至相同 display time set。

#### Scenario: 台股 D1 history 含占位 candle
- **WHEN** D1 或上游 rows 含符合既有規則的台股無成交占位日 K
- **THEN** 系統 MUST 在 quote、indicators 與 display candles 使用前排除該 row
- **AND** `dataQuality.ignoredSessionDates` MUST 保留被排除日期

#### Scenario: 較大 display window 保留 warmup
- **WHEN** client 以較大的 `display_count` 請求歷史
- **THEN** 系統 MUST 額外取得或保留指標所需 warmup rows
- **AND** `dataWindow.availableWarmupCandles` 與 `insufficientWarmup` MUST 反映合併後實際資料
- **AND** 系統 MUST NOT 為不足區間假造 candle 或 indicator value

#### Scenario: Candle 與指標時間集合一致
- **WHEN** API 以 D1、上游或兩者合併結果產生 payload
- **THEN** 每個非空 indicator series 的最後 time MUST 等於最後一根 display candle time
- **AND** indicator series MUST 不包含早於第一根 display candle 的 time
- **AND** `dataWindow.displayFrom` 與 `displayTo` MUST 對應回傳 candles 起訖 time

### Requirement: Cache metadata 與既有 API 必須向後相容
系統 MUST 保留 `/api/candles` 既有 candles、indicators、quote、quoteTime、dataQuality 與 dataWindow 結構，並在 `dataWindow.cache` 或相容欄位提供不含秘密的 history persistence 診斷。

#### Scenario: 回應說明 D1 lifecycle
- **WHEN** API 使用或嘗試使用 D1 candle history
- **THEN** metadata MUST 能區分 hit、miss、backfilled、refreshed、stale、disabled 或 write failed 等實際狀態
- **AND** metadata MUST 能辨識資料來源、是否使用持久化與實際可用 rows

#### Scenario: 前端忽略新增 metadata
- **WHEN** 既有前端不讀取新增 persistence metadata
- **THEN** 初次載入、歷史補載、指標、最新價與 quote verification MUST 維持既有行為

#### Scenario: D1 寫入失敗
- **WHEN** 上游成功回傳合法 candle 但 D1 upsert 失敗
- **THEN** API MUST 仍可使用合法上游資料產生成功 payload
- **AND** metadata MUST 以安全 reason code 標示 write failure

### Requirement: K 線歷史 parity 必須通過自動與正式站驗收
系統 MUST 在 migration、unit、Worker integration、concurrency、strict OpenSpec、build 與 browser history acceptance 通過後才部署，並以正式 Sites 驗證較大 display window、D1 重用與可視範圍保持。

#### Scenario: 自動測試涵蓋核心資料契約
- **WHEN** 本變更完成實作
- **THEN** 測試 MUST 涵蓋 migration schema、merge 去重、尾端覆蓋、D1 hit／miss／backfill、interval policy、single-flight、stale fallback、warmup 與台股占位正規化
- **AND** `npm run lint`、`npm test` 與 `openspec validate --all --strict` MUST 通過

#### Scenario: Browser 歷史縮放驗收
- **WHEN** browser runner 在一圖模式向左縮放或平移至資料邊界
- **THEN** candle 數 MUST 增加或 API 明確表示沒有更多歷史
- **AND** 成功補載時原 visible logical range MUST 依新增 candle 數平移並保持同一批可視 K 棒
- **AND** 主副圖對齊、已選 indicators、overlay 與 console MUST 無回歸

#### Scenario: 正式 Sites D1 重用驗收
- **WHEN** 正式站先請求預設 display window，再請求相同 key 的較大 window，並重複相同請求
- **THEN** API MUST 回傳相容 payload 與可診斷的 cache lifecycle
- **AND** 重複請求 MUST 使用 D1 或已合併 history，避免重新下載相同完整資料窗
