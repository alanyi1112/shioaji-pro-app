## Why

Shioaji HTTP API 程序與 `/health` 可能持續正常，但內部行情 business session 已失效並回傳 `SessionNotEstablished`；現有 `launchd KeepAlive` 與前端 SSE 重連無法辨識或修復這種「程序仍活著、行情已斷線」的狀態，使用者只能手動完整重啟 simulation runtime。系統需要以實際唯讀行情請求作為真相，在不觸碰 production 或交易能力的前提下自動恢復 simulation 行情與畫面狀態。

## What Changes

- 為本機 simulation runtime 新增 business-session watchdog，以固定且有界的 2330 Snapshot probe 持續區分 HTTP health 與行情 session 可用性。
- 僅在目前模式與 API 實際回報均為 simulation、該 API generation 曾成功提供行情，且連續偵測到 `SessionNotEstablished` 時，自動重啟 simulation API；不得因休市無新 Tick、單次 timeout、一般 HTTP 錯誤或初次 session 尚未建立而誤重啟。
- 重啟採有限次數、恢復等待、退避與 circuit breaker；只重啟 8080 simulation API，5173、5174、MultiView D1 與盤後 pipeline 維持原狀。
- 擴充 runtime install、simulation、production-readonly、status 與 uninstall 的 watchdog 生命週期及去識別化狀態；production-readonly 必須停止或停用 watchdog，且 watchdog 永不得切換模式、載入 CA 或呼叫交易／帳務 API。
- 讓 RealTimeStock 在 business session 中途失效時進入非阻塞 `OFFLINE`，以 single-flight 有界退避自動重新檢查；恢復後自動載回 server-backed watchlist、清除提示並保留手動「重新檢查」。
- 讓 MultiView 在 API 重啟或 SSE 太早恢復、初次補訂閱仍遇到 session 未就緒時，對尚未 active 的目前 demand 執行 single-flight 有界重試；自動來源模式在恢復前維持 Yahoo 延遲備援，成功後自動回到 Shioaji 即時來源。
- 新增隔離 fixture、狀態機、前端與 MultiView 回歸測試，並以 simulation-only 本機驗收證明自動恢復、重啟上限、資料不受影響及安全邊界。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `safe-local-runtime-mode-switch`: 新增 simulation business-session watchdog、有限重啟、退避、circuit breaker、生命週期與安全狀態輸出要求。
- `offline-simulation-workspace`: 新增中途 session 失效偵測、自動重新檢查、恢復後自動載回自選清單及可見狀態要求。
- `multiview-local-runtime`: 新增 simulation API 自動重啟期間的持續 fallback、缺少 demand 補訂閱與自動恢復即時來源要求。

## Impact

- 本機 runtime：`scripts/realtimestock-runtime`、產生的 user LaunchAgent、Application Support 內的去識別化 watchdog 狀態及安裝／移除流程。
- RealTimeStock 前端：business-session 狀態監測、`useWatchlist` 自動恢復、全域離線提示與 SSE／subscription 恢復整合。
- MultiView：page-scoped realtime coordinator 的缺少訂閱重試、fallback／recovery 狀態與安全驗收計數。
- 測試與文件：watchdog 決策 fixture、假 API、fake timer、MultiView coordinator、runtime status、simulation-only 本機生命週期與操作文件。
- 不新增外部服務、雲端部署、production 啟用、CA、交易端點、帳務端點或秘密保存方式。
