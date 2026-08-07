## 1. Watchdog 狀態機與隔離測試

- [x] 1.1 建立可測試的 watchdog decision model，定義 `startup-grace`、`healthy/armed`、`suspect`、`recovering`、`backoff`、`circuit-open` 與 `idle-non-simulation` 轉移
- [x] 1.2 定義 repo 外 watchdog state allowlist schema、`0700`／`0600` 權限、single-flight lock 與同目錄 atomic replace 寫入
- [x] 1.3 建立可注入 clock、API base、job generation 與 `launchctl` adapter 的隔離 fixture，不讀取或複製本機 `.env` 秘密
- [x] 1.4 測試 30 秒 probe、三次連續 `SessionNotEstablished` 門檻、任一次成功歸零與初始 generation 未 armed 不重啟
- [x] 1.5 測試 90 秒 recovery grace、2／5 分鐘退避、每 incident 三次上限、circuit reset 與 generic error／listener down／mode mismatch 不重啟

## 2. 本機 Runtime 與 LaunchAgent

- [x] 2.1 在 `scripts/realtimestock-runtime` 加入 bounded `watchdog-once`、固定 2330 Snapshot 分類與每輪前後 mode／job identity 重查
- [x] 2.2 產生 `com.alanyi.realtimestock.business-session-watchdog` user LaunchAgent，使用 `RunAtLoad`、30 秒 `StartInterval`、固定 loopback 與不含秘密的 arguments
- [x] 2.3 實作只對 simulation API job 執行 `launchctl kickstart -k` 的 recovery action，確認不得呼叫完整 `switch_simulation` 或操作 5173／5174／pipeline job
- [x] 2.4 將 watchdog 納入 install、simulation、production-readonly 與 uninstall；production 啟動前必須 bootout watchdog，uninstall 僅移除 plist／job／純診斷 state
- [x] 2.5 擴充 runtime status，輸出 watchdog job、state、consecutive failures、restart count、last reason 與 next eligible time 的固定安全欄位
- [x] 2.6 新增 runtime／plist 回歸測試，涵蓋 simulation-only、loopback、無 CA／order／account／server-management 路徑及 state/log schema redaction

## 3. RealTimeStock 工作區自動恢復

- [x] 3.1 建立單一 document-scoped、simulation-only business monitor，以低頻固定 2330 Snapshot 區分 business session 與 SSE／HTTP health
- [x] 3.2 將中途 `SessionNotEstablished` 接入全域 service issue，立即覆蓋 header 為 `OFFLINE` 並維持非阻塞工作區
- [x] 3.3 擴充 `useWatchlist`，以 5／10／20／30 秒後封頂 30 秒的 single-flight 退避自動重新檢查並在成功後載回 server-backed watchlist
- [x] 3.4 合併手動「重新檢查」與自動 timer，避免併發 initialize、重複建立 watchlist、重開全畫面 boot gate 或重複恢復通知
- [x] 3.5 新增 fake-timer 與 API fixture 測試，涵蓋 SSE 仍 open 的 session 失效、持續離線、恢復成功、休市無 Tick 及非 simulation 停止 monitor

## 4. MultiView Demand Reconciliation

- [x] 4.1 擴充 page-scoped realtime coordinator，在 SSE open、15 秒 mode check、visibility 與 online 恢復時比對 `desiredSymbols` 與 `activeSymbols`
- [x] 4.2 對缺少 demand 實作 per-symbol single-flight、有界退避；只有 subscribe、Snapshot 與必要 Kbars bootstrap 成功後才加入 active set
- [x] 4.3 保持每 document 至多一條 SSE、相同 canonical 商品一個 recovery flow，並保留自動模式 Yahoo fallback 與 Shioaji-only 不可用語意
- [x] 4.4 擴充安全驗收計數，只增加 bounded retry／recovery reason code 與計數，不得加入 symbol、行情、個人清單、帳戶或秘密
- [x] 4.5 新增 coordinator 回歸測試，模擬 API restart、SSE 早於 session、首次補訂閱失敗後成功、多 panel 重複 demand、持續失敗與來源原子切換

## 5. 文件與安全邊界

- [x] 5.1 更新本機 runtime 與 MultiView 操作文件，說明 business session、watchdog state、circuit-open、人工 simulation reset 及不會自動修復 production 的邊界
- [x] 5.2 更新安全測試與 secret scan allowlist，確認 source、plist、state、log、fixture 與 artifact 不包含帳號、API key、secret、CA、response body 或交易資料
- [x] 5.3 以隔離 synthetic 非 simulation 狀態驗證 watchdog idle、5173 monitor 停止、5174 data-only fail-closed，且不建立 production job或呼叫正式行情

## 6. 自動驗證

- [x] 6.1 執行 RealTimeStock 完整 tests 與 production build，確認既有 SSE resubscribe、交易 guard、offline workspace 與 UI 無回歸
- [x] 6.2 執行 MultiView 完整 tests、lint、build 與 governance／安全驗證，確認單一 SSE、demand 去重、fallback 與 D1 contract 無回歸
- [x] 6.3 執行 `openspec validate --all --strict`、`git diff --check`、完整 dependency audit 與 secret scan，記錄實際結果而不補造通過狀態

## 7. Simulation-only 本機生命週期驗收

- [x] 7.1 在任何 runtime 寫入前保存目前 simulation mode、8080／5173／5174 PID、watchdog job、D1 integrity／coverage、個人清單 material hash 與盤後 pipeline 安全摘要
- [x] 7.2 重新執行 `pnpm local-runtime install`，確認 watchdog 已載入、production-readonly 停止、API 為 simulation 且 2330 business Snapshot 可用
- [x] 7.3 以受控 simulation API restart 與隔離 session fixture 驗證自動偵測、有限重啟、5173 watchlist 自動載回及 MultiView 缺少 demand 自動恢復
- [x] 7.4 驗證 5173／5174 未被 watchdog 重啟、D1 integrity／coverage／個人清單 hash 與 pipeline 狀態不變，最後終態保持 simulation 且未呼叫任何交易 API
