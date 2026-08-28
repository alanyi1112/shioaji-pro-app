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

### Requirement: 新增商品日籌碼必須立即預熱

符合資格的台股商品新增或重新啟用後，系統 MUST 透過請求生命週期外的背景工作立即預熱日籌碼資料；MUST NOT 等待每日 cron 才開始第一次回補。TDCC 週資料 MUST 同時進入其獨立 queue／workflow，但不得因此延後日籌碼預熱。

#### Scenario: 儲存新的台股商品
- **WHEN** 商品儲存成功且包含符合資格的台股 symbol
- **THEN** Worker MUST 立即啟動該 symbol 的日籌碼預熱
- **AND** MUST 同時註冊並排入 TDCC 回補，兩條路徑可獨立成功或重試

#### Scenario: 新增台股 API 快速完成
- **WHEN** 使用者新增一檔合格台股而免費來源、target 註冊或 D1 background work 回應較慢
- **THEN** 儲存清單 API MUST 在單筆清單持久化與 canonical response 完成後先成功回應
- **AND** 單一 target 註冊與籌碼下載 MUST 在 `waitUntil` 背景工作執行

#### Scenario: Foreground 工作邊界
- **WHEN** `POST /api/instruments` 保存一個商品
- **THEN** response 前 MUST NOT 呼叫完整 TDCC target reconciliation
- **AND** MUST NOT 因 active target、官方 catalog 或其他使用者清單數量增加而線性增加 foreground target queries

#### Scenario: 任一立即回補來源失敗
- **WHEN** 日籌碼來源、TDCC queue 或 workflow dispatch 任一暫時失敗
- **THEN** 商品儲存 MUST 維持成功且不得刪除既有資料
- **AND** durable scheduler MUST 能在後續排程接續未完成工作

### Requirement: 排程補齊所有缺漏或過期日籌碼

部署於 Sites Worker 的 durable orchestrator MUST 每日於 TDCC 最新週快照之後，取得有限批次的 missing／stale 清單 symbol，逐 symbol 補齊最近兩年日籌碼；同一 symbol／dataset／日期重跑 MUST 冪等，且開圖請求 MUST NOT 是背景補齊的必要觸發。單輪目標超過安全批次時 MUST 以 D1 進度與後續 tick 續跑，不得因固定上限永久略過後段 symbol；同一輪最近嘗試過的 symbol MUST 進入有限冷卻，讓其他到期目標可被公平處理。

#### Scenario: 網站沒有圖表流量
- **WHEN** 清單台股存在缺漏或過期籌碼且沒有人開啟線圖
- **THEN** scheduled event 或受保護外部 tick MUST 仍喚醒 Sites Worker 背景預熱並更新 D1
- **AND** 最近成功時間、coverage 與 orchestrator 進度 MUST 可由 health 查證

#### Scenario: 單一 symbol 來源失敗
- **WHEN** 某一 symbol 或 dataset 遇到 timeout、429、來源失敗或沒有發布紀錄
- **THEN** 系統 MUST 保存安全狀態及 retry-after，並保留舊資料
- **AND** 該 symbol MUST 進入有限冷卻，讓其他 symbol／dataset 繼續處理

#### Scenario: 已完整且新鮮的目標
- **WHEN** fetch-state 顯示最近兩年 coverage 完整且仍在新鮮期限內
- **THEN** target discovery MUST 暫時略過該 symbol
- **AND** MUST NOT 為相同範圍建立不必要的上游請求

#### Scenario: 單輪超過原本固定上限
- **WHEN** 到期清單 symbol 超過 40 檔或任一單次 tick 批次
- **THEN** orchestrator MUST 記錄剩餘 due 並由後續 tick 繼續
- **AND** 本輪完成判定 MUST 以沒有可處理 due symbol 為準，不得只以第一批完成為準

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

日籌碼預熱 health 與 target discovery MUST 依 fetch-state 的實際資料 coverage 判定 ready／pending；成功請求時間、請求結束日或非空歷史 rows 本身 MUST NOT 取代實際 `coverage_end`。預熱 window end MUST 使用 Asia/Taipei 最近已完成交易日：週末回退至週五，平日資料發布安全截止時間前回退至前一平日；該預期日期 MUST NOT 被寫成官方 `sourceDate`。

#### Scenario: 排程成功但來源最新日落後
- **WHEN** scheduler 成功完成請求，但任一必要日 dataset 的實際 `coverage_end` 早於最近已完成交易日
- **THEN** 該 symbol MUST 計入 `pendingSymbols` 而非 `readySymbols`
- **AND** health MUST NOT 僅因 `lastSuccessAt` 新鮮而顯示該 symbol ready

#### Scenario: 官方 fallback 補齊預期交易日
- **WHEN** 背景工作以官方 fallback 成功保存最近已完成交易日的 row，且其他必要 datasets 也完整新鮮
- **THEN** 該 symbol MUST 計入 `readySymbols`
- **AND** 後續 discovery MUST 在 freshness 有效期間略過該完整 symbol

#### Scenario: 週末執行
- **WHEN** orchestrator 於 Asia/Taipei 週六或週日執行
- **THEN** window end MUST 使用最近週五而非週末日期
- **AND** 已涵蓋該週五且新鮮的 symbol MUST NOT 因不存在的週末資料被誤列 pending

### Requirement: 日籌碼健康狀態必須使用自身 orchestrator 紀錄

watchlist 日籌碼預熱 health MUST 使用最近的 `daily` 或相容 `combined` chip backfill orchestrator heartbeat、status 與 safe reason；MUST NOT 使用 TDCC continuous run 的 heartbeat 代表日籌碼排程狀態。預熱完成條件 MUST 使用正式來源可持續提供且足以涵蓋圖表需求的最近一年資料，不得要求來源無法穩定提供的兩年範圍而讓所有目標永久 pending。

#### Scenario: 日籌碼成功但 TDCC scheduler 過期
- **WHEN** 最近 daily orchestrator 已成功更新，而 TDCC continuous scheduler heartbeat 已過期
- **THEN** watchlist prewarming health MUST 依 daily orchestrator 顯示目前狀態
- **AND** TDCC health MUST 獨立顯示 `scheduler_stale`，兩者不得互相覆蓋

#### Scenario: Daily orchestrator 失敗
- **WHEN** 最近 daily orchestrator run 為 failed 且帶有 allowlist reason
- **THEN** health MUST 顯示日籌碼失敗或 degraded 狀態及安全 reason
- **AND** MUST 保留各資料集最新實際 source date 供判讀

#### Scenario: 新商品已具一年日資料
- **WHEN** 新商品四種日籌碼資料均已涵蓋最近一年且最新 source date 到達 expected session
- **THEN** health MUST 將該商品計為 ready
- **AND** MUST NOT 因缺少一年以前資料而每天重新排入 due queue

### Requirement: 新商品籌碼預熱必須揭示各資料路徑的交接結果

合格台股商品保存成功後，系統 MUST 分開追蹤日籌碼預熱與 TDCC 歷史回補的 target、queue、handoff 及完成狀態；任一路徑成功 MUST NOT 掩蓋另一條路徑尚未接手、coverage 不足或失敗。互動式保存 MUST 維持快速回應，但背景工作結果 MUST 可由逐 symbol API 與安全 health 查證。

#### Scenario: 日籌碼完成但 TDCC 只有最新一週
- **WHEN** 新商品的法人、外資持股、融資券與借券已預熱，但 TDCC 只有最新一筆分布資料
- **THEN** 日籌碼 MAY 顯示 ready，TDCC MUST 保持 queued／partial 並顯示其 handoff 狀態
- **AND** 系統 MUST NOT 將整體商品或持股副圖標示為歷史完整

#### Scenario: 保存後背景生命週期提前結束
- **WHEN** 商品保存 response 已成功，但 request background lifetime 在 target、queue 或 dispatch 全部完成前終止
- **THEN** durable discovery／watcher MUST 依使用者已啟用商品重新建立缺少的 TDCC target 或 queue
- **AND** 不得要求使用者移除重加、重新部署或開啟持股副圖才能恢復

#### Scenario: 新商品 handoff 超過門檻
- **WHEN** target 已 queued 超過 deployment 規定的接手門檻且沒有新鮮 run／lease
- **THEN** health MUST 將該 symbol 計入 handoff overdue 或同等 degraded 計數
- **AND** 必須保留 queued-since、最後 dispatch 結果與安全 reason，不能只顯示全域 scheduler healthy

#### Scenario: 相同商品由多個清單加入
- **WHEN** 同一 canonical symbol 已有 target／queue，之後由另一頁籤或使用者再次加入
- **THEN** 系統 MUST 共用相同市場資料、日期計畫與 single-flight handoff
- **AND** MUST NOT 建立依使用者身分分裂的 TDCC 歷史副本或重複 runner

