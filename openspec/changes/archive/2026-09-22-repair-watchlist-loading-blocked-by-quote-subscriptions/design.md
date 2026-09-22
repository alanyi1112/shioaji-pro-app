## Context

目前 `useWatchlist.loadList()` 先清空 `items`，解析整份清單合約後，再 `await` 每檔商品的 Tick／BidAsk 訂閱；只有全部 promise 結束後才發布列並將 `loading` 設為 `false`。一般 `apiPost()` 沒有 timeout，因此單一 `/api/v1/stream/subscribe` 持續等待時，已成功取得的 server watchlist 與合約也無法顯示。

現有 `contracts-cache` 已採用「合約先可用、報價訂閱背景執行」及 `subscriptionPending`／`subscribed` 分離模式，可作為一致的生命週期參考。實作必須保留 `loadSeq` latest-wins、防止重複訂閱，且不得改動 simulation runtime、server watchlist 格式或交易功能。

## Goals / Non-Goals

**Goals:**

- 只要 server watchlist 與 canonical 合約解析完成，立即顯示可用清單列。
- 即時報價訂閱在背景執行，失敗或逾時不得阻塞清單 hydration。
- 只有成功完成所需報價種類後才記錄為已訂閱；等待中不得重複送出同商品訂閱。
- 同一清單重新整理期間保留既有列；切換到不同清單時不得短暫顯示前一清單內容。
- 任一載入世代都能在完成、失敗或被新世代取代時維持一致的 loading 狀態。

**Non-Goals:**

- 不變更 `/api/v1/watchlist` 或 `/api/v1/stream/subscribe` 的 server 契約。
- 不新增持續自動重試迴圈，也不接管既有 business-session watchdog 或 stream reconciliation。
- 不改變 provider subscription 上限、行情權限、production 模式或任何下單路徑。

## Decisions

### 1. 清單發布與行情訂閱解耦

`loadList()` 在合約解析完成且確認仍為最新 `loadSeq` 後，先更新 `items`、啟動 snapshot 補值，再逐檔啟動背景訂閱。它不等待訂閱 promise 才解除 loading。

替代方案是只替整批訂閱增加 timeout，但 timeout 之前仍會讓清單無意義地空白，而且無法避免部分訂閱延遲拖慢全部商品，因此不採用。

### 2. 分開追蹤 pending 與 subscribed

hook 以兩個集合分別記錄訂閱中的商品與已完成全部必要報價種類的商品。啟動時先加入 pending；只有 `subscribeContractQuotes()` 回傳的每個結果都 fulfilled 才加入 subscribed，並在 `finally` 移除 pending。失敗或逾時的商品可在後續明確 reload／session recovery 時重新嘗試。

替代方案是在發出請求前直接加入 subscribed；這會把失敗視為成功並永久抑制重試，因此不採用。

### 3. 對報價訂閱採有限等待

新增可帶 timeout 的 POST helper，並僅由行情 subscribe 路徑使用。逾時會透過 `AbortController` 中止 client request，使背景 promise 有明確終態並釋放 pending；不建立額外自動重試 timer，避免故障期間形成請求風暴。後續既有清單 reload 或 session recovery 才能再次嘗試。

### 4. 依清單身分決定是否保留舊列

hook 記錄目前已發布列所屬的 list id。同一 list 因 invalidation 或 recovery 重新載入時保留舊列，待新結果以最新世代原子替換；使用者切換不同 list 時立即清空前一 list，避免標題與內容錯配。

### 5. loading 由 latest-wins finally 收斂

`loadList()` 使用 `try/finally`，只有當前 `seq` 仍是最新世代時才能解除 loading。canonical migration 的 server 同步改為非阻塞背景工作並自行處理錯誤，不能讓已發布清單回到永久 loading。

### 6. Vite loopback 的高扇出 SSE 與互動式 REST 分流

瀏覽器版 Vite proxy 使用 HTTP/1.1。主行情與合約事件各占一條 SSE，而即時訊號面板另開四條專用 SSE；六條長連線會吃滿 Chromium 對同一 origin 的連線額度，使之後切換商品所需的 K 線 REST request 永久停在瀏覽器佇列，API 端完全收不到。

只在 `import.meta.env.DEV`、API base 為同源且頁面 hostname 是 `127.0.0.1`／`localhost` 時，將四條市場脈動 SSE 改送到等價的另一個 loopback hostname。Vite 已對該本機 cross-origin SSE 回傳 CORS header；主行情、合約事件及互動式 REST 仍留在頁面 origin。Tauri 具有明確 API base 且 REST 由 Rust-side fetch 執行，因此維持既有路徑。

替代方案是關閉即時訊號通道或輪流連線，但會犧牲盤中資料完整性；將所有 server channel 合併也需要變更 Shioaji server 契約，超出本 change 範圍，因此不採用。

## Risks / Trade-offs

- [清單先顯示時部分價格可能暫為 `—`] → 保留既有 snapshot 補值與 stream 更新；可見的 placeholder 比整張清單不可用更能反映真實狀態。
- [subscribe request 已到 server、但 client 在回應前逾時] → 不做立即自動重送，只允許後續 reload／recovery 重試，降低重複 physical subscription 風險。
- [同一清單刷新保留舊列可能短暫顯示過期成員] → 新合約解析完成後原子替換；不同 list 切換則立即清空，避免跨清單誤認。
- [背景 migration 失敗] → 保留已解析且可見的本機列，發出既有同步失敗通知，讓後續刷新重新對帳。
- [不同 loopback hostname 屬於 cross-origin] → 僅限 Vite 開發模式啟用，並以實際 response header 與瀏覽器驗收確認 CORS；非 loopback、Tauri 與明確 API base 均不改寫。
