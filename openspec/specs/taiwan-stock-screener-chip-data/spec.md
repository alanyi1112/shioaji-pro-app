# taiwan-stock-screener-chip-data Specification

## Purpose
TBD - created by archiving change add-chip-filters-to-after-market-stock-screener. Update Purpose after archive.
## Requirements
### Requirement: 全市場籌碼資料必須由官方市場批次報表建立

系統 MUST 以每市場、每交易日一次的官方批次報表取得投信買賣超與融資融券餘額：TWSE 使用已驗證日期的 T86 與 MI_MARGN，TPEx 使用可驗證日期的三大法人與融資融券官方報表。每個 adapter MUST 驗證 report date、必要欄位、單位、duplicate、商品代碼與 payload schema；未知或不完整 schema MUST fail closed。

#### Scenario: 兩市場同日官方報表有效

- **WHEN** TWSE 與 TPEx 的投信及融資融券報表都回傳目標 session、合法 schema 與可對應普通股母體的 rows
- **THEN** collector MUST 建立各自的 verified receipt 與 canonical staging rows，保存來源網址、實際日期、payload hash、row count 與 normalization version

#### Scenario: 官方報表日期不是目標日

- **WHEN** provider HTTP 200 但 report date 與 requested session 不同或無法驗證
- **THEN** receipt MUST 標示 `report_date_mismatch` 或安全 reason code，且不得將 rows 寫成 requested session

### Requirement: 選股籌碼 coverage 必須與需求驅動 cache 分離

全市場籌碼 completion MUST 由 screener 專用 run、receipt、row coverage 與 publication head 證明。`taiwan_stock_chip_daily`、自選清單、圖表 cache、watchlist prewarm、單一商品 API 成功或 53 檔 current rows MUST NOT 作為全市場完成證據；兩者 MAY 共用已測 normalizer，但不得共用 status claim。

#### Scenario: 追蹤商品全部暖機但全市場尚未收集

- **WHEN** 53 檔追蹤商品都有最新日籌碼，而 screener universe 約 1,974 檔尚未取得 exact coverage
- **THEN** 全市場籌碼 run MUST 維持 incomplete，選股 publisher MUST NOT 發布包含籌碼條件的 current snapshot

### Requirement: Canonical 日籌碼列必須保存原始數量與 provenance

每一 `(sessionDate, symbol)` canonical row MUST 保存 market、`investmentTrustBuyShares`、`investmentTrustSellShares`、`investmentTrustNetShares`、`marginYesterdayBalanceLots`、`marginTodayBalanceLots`、`marginBalanceChangeLots`、`shortYesterdayBalanceLots`、`shortTodayBalanceLots`、`shortBalanceChangeLots` 與各 dataset provenance。數量 MUST 是 canonical integer；缺欄 MUST 保持 null 並有 reason，不得以零或 derived estimate 取代官方值。

#### Scenario: 投信淨額與來源總額一致

- **WHEN** 官方 row 同時提供投信買進、賣出與淨額
- **THEN** normalizer MUST 驗證 `buy - sell = net` 後才保存三個欄位，並保留 shares 單位

#### Scenario: 融資欄位部分缺漏

- **WHEN** row 缺少今日融資或融券餘額
- **THEN** canonical row MUST 保留可驗證欄位並將相依條件標記 unknown，不得從買進／賣出流量反推餘額

### Requirement: 全市場歷史必須依官方交易日有界保存

系統 MUST 為每檔普通股保存至少可支援投信 10 日、股價／融資 20 日與目前選股 snapshot 的相鄰交易日資料；scheduler MUST 依 official session plan 有界回補、checkpoint、cooldown 與 retry。休市、上市前、下市後、停牌及來源合法未發布 MUST 分類處理，不得製造 row。

#### Scenario: 回補十個交易日

- **WHEN** 目標 snapshot 需要最近十個交易日投信資料
- **THEN** run MUST 對 TWSE／TPEx 各日期建立 receipt，並以官方 session plan 證明十日相鄰與逐日 coverage

#### Scenario: 新上市商品歷史不足

- **WHEN** 商品上市日落在 lookback window 內且上市前沒有官方 row
- **THEN** 系統 MUST 將相依條件標示 `insufficient_history`，不得將上市前日期算成缺漏或零買超

### Requirement: TDCC 條件只能使用全母體完整的相鄰官方週

publisher MUST 從 verified TDCC rows 選擇不晚於 `effectiveSessionDate`、對目前 screener universe 完整且通過 1–15 級對帳的最新週及所需相鄰週。最新官方 snapshot 若只有追蹤清單 coverage，MUST NOT 取代較早但完整的全市場週期；系統 MUST 明示最新可用完整週與較新 partial 週。

#### Scenario: 最新兩週只有 53 檔

- **WHEN** 2026-09-04 與 2026-09-11 只有 53 檔，而 2026-08-28 對全市場完整
- **THEN** publisher MUST 將 2026-08-28 保持為最新完整週 anchor，並回報較新週 `universe_coverage_pending`，不得把 53 檔結果發布成全市場 current

### Requirement: 籌碼 snapshot 必須與日 K 及母體原子對齊

籌碼 daily through、OHLCV through、universe revision 與 `effectiveSessionDate` MUST 對同一官方交易日；TDCC weekly anchor MUST 不晚於該日。只有 TWSE、TPEx 的 schema、dates、ordinary-stock universe coverage、hash 與所需 lookback 全部通過時，publisher 才可原子推進含籌碼條件的 publication head。

#### Scenario: 一個市場尚未發布

- **WHEN** TWSE 已完成目標日籌碼報表而 TPEx 尚未發布或 coverage 不足
- **THEN** publisher MUST 保留最後合法 snapshot，readiness MUST 顯示逐市場原因，不得發布只有 TWSE 的 current 結果

#### Scenario: 日 K 與籌碼日期不同

- **WHEN** OHLCV through 與 daily chip through 不同
- **THEN** candidate MUST 被拒絕為 mixed session，舊 snapshot rows MUST 停止當期操作並保留原日期

### Requirement: 籌碼資料健康狀態必須顯示逐資料集與逐市場真相

health MUST 分別顯示投信、融資融券、TDCC 的 latest attempt、last verified source date、coverage start／end、target／processed／remaining／failed／overdue、TWSE／TPEx row counts、universe revision 與 publication head。HTTP 200、table 非空、最新單一商品或 scheduler 曾執行 MUST NOT 單獨表示 ready。

#### Scenario: provider 暫時失敗但已有舊資料

- **WHEN** 最新 attempt 失敗而 D1 有較早 verified rows
- **THEN** health MUST 同時顯示 attempt failure 與 last verified coverage，UI MAY 保留舊 snapshot 但 MUST 標示 stale

### Requirement: 選股 GET 路徑不得觸發來源讀寫

`/api/stock-screener/status`、`/api/stock-screener/results`、UI 開啟、重整、排序與翻頁 MUST 只讀 immutable snapshot 及 readiness state，不得直接 fetch TWSE、TPEx、TDCC、FinMind，不得啟動回補、寫 D1、重啟服務或建立行情訂閱。

#### Scenario: 使用者反覆重整選股頁

- **WHEN** 使用者在 provider 尚未發布時反覆重整或提交相同 criteria
- **THEN** provider request count 與 D1 write count MUST 不增加，UI MUST 顯示相同 snapshot／readiness evidence

### Requirement: 新籌碼資料 migration 必須 additive 且可回復

新 tables、columns 與 indexes MUST 以 additive migration 建立；在 live DB 啟用前 MUST 以 staging DB 驗 schema、`PRAGMA integrity_check`、row coverage、material hash 與既有個人資料 hash。失敗 MUST rollback 並保留原 publication head、既有籌碼副圖資料與個人清單。

#### Scenario: migration 或 backfill 驗證失敗

- **WHEN** schema drift、integrity、coverage 或 hash readback 任一 gate 失敗
- **THEN** v5 publication MUST 維持 disabled，原 v4 snapshot 與現有 D1 MUST 保持可用，且不得清空或重建個人 tables

### Requirement: 選股法人 canonical row 必須保存可驗證的外資買進賣出

每一個 `(sessionDate, symbol)` 選股法人 canonical row MUST 保存 `foreignBuyShares`、`foreignSellShares`、`foreignNetShares`、既有投信欄位、market、receipt 與 mapping version。三個外資數量 MUST 為 canonical integer shares，且只有 `buy - sell = net` 通過時才能成為已驗證資料；缺欄、非法格式或相等式不成立 MUST 保持 null 並產生明確 invalid reason。

#### Scenario: TWSE 外資組成完整

- **WHEN** TWSE T86 同一商品的一般外陸資與外資自營商買進、賣出及淨額各自通過驗證
- **THEN** canonical row MUST 保存兩組合計後的外資買進、賣出與淨額，且合計值仍須符合 `buy - sell = net`

#### Scenario: TPEx 歷史法人表完整

- **WHEN** TPEx 指定日期法人歷史表的 report date、表頭、群組位置及外資及陸資合計買進、賣出、淨額均通過驗證
- **THEN** canonical row MUST 保存對應外資三欄，不得維持目前的固定 null

#### Scenario: 官方表頭漂移

- **WHEN** TWSE 或 TPEx 外資必要欄位、群組或單位與已核對 schema 不一致
- **THEN** 該 market／date mapping MUST fail closed，receipt 不得標示新 mapping 已驗證，也不得只保存投信後宣稱外資 coverage 完成

### Requirement: 外資歷史回填必須重新驗證來源而非沿用舊 receipt 宣稱

新外資 mapping 所需的官方歷史日期 MUST 以有界、可續跑的逐市場逐交易日 targets 重新取得並驗證 report date、schema、payload hash、row coverage 與 mapping version。舊 receipt 或 hash MAY 用於確認 payload identity，但 MUST NOT 在沒有重新解析驗證時單獨證明外資欄位可用。

#### Scenario: 重新取得的 payload 與舊 hash 相同

- **WHEN** 新 mapping 重新取得的正式報表 payload hash 與既有 receipt 相同，且外資欄位通過新 schema 與公式驗證
- **THEN** 系統 MAY 連結既有 receipt identity，但 MUST 另存新 mapping verification evidence，不得改寫舊 normalization version 的歷史語意

#### Scenario: 歷史來源暫時無法取得

- **WHEN** 必要 market／date 因 provider unavailable、rate limit 或合法未發布而未完成新 mapping 驗證
- **THEN** backfill MUST 保存 checkpoint、remaining、reason 與安全 next eligible time，v6 publication MUST 維持 pending 且 v5 資料保持可用

### Requirement: 外資全市場 coverage 必須納入 v6 發布 gate

v6 readiness MUST 依 TWSE／TPEx、交易日及 institutional mapping version 回報 target、verified、missing、invalid、failed 與 last verified source date。需求驅動的圖表 cache、自選清單、單一商品資料或只有投信欄位的 row MUST NOT 代替全市場外資 coverage。

#### Scenario: 一個市場缺少外資驗證

- **WHEN** TWSE 的必要外資歷史已完成，但 TPEx 任一必要交易日仍缺新 mapping receipt
- **THEN** v6 snapshot MUST NOT 發布，readiness MUST 指出 TPEx 的日期與 reason，且不得只發布 TWSE 結果

#### Scenario: 官方報表沒有某商品 row

- **WHEN** market／date receipt 合法、完整處理全母體，但官方報表未包含個別普通股
- **THEN** 該商品 MUST 保留在母體並於相依條件回傳 `unknown`，不得縮小 universe 或製造零買賣超
