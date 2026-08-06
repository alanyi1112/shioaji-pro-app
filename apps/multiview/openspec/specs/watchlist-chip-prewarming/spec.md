# watchlist-chip-prewarming Specification

## Purpose
TBD - created by archiving change prewarm-watchlist-taiwan-chip-data. Update Purpose after archive.
## Requirements
### Requirement: 我的清單台股會自動建立籌碼預熱目標

系統 MUST 從系統預設台股清單與所有使用者已啟用的清單項目，動態找出符合 eligibility 的 TWSE／TPEx 普通股及 ETF，並以全站去重 symbol 建立日籌碼預熱與 TDCC 歷史回補目標；workflow MUST NOT 固定寫死 symbol，也 MUST NOT 擴張成未加入網站的既有全市場掃描。日資料預熱成功不得取代 TDCC 最低 51 週歷史完成判定。互動式清單儲存 MUST 只在背景註冊本次合格 symbol，MUST NOT 在 API response 前重建完整 target 集合。

#### Scenario: 使用者新增合格普通股或 ETF
- **WHEN** 使用者將尚未完整快取籌碼資料的合格台股加入「我的清單」
- **THEN** 系統 MUST 在 Worker background lifetime 冪等建立或更新該 symbol 的日籌碼預熱與 TDCC 背景回補目標
- **AND** 儲存 API MUST NOT 等待完整 target reconciliation，下一次 durable scheduler MUST 再次檢查並補齊未完成資料

#### Scenario: 日資料成功但 TDCC 仍不足
- **WHEN** 法人、外資持股、融資券及借券預熱成功，但 TDCC 只有 1 至 50 週
- **THEN** health MUST 分別反映日資料 ready 與 TDCC queued／partial
- **AND** runner MUST 仍可 claim 該 symbol，不得因日資料完成而略過 TDCC 歷史

#### Scenario: 相同台股出現在多個清單
- **WHEN** 同一 symbol 被多個使用者或多個頁籤加入
- **THEN** 背景預熱 MUST 只保留一個全站資料目標
- **AND** D1 資料 MUST 供所有相同 symbol 的圖表共用

#### Scenario: 非合格商品或已停用商品
- **WHEN** 清單項目不是支援的台股普通股／ETF，或已被停用且不再屬於其他有效目標
- **THEN** 系統 MUST NOT 建立新的籌碼預熱工作
- **AND** 既有已驗證資料 MAY 保留供診斷與快取使用，完整背景 discovery MUST 在下一週期停用孤兒 target

### Requirement: 新增清單商品後立即背景預熱

成功保存清單商品的請求 MUST 在不阻塞使用者操作的情況下，以 Worker background lifetime 註冊該 symbol 的 target 並預熱最近兩年的法人、外資持股、融資券及借券資料；立即工作失敗或未完成 MUST 由 durable scheduler 接手。Foreground MUST NOT 掃描完整官方商品目錄、所有使用者商品或所有既有 targets。

#### Scenario: 新增台股 API 快速完成
- **WHEN** 使用者新增一檔合格台股而免費來源、target 註冊或 D1 background work 回應較慢
- **THEN** 儲存清單 API MUST 在單筆清單持久化與 canonical response 完成後先成功回應
- **AND** 單一 target 註冊與籌碼下載 MUST 在 `waitUntil` 背景工作執行

#### Scenario: Foreground 工作邊界
- **WHEN** `POST /api/instruments` 保存一個商品
- **THEN** response 前 MUST NOT 呼叫完整 TDCC target reconciliation
- **AND** MUST NOT 因 active target、官方 catalog 或其他使用者清單數量增加而線性增加 foreground target queries

#### Scenario: 立即背景工作中斷
- **WHEN** Worker background lifetime 結束前仍有 dataset 未完成
- **THEN** 已保存的使用者清單與 fetch-state MUST 保留已成功資料及未完成狀態
- **AND** 下一次 GitHub Actions MUST 從 durable 清單來源將該 symbol 排入 discovery 或 stale／missing targets

### Requirement: 排程補齊所有缺漏或過期日籌碼

durable scheduler MUST 每日於 TDCC 最新週快照之後，取得有限批次的 missing／stale 清單 symbol，逐 symbol 補齊最近兩年日籌碼；同一 symbol／dataset／日期重跑 MUST 冪等，且開圖請求 MUST NOT 是背景補齊的必要觸發。

#### Scenario: 網站沒有圖表流量
- **WHEN** 清單台股存在缺漏或過期籌碼且沒有人開啟線圖
- **THEN** scheduled workflow MUST 仍呼叫背景預熱並更新 D1
- **AND** 最近成功時間與 coverage MUST 可由 health 查證

#### Scenario: 單一 symbol 來源失敗
- **WHEN** 某一 symbol 或 dataset 遇到 timeout、429、來源失敗或沒有發布紀錄
- **THEN** 系統 MUST 保存安全狀態及 retry-after，並保留舊資料
- **AND** 其他 symbol／dataset MUST 繼續處理

#### Scenario: 已完整且新鮮的目標
- **WHEN** fetch-state 顯示最近兩年 coverage 完整且仍在新鮮期限內
- **THEN** target discovery MUST 暫時略過該 symbol
- **AND** MUST NOT 為相同範圍建立不必要的上游請求

### Requirement: 籌碼預熱健康狀態不外洩秘密

系統 MUST 安全回報預熱 scheduler、target、ready、pending、最近成功時間與 allowlist 錯誤原因；GitHub／Sites secrets、上游完整 response、內部授權 header 與使用者身分清單 MUST NOT 出現在 repository、log 或 API response。

#### Scenario: 預熱正常運作
- **WHEN** 最近一個排程週期完成至少一個清單台股預熱且 scheduler heartbeat 未過期
- **THEN** `/api/health` MUST 顯示最新 ready／pending 計數及最近成功時間
- **AND** MUST NOT 回傳個別使用者或秘密資料

#### Scenario: scheduler 過期或來源限流
- **WHEN** scheduler heartbeat 過期，或多個 targets 正在等待 retry-after
- **THEN** health MUST 顯示 `scheduler_stale`、`rate_limited` 或同等安全狀態
- **AND** 前端仍 MUST 可讀取 D1 最近成功資料

### Requirement: 預熱 ready 必須以實際 coverage 判定

日籌碼預熱 health 與 target discovery MUST 依 fetch-state 的實際資料 coverage 判定 ready／pending；成功請求時間、請求結束日或非空歷史 rows 本身 MUST NOT 取代實際 `coverage_end`。

#### Scenario: 排程成功但來源最新日落後
- **WHEN** scheduler 成功完成請求，但任一必要日 dataset 的實際 `coverage_end` 早於本次預熱 window end
- **THEN** 該 symbol MUST 計入 `pendingSymbols` 而非 `readySymbols`
- **AND** health MUST NOT 僅因 `lastSuccessAt` 新鮮而顯示該 symbol ready

#### Scenario: 官方 fallback 補齊當日資料
- **WHEN** 背景工作以官方 fallback 成功保存 window end 的當日 row，且其他必要 datasets 也完整新鮮
- **THEN** 該 symbol MUST 計入 `readySymbols`
- **AND** 後續 discovery MUST 在 freshness 有效期間略過該完整 symbol
