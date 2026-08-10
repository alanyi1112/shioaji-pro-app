## MODIFIED Requirements

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
