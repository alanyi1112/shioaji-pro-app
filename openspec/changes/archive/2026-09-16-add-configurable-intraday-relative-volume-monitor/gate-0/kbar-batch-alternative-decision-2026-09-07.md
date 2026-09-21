# Gate 0 修正決策：固定 20 檔 realtime KBar batch

## 結論

本 change 改採 **bounded realtime KBar**，不再要求修改已安裝的 Shioaji HTTP server，也不把需求稿提交到 `Sinotrade/Shioaji`：

- 最多 200 檔仍可保存為 configured 名單。
- 每個 simulation session 只取穩定排序前 20 檔形成 immutable cohort。
- 以一次 `POST /api/v1/stream/subscribe/kbars` 提交整批，並由一條專用 `GET /api/v1/stream/data/kbar` SSE 接收。
- 同一 session 不輪替、不補位、不擴量，也不以 unsubscribe accepted 推定容量已釋放。
- physical counting、global ownership、provider release 與 headroom 保持 `unknown`；UI 與 evidence 不得顯示推定值。
- 第一個完整交易日只建立自有 baseline，後續適用完整交易日才比較同分鐘累積量。
- 50 檔以上的 active 擴量移出本 change，20 檔通過人工驗收後另案評估。

這個決策取代 `go-no-go-2026-09-04.md` 與 `live-integration-gap-2026-09-07.md` 中「必須先取得上游 physical inventory／receipt 才能開始任何 pilot」的交付前提；上述文件仍保留為限制鑑識歷史。它們對 HTTP accepted 不等於 provider confirmation 的判斷仍有效。

## 為何可行

需求的最小即時輸入是每檔每個完成分鐘的成交量，不需要逐筆 Tick。現有 Shioaji API 1.7.1 已公開：

- `POST /api/v1/stream/subscribe/kbars`：request body 為 `stocks[]`，可在同一 request 帶多個 STK contract。
- `GET /api/v1/stream/data/kbar`：每檔推送 `code`、`date`、`time`、OHLC、`volume`、`amount` 與 `tick_count`。
- `POST /api/v1/stream/unsubscribe/kbars`：接受相同 `stocks[]`。

本地 sidecar 可以自行完成 cohort、SSE、分鐘 seal、累積、基準與 trigger，不需要 HTTP server 增加 diagnostics。未知的 provider quota 不被改寫成已知；改以最多 20 檔、單一 batch、零輪替與逐檔 data receipt 限制風險。

## 2026-09-07 simulation 實證

### 多商品資料路徑

`kbar-batch-probe-final-2026-09-07.json`：

- API 1.7.1，前後皆 `simulation=true`。
- 一個 request 訂閱 2330、2454，HTTP 200、`success=true`。
- 同一分鐘各收到一個 KBar；0 rejected、0 unexpected symbols。
- payload shape 為 `code/date/time/open/high/low/close/volume/amount/tick_count`。
- `date=yyyy/mm/dd`、`time=hh:mm:ss`、`volume=safe-integer`。
- 相同 cohort unsubscribe 為 HTTP 200、`success=true`。
- 全程 0 broker writes、0 production logins、0 service restarts，未保存原始 payload。

### 分鐘完成語意

`kbar-completion-semantics-2026-09-07.json` 顯示 09:36 KBar 約於 09:36:02.52 收到；09:37 後以一次唯讀歷史 Kbars 對照，2330 的 09:36 volume 仍為 33、2454 仍為 326。這支持串流值可用，但不能由單一樣本證明所有商品／日期都永遠不修訂。因此正式 recorder 採 one-bar delay：下一個連續 minute 抵達後才 seal 前一根；缺棒或重連則 fail closed。

### 連線對帳

探針前後 aggregate SSE 可能因既有 Vite／MultiView 自行重連而變動；OS `lsof` 對帳在探針結束後只剩既有 PID 915 與 921 到 8080 的連線，沒有 probe process。此證據只能證明探針 process／socket 已結束，不能宣告 provider physical release。

## 安全與正確性契約

1. preflight 必須是固定 loopback、`simulation=true`、最多 20 檔合法 STK、immutable cohort hash、通知關閉。
2. 每個 server process／session 最多一個盤中監控 batch；不得 mid-session replacement。
3. HTTP accepted 只記為 accepted；active 必須由逐商品合法 KBar receipt 決定。
4. 剛收到的 KBar 是 forming；收到下一個連續 minute 或可信 close seal 後才完成前一根。
5. 重複 minute 冪等；舊 generation、倒序、跨日、負量、cohort 外事件一律拒絕。
6. 任一 gap、disconnect 或漏棒使受影響累積量為 unknown，不補 0、不 carry-forward、不輪詢補洞。
7. 只有相同 recorder 產出的上一完整交易日可作 baseline；歷史 Kbars 沒有 coverage receipt，只能作診斷。
8. 頁面晚開或今日錄製不完整時不得觸發；2026-09-07 當次只算功能探針，不算完整交易日。
9. 既有 K 線、watchlist、alert、smart order 或 runtime 退化即停止 pilot；盤中監控沒有 broker write、production 或自動 service lifecycle authority。

## 後續

1. 實作 KBar observation adapter 與 one-bar delay seal。
2. 將 bounded transport 接入 feature-off runtime，先以固定 20 檔 shadow recording、通知關閉運作。
3. 從下一個可於 session 起點前完成 preflight 的交易日開始錄製第一個完整 baseline 日。
4. 至少第二個完整交易日才進行同分鐘量比 dry run。
5. 完成資源／正確性／UI 證據與人工核定後，才開啟本機 20 檔試辦；擴量另案。
