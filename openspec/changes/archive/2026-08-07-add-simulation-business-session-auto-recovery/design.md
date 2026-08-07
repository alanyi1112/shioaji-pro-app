## Context

本機 runtime 目前以個別 LaunchAgent 常駐 Shioaji simulation API、RealTimeStock Web 與 MultiView。simulation API job 使用 `KeepAlive`，因此程序退出時可由 `launchd` 重啟；然而 Shioaji 內部 business session 失效時，8080 仍可監聽且 `/health` 仍可能回報 healthy，`launchd` 不會採取動作。`scripts/realtimestock-runtime` 已有固定 2330 Snapshot 的 `snapshot_status`／`wait_business_session`，但只在 install、模式切換與 status 時執行，沒有持續監測。

5173 的行情 SSE 在 transport 中斷後會自行重連與重播訂閱，卻不能用 SSE open／heartbeat 證明 business session 可用；`useWatchlist` 在 `SessionNotEstablished` 時可非阻塞降級，但恢復仍依賴使用者按「重新檢查」。5174 的 page-scoped coordinator 會在 SSE open 時建立 demand；若 SSE 比 business session 更早恢復，該次訂閱失敗後，仍存在的 SSE 會讓後續 mode check 不再重跑缺少的訂閱。

本變更只處理本機 simulation。production-readonly、CA、真實委託、帳務、遠端存取與雲端部署維持既有 fail-closed 邊界。

## Goals / Non-Goals

**Goals:**

- 以實際、固定、有界的唯讀行情請求辨識「HTTP healthy、business session 失效」。
- 對已成功建立後才中途失效的 simulation session 執行有限、自動且可診斷的 API 重啟。
- 讓 5173 與 5174 在 API 重啟期間保持可操作／延遲備援，並在 business session 恢復後自動重建資料狀態。
- 防止休市、初次登入未完成、短暫 timeout 或 provider 維護造成重啟風暴。
- 保持 simulation-only、loopback-only、data-only 與秘密不落地的既有安全邊界。

**Non-Goals:**

- 不自動啟動、重啟或修復 production-readonly，不安裝 CA，也不驗證任何交易呼叫。
- 不把 `/health`、SSE heartbeat 或「沒有新 Tick」改成 business session 真相。
- 不重啟 5173、5174、盤後 pipeline，不修改或重建 MultiView D1。
- 不保證 Shioaji 上游長時間停機時一定恢復；有限重試耗盡後必須保留 circuit-open 與人工操作入口。
- 不新增外部 daemon、雲端監控、遠端通知或第三方 dependency。

## Decisions

### 1. 使用獨立、週期性 LaunchAgent 執行一次性 watchdog probe

新增 `com.alanyi.realtimestock.business-session-watchdog` user LaunchAgent，以 `RunAtLoad` 與 30 秒 `StartInterval` 執行安裝腳本的 bounded `watchdog-once` 命令。每次 invocation 必須 single-flight、設定 HTTP timeout 並在完成一輪判斷後退出；LaunchAgent 不使用 `KeepAlive` 長駐 shell loop。

這讓 `launchd` 繼續直接追蹤 simulation API，不必把 Shioaji 改包在會管理 child process 的 supervisor shell，也避免 signal forwarding、孤兒程序與模式切換 ownership 變複雜。替代方案「由瀏覽器觸發 runtime 重啟」會暴露 server-management 能力，違反本機資料路徑最小權限，因此不採用。

### 2. Watchdog 採明確 armed incident，不修復從未成功的初始 session

watchdog 依序確認 mode marker、simulation job、`/api/v1/info` 的 `simulation: true`、`/health` 與固定 2330 Snapshot。只有目前 API generation 已至少一次取得合法非空 Snapshot 後才進入 `healthy/armed`；每次 generation 變更先進入至少 90 秒 warm-up。初次登入、重新開機或休市期間若從未成功建立 business session，系統保持 unarmed 與既有 `OFFLINE`／延遲備援，不自動重啟。

這個邊界把「曾連線後斷線」與「一開始就無法建立」分開，避免在非服務時間持續重啟。API generation 以 simulation job PID 或等效、可驗證且不含秘密的 instance token 辨識。

### 3. 只有連續明確 `SessionNotEstablished` 才具備重啟資格

armed generation 連續三次 probe 回傳明確 `SessionNotEstablished` 才建立 recovery incident；任一次 Snapshot 成功即清除 failure count。休市無新 Tick、SSE 沒有事件、單次 timeout、listener down、mode mismatch、一般 4xx／5xx 或 response shape 失敗都只能記錄安全 reason code，不得計入這個 restart threshold。

listener down 已由 simulation API job 的 `KeepAlive` 處理；watchdog 不與該責任重疊。一般錯誤未證明重啟能修復，因此維持可觀測但不擴大自動操作。

### 4. 只用 `launchctl kickstart -k` 重啟 simulation API，並採有限退避

符合門檻時，watchdog 只對 `gui/<uid>/com.alanyi.realtimestock.simulation-api` 執行 `launchctl kickstart -k`。5173、5174、daily／TDCC pipeline 與 D1 不得 bootout、bootstrap、重啟或寫入。重啟後進入至少 90 秒 recovery grace；仍回 `SessionNotEstablished` 時，後續重啟分別至少等待 2 分鐘與 5 分鐘。單一 incident 最多重啟三次，之後進入 `circuit-open`。

合法 Snapshot 成功或使用者明確執行 `pnpm local-runtime simulation` 時重設 incident、failure count、backoff 與 circuit。完整 `switch_simulation` 不作為 watchdog action，避免順帶重啟 MultiView 或重新註冊 pipeline。

### 5. Watchdog state 以 repo 外、原子且去識別化摘要保存

狀態放在 `~/Library/Application Support/RealTimeStock` 的權限受限子目錄，目錄 mode 為 `0700`、檔案為 `0600`，以同目錄 temporary file 加 atomic rename 更新。allowlist 欄位只包含 schema version、state、API generation token 的不可逆或非個資表示、consecutive failures、restart count、last reason、last transition time 與 next eligible time；不得保存 response body、商品清單、帳戶、environment、API key、secret、CA 或 exception dump。

`pnpm local-runtime status` 增加 watchdog job、state、failure／restart 安全計數、last reason 與 next eligible 摘要。install／simulation 會安裝或啟用 simulation watchdog並重設為新的 startup generation；production-readonly 必須 bootout watchdog；uninstall 必須移除 watchdog job、plist 與純診斷 state，但保留 `.env`、D1、備份與個人清單。

### 6. 5173 使用 document-scoped business monitor 與 single-flight 自動恢復

5173 建立單一 document-scoped、simulation-only business monitor，以與 runtime 相同的固定 2330 唯讀 Snapshot contract 低頻檢查 business availability。它不得用 SSE open／heartbeat 清除失效狀態，也不得呼叫 order、account、CA 或 server-management 路徑。

中途偵測到 `SessionNotEstablished` 時，全域狀態立即覆蓋 header 為 `OFFLINE`，保留工作區並啟動 `useWatchlist` single-flight 自動重試。重試使用 5、10、20、30 秒後封頂 30 秒的有界退避；成功時載回 server-backed watchlist、清除提示並只顯示一次自動恢復通知。手動「重新檢查」保留，可觸發立即 single-flight 嘗試但不得與 timer 併發，也不得重新開啟全畫面 boot gate。

### 7. MultiView 以 desired demand 對 active subscription 做持續 reconciliation

既有 page-scoped coordinator 保持每份 document 一條 SSE。每次 SSE open、15 秒 mode check、visibility／online 恢復時，比對 `desiredSymbols()` 與 `activeSymbols`；只對缺少的 demand 執行 per-symbol single-flight 訂閱，失敗採有界退避且不得建立第二條 SSE。API 重啟或 business session 尚未就緒時，自動來源模式維持 Yahoo 完整 snapshot fallback；明確 Shioaji-only 模式維持不可用提示，不得偷偷混用來源。

Snapshot 與必要 Kbars bootstrap 成功後，該 symbol 才能加入 active set 並回到 Shioaji `live`／`degraded` 狀態。重試期間 provider、OHLCV、source time 與 freshness 仍依既有原子來源切換規則，不得用接收時間或舊即時值冒充恢復。

### 8. 驗收以隔離假 API 證明 session-specific path，再做 simulation smoke

自動測試使用 loopback 假 API 呈現 `/health=healthy`、`/info.simulation=true`、Snapshot 連續回 `SessionNotEstablished` 後恢復的情境，並以 stubbed `launchctl`／clock 驗證 threshold、warm-up、退避、上限、circuit 與非 eligible 錯誤。瀏覽器與 MultiView fake-timer 測試證明 API 重啟後自動載回 watchlist、補回 demand 且不產生重複 SSE／subscription。

本機 smoke 只在既有 simulation 執行：確認 watchdog job/status、受控重啟 simulation API 後 5173／5174 listener 與 D1 material state 不變，最後以 2330 Snapshot 驗證 business session。不得為了重現故障切換 production、載入 CA 或送出真實委託。

## Risks / Trade-offs

- [固定 2330 probe 本身暫時失敗] → 僅明確 `SessionNotEstablished` 計數，連續三次且已 armed 才處理；其他錯誤不觸發重啟。
- [非服務時間從未建立 session] → 初始 generation 保持 unarmed，讓介面降級，不進入自動重啟。
- [provider 長時間故障] → 每 incident 最多三次、具 90 秒 grace 與 2／5 分鐘退避，之後 circuit-open 並保留人工 simulation reset。
- [watchdog 與人工模式切換競態] → 每輪先後重查 mode marker、實際 `/info` 與 job identity；非 simulation 立即 idle，production 切換先 bootout watchdog。
- [API 恢復但 SSE 太早 open] → 5173 既有 resubscribe retry 與 MultiView desired／active reconciliation 都以 business success 為完成條件。
- [多個 browser document 增加 probe] → 每 document 僅一個低頻 monitor；OS watchdog 才擁有重啟權，瀏覽器只做唯讀狀態與資料恢復。
- [狀態檔或 log 洩漏資訊] → 固定 allowlist schema、權限、原子寫入與 secret/schema tests；不保存 body、symbol list、account 或 environment。

## Migration Plan

1. 先完成 watchdog 純狀態機、隔離 fake API／launchctl 測試及三份 delta spec 驗證，不操作目前 runtime。
2. 擴充 runtime script、watchdog plist、state schema、install／status／simulation／production-readonly／uninstall，再完成前端與 MultiView 自動恢復測試。
3. 執行完整 test、build、OpenSpec strict、`git diff --check`、secret scan 與 simulation-only fail-closed 測試。
4. 由明確的本機驗收步驟重新執行 `pnpm local-runtime install`，保存安裝前 runtime／D1 logical state，確認 watchdog 載入且 production job 停止。
5. 以受控 simulation API restart 驗證 5173／5174 不重啟、D1 integrity／coverage 不變、2330 business Snapshot 與兩個 UI 自動恢復。
6. 若需回滾，bootout 並移除 watchdog plist／純診斷 state，恢復前一版 runtime script 後重新 install；simulation API、Web、MultiView 與所有 D1／備份資料保留，必要時使用既有手動 simulation 命令恢復。

## Open Questions

- 無。30 秒 probe、三次門檻、90 秒 grace、2／5 分鐘退避與每 incident 三次上限先作為可驗收的保守初值；未來若有真實量測支持，必須另以規格變更調整，不得在實作時任意放寬。
