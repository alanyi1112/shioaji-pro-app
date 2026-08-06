# manual-chip-backfill Specification

## Purpose
TBD - created by archiving change wrap-chip-readouts-and-request-backfill. Update Purpose after archive.
## Requirements
### Requirement: 已登入使用者可要求單一商品補齊缺少籌碼

系統 MUST 提供 `POST /api/taiwan-stock-chip/backfill`，讓已登入使用者只對目前一個 eligibility 合格的 TWSE／TPEx 普通股或 ETF 要求補齊 allowlist datasets。Worker MUST 重新驗證 symbol、dataset、日 K 日期範圍與使用者身分，MUST NOT 信任前端宣稱的 coverage 或接受任意上游 URL。

#### Scenario: 合法缺資料商品提出回補
- **WHEN** 已登入使用者對一檔合格台股送出 canonical symbol、支援 datasets 與合法日期範圍
- **THEN** API MUST 重新檢查 eligibility 與 D1 coverage，並只接受仍缺少或過期的資料族群
- **AND** response MUST 回傳可安全顯示的 accepted、queued、already-running、complete、cooldown、retry-waiting 或 blocked 狀態

#### Scenario: 未登入或不合格請求
- **WHEN** 正式站請求沒有平台 authenticated-user header，或 symbol／dataset／日期範圍不符合 allowlist
- **THEN** API MUST 拒絕請求且不得建立背景工作
- **AND** MUST NOT 回傳 secrets、內部 URL、完整上游 response 或其他使用者資料

### Requirement: 日籌碼立即以 Worker 背景工作補齊

法人、外資持股、融資券及借券資料的合法回補要求 MUST 使用既有 D1-first service、single-flight、fetch-state 與 `context.waitUntil` 執行，API response MUST NOT 等待所有上游下載完成。已成功資料 MUST 保留，失敗資料 MUST 由既有 durable scheduler 接手。

#### Scenario: 日資料 coverage 不完整
- **WHEN** API 確認目前 symbol 的一個或多個日資料 datasets 未涵蓋要求範圍且不在 retry-after
- **THEN** API MUST 回傳 accepted 並在 `waitUntil` 只預熱缺少 datasets
- **AND** 相同 symbol／dataset／range 的同時請求 MUST 共用既有 single-flight 並冪等寫入 D1

#### Scenario: 日資料完整或等待重試
- **WHEN** 日資料 coverage 已完整且新鮮，或來源的 `retry_after` 尚未到期
- **THEN** API MUST 以 complete 或 retry-waiting 安全 no-op
- **AND** MUST NOT 因使用者 click 繞過 retry-after 或建立不必要的上游請求

### Requirement: TDCC 歷史回補透過受保護 dispatch 立即啟動 runner

股權分散歷史不足時，公開使用者 API MUST 先將該 active symbol 冪等設為可由既有 durable runner claim 的 queued 狀態，並在 runtime dispatch 設定可用、沒有新鮮 running run 且不在冷卻時立即要求既有 GitHub runner 啟動；TDCC 歷史表單的日期發現、至少一秒間隔、lease、checkpoint、validator 與受保護 ingest MUST 繼續由該 runner 負責。瀏覽器與 Worker MUST NOT 直接取得表單 session、cookie、synchronizer token 或規避 CAPTCHA／封鎖。

#### Scenario: 只有一筆 TDCC 快照
- **WHEN** holder pane 的 availability 為 `history_not_archived` 或實際合法快照少於兩筆，且 symbol 目前 active、completed／partial／failed 且非 blocked
- **THEN** API MUST 將該 symbol 設為 queued、清除可重試時間與過期 lease，讓下一次 runner 重新 plan 官方日期
- **AND** response MUST 依目前 dispatch 結果回傳 started、already-running、cooldown、unavailable 或 failed，不得只宣稱「已排入回補」或歷史已完成

#### Scenario: 短目標雖完成但未達一年歷史
- **WHEN** holder pane 的逐 symbol backfill 為 `completed` 且 `completedWeeks === expectedWeeks`，但 target 少於 51 週
- **THEN** API MUST NOT 將該 symbol 判定為完整，MUST 將它設為 queued 供 runner 重新 plan 官方可用日期
- **AND** response MUST 要求 runner 重新 plan，並回傳真實 dispatch 狀態，不得回傳「目前資料已完整」

#### Scenario: TDCC 已 queued 或 running
- **WHEN** 相同 symbol 已在 queued 或 running
- **THEN** API MUST 回傳 already-running 或 queued 並保持既有 lease／工作
- **AND** MUST NOT 建立第二份 symbol queue 或重置 runner owner

#### Scenario: TDCC 來源 blocked
- **WHEN** symbol 因 CAPTCHA、封鎖、候選不一致或未允許自動化而為 blocked
- **THEN** 一般使用者回補 API MUST 拒絕解鎖並顯示 blocked
- **AND** 只有既有受保護 operator 流程可依規格處理允許重試的原因

### Requirement: 回補要求具備防重複與安全可觀測性

同一 symbol 的回補 MUST 以 UI in-flight lock、D1 queued／running 狀態、fetch-state `last_attempt_at`／`retry_after` 與既有 single-flight 防止重複；API 與 UI MUST 顯示目前資料動作，而不是把排隊、執行與完成混為一談。

#### Scenario: 使用者快速連點
- **WHEN** 同一 panel 或多個分頁在冷卻時間內重複要求相同 symbol／datasets
- **THEN** 後續請求 MUST 回傳 already-running、cooldown 或同等 no-op 狀態
- **AND** MUST NOT 成比例增加上游下載、D1 queue items 或背景 promises

#### Scenario: 背景工作接受後
- **WHEN** API 已接受日資料背景工作或成功 dispatch TDCC runner
- **THEN** UI MUST 顯示「回補已開始」或「立即回補啟動中」並保持既有可讀資料
- **AND** 資料重新載入後 MUST 依最新 D1 payload 更新 availability、coverage 與功能表狀態
