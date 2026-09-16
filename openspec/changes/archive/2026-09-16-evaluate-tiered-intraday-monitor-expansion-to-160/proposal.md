## Why

固定 20 檔功能驗收已於 2026-09-11 完成，包含可信前日 baseline、一個三件式完整盤中日、跨日重播與使用者委託 Codex 的 GO。使用者要求直接評估 160 檔；若 160 檔通過，不再要求 50／100 檔中間容量測試。

## What Changes

- 主路徑改為已核准 20 → 160；50／100 只保留為未來失敗診斷工具，不是必要 Gate，不自動啟動。
- 前置 verifier 接受最新單日功能 bundle 與其真實 GO 引用，保留舊兩日 bundle 相容；不放寬資料、hash 或審閱條件。
- 160 檔使用可信前一交易日 1 分 K 基準＋一個完整盤中驗收日；第二日僅作非阻擋穩定性追蹤。每檔以 1 分 K 成交量逐分鐘累加，與 20 檔算法相同，不能複製其他商品資料作基準。
- 160 檔失敗、未簽核或證據不足時維持已核准 20，不推定 100 已通過。
- 新增獨立 160 儲存 profile、兩日 synthetic 全量容量量測、原子 exclusive 落檔與空間不足拒絕；不放寬既有 20 檔上限或改寫已封存 evidence。
- 160 product plan 鎖定 32 MiB session canonical、64 MiB capture、128 MiB bundle／fixture、64 MiB 產品 DB＋WAL growth、8 GiB 可用磁碟保留及 1 GiB RSS 預算；64 MiB DB 預算來自 43,200 筆加 160 個 trigger 的產品 schema 實測峰值 42,327,712 bytes，不更改舊 plan 或既有證據。
- 將 exact 160 live recorder 同步接入產品 evidence DB、量比 trigger 與本機 API／SSE，使盤中選股面板在驗收當日直接顯示同一份即時結果；驗收 capture 與產品結果不得各算一套。
- 160 bundle 經 Codex 依使用者既有授權審閱為 GO 後，原子保存 review 並將正式 active limit 由 20 改為 160；證據不足或 NO-GO 時維持 20。
- 正式 runner 必須量測產品 DB／WAL growth、同日既有圖表視覺更新、local SSE 斷線重連與 160 data-active，避免僅以 Web HTTP 成功冒充完整功能健康。

## Capabilities

### New Capabilities

- `intraday-monitor-tiered-capacity-evaluation`：直接 160 檔測試、前置 Gate、空間保留、逐商品完整性與安全回復。

### Modified Capabilities

- `intraday-relative-volume-monitor`：補上 exact 160 驗收與產品資料共用、通過後正式啟用 160、同日面板結果與後續盤中 session 的執行狀態。
- `intraday-stock-selection-workspace`：容量驗收進行時顯示 160 檔即時狀態與結果，並保留設定、搜尋、排序、K 線連動、通知與觀察清單操作。

## Impact

- 修改 tiered prerequisite、stage gate、plan／execution token、rollback 與測試。
- 新增專用儲存與離線容量 harness、日期化 plan／report。
- 下一交易日由同一有界 simulation transport 同時產生驗收 artifact 與產品 DB／SSE 結果；不得另開第二組 160 provider 訂閱。
- 使用者已授權必要服務重啟及由 Codex 審閱 160 結果；仍不操作 production、broker write、archive、commit 或 push。
