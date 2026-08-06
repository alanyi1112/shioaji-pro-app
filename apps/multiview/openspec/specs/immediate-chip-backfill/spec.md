# immediate-chip-backfill Specification

## Purpose
TBD - created by archiving change make-tdcc-backfill-immediate-and-visible. Update Purpose after archive.
## Requirements
### Requirement: 使用者要求後立即啟動 TDCC runner

系統 SHALL 在已登入使用者對覆蓋不足的 TDCC 副圖選擇「立即回補歷史資料」後，先保存 durable queue，再由伺服器端要求既有 GitHub Actions workflow 立即啟動；「立即」代表 runner 啟動請求立即送出，不代表 HTTP request 同步等待全部歷史完成。

#### Scenario: dispatch 設定完整
- **WHEN** 合格 symbol 未達最低歷史週數，且沒有新鮮 running run 或 dispatch 冷卻
- **THEN** API MUST 將 symbol 保持為 `queued` 或 `partial` 並送出一次 workflow dispatch
- **AND** response MUST 安全回報 `started`，不得包含 token、authorization header 或秘密值

#### Scenario: runner 已在執行或剛完成 dispatch
- **WHEN** 使用者在同一個冷卻期間重複要求相同 symbol 回補，或 continuous runner 已有新鮮 heartbeat
- **THEN** 系統 MUST NOT 重複啟動 workflow
- **AND** response MUST 回報 `already-running` 或 `cooldown`，前端仍 MUST 進入進度追蹤

#### Scenario: dispatch 秘密未設定或 GitHub API 失敗
- **WHEN** 伺服器端缺少必要秘密，或 GitHub workflow dispatch 回應失敗
- **THEN** API MUST 明確回報 `unavailable` 或 `failed`，不得宣稱已立即啟動
- **AND** durable queue MUST 保留，下一次 scheduler 仍 MUST 能處理該 symbol

#### Scenario: 補齊 dispatch 秘密後重新嘗試
- **WHEN** D1 保留先前 `unavailable` 紀錄，但正式 runtime 已補齊 dispatch 秘密
- **THEN** 前端 MUST 允許使用者再次選擇「立即回補歷史資料」，不得把過去的降級狀態永久停用
- **AND** 新請求 MUST 依目前 runtime 設定重新 dispatch，成功時回報 `started`、`already-running` 或 `cooldown`

### Requirement: 回補進度與新資料立即反映在線圖

前端 SHALL 在立即回補已開始或已有 runner 執行時，依個別 symbol 的 `backfill.status`、`coverage.savedWeeks`、`completedWeeks` 與 `missingDates` 進行有限輪詢；任何新週資料寫入後 MUST 清除快取並重畫對應 TDCC 線圖。

#### Scenario: runner 寫入新的一週
- **WHEN** 輪詢發現 `savedWeeks` 或 `completedWeeks` 比前次增加
- **THEN** 前端 MUST 重新載入該 symbol 的籌碼資料並立即把新點畫在線圖
- **AND** 進度文字 MUST 顯示目前完成週數，不得仍只顯示「已排入回補」

#### Scenario: 逐批回補尚未完成
- **WHEN** runner 已完成本批次但 symbol 仍為 `partial` 且仍有 `missingDates`
- **THEN** 前端 MUST 保留已新增的圖表點與部分完成狀態
- **AND** durable queue MUST 可由後續 runner 從 checkpoint 接續

#### Scenario: 完成、受阻或離開副圖
- **WHEN** symbol 已達完整 coverage、進入 blocked／failed，或使用者切換商品、移除副圖或銷毀 controller
- **THEN** 前端 MUST 停止該輪詢 timer
- **AND** MUST 顯示完整、可重試失敗或安全受阻的對應狀態

### Requirement: 立即 dispatch 必須受保護且可稽核

系統 MUST 只允許已登入使用者對合格台股要求立即回補，且 GitHub owner、repo、workflow 與 ref MUST 由伺服器固定；D1 MUST 保存不含秘密的 dispatch 時間、symbol、狀態與安全錯誤碼供健康檢查及去重。

#### Scenario: 未登入或不合格商品
- **WHEN** 未登入請求或非支援台股普通股／ETF 要求立即回補
- **THEN** API MUST 拒絕請求且 MUST NOT 建立 queue 或呼叫 GitHub

#### Scenario: 檢查紀錄與 response
- **WHEN** operator 檢查 dispatch 紀錄、API response 或 workflow log
- **THEN** 內容 MAY 包含 symbol、時間、run 狀態與 allowlist 錯誤碼
- **AND** MUST NOT 包含 GitHub token、Sites bypass token、cookie 或完整授權 header
