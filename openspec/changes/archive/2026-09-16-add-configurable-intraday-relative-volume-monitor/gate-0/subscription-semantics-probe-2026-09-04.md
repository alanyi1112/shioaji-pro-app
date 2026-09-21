# Gate 0：subscription 語意受控探針

## 文件資訊

- Change：`add-configurable-intraday-relative-volume-monitor`
- 對應任務：1.2（未完成）
- 探針時間：2026-09-04 12:44–13:21（Asia/Taipei）
- 模式：Shioaji HTTP API 1.7.1，`simulation=true`
- 安全邊界：沒有登入第二個 session、沒有 production、沒有下單或其他 broker write。先做單一 STK 的 subscribe／unsubscribe 反例；取得使用者明確授權後，再於乾淨 simulation maintenance window 各執行一次最多 201 個 key 的 `tick-distinct` 與 `mixed-types` 受控探針。每組結束立即重啟 simulation API，並重新確認 `simulation=true`、`active_connections=0`。
- 結論：**已證明 HTTP success 不足以作為 physical subscription confirmation；simulation HTTP adapter 對第 201 個 key 仍回 success，未公開 physical inventory 或 provider event receipt，因此不能由這個結果推定正式環境沒有 200 上限，也不能證實實際 counting dimension。跨 8080／5174 request path 共用同一 server session，但 refcount、physical release 與斷線釋放仍不可證實；1.2 維持未完成，active capacity = 0。**

## 官方限制與尚未回答的問題

永豐金官方 Shioaji 使用限制只說明 `api.subscribe()` 數量上限為 200，沒有定義 200 是按 contract、quote type、呼叫次數、Solace topic、connection 或其他 physical item 計數：

- <https://sinotrade.github.io/zh/tutor/limit/>
- <https://sinotrade.github.io/tutor/market_data/streaming/stocks/>

官方股票串流文件確認 `Tick`、`BidAsk`、`Quote` 與 `intraday_odd` 是獨立參數，但沒有說明同一 contract 的不同 quote type 是否各占一個額度，也沒有說明跨 HTTP client／process 的去重或 ownership。

## 關頁後的當次基線

使用者關閉可見頁面後：

- `GET /api/v1/stream/status` 仍回傳 `active_connections=12`。
- `lsof -nP -iTCP:8080` 顯示 12 條連線全部由 PID 911 的 MultiView Node dev server 建立。
- `lsof -nP -iTCP:5174` 只剩 PID 911 的 listener，沒有瀏覽器到 5174 的 TCP connection。
- 5174 `GET /api/health` 同時回傳 local adapter `activeStreams=0`、realtime `subscriptionCount=0`。

這組證據表示 8080 的 12 條 SSE 與 5174 health counter 不一致，且關閉頁面不足以建立可列舉的乾淨 subscription 基線。`active_connections` 也沒有 contract、quote type、owner、generation 或 physical key，不能轉換成 subscription usage。

## 單商品跨 client 路徑探針

探針先以 `GET /api/v1/info` 驗證 `simulation=true`，再取得 `GET /api/v1/data/contracts/2460` 的正式 contract：

```json
{
  "security_type": "STK",
  "region": "TW",
  "exchange": "TSE",
  "code": "2460",
  "target_code": null,
  "quote_type": "Tick",
  "intraday_odd": false
}
```

依序執行：

1. 直接對 8080 `POST /api/v1/stream/subscribe`。
2. 經 5174 `/local-shioaji` adapter `POST /api/v1/stream/unsubscribe`。
3. 再直接對 8080 重複同一個 `POST /api/v1/stream/unsubscribe`。

三次 HTTP response 皆為 200 且 `success=true`：

```text
direct_subscribe        Subscription successful
proxy_unsubscribe       Unsubscription successful
direct_unsubscribe_again Unsubscription successful
```

第二次 unsubscribe 仍成功，證明此 API response 只表示 request 被接受／處理，不能證明：

- 第一個 caller 擁有可獨立釋放的 refcount；
- 第一次 unsubscribe 確實移除一個 physical item；
- 第二次 unsubscribe 有找到仍存在的 item；
- 容量已可安全回收；
- 8080 與 5174 各自擁有或共用哪一個 physical subscription。

因此既有 smart-order coordinator 將 HTTP success 當成 local confirmation 的做法，仍不能升格為整個應用程式的 transport authority。

## 初次未執行 200 額度灌滿測試的理由

當次存在 12 條無法列舉的 8080 SSE，且 server 沒有 subscription inventory endpoint。直接加入 160 或 200 個測試 demand 會同時產生以下風險：

- 無法區分探針占用與先前頁面遺留占用；
- 可能擠壓 chart、alert 或 smart-order 的既有 demand；
- 即使第 N 次 request 失敗，也不能從 N 反推出 counting dimension；
- cleanup 的 200 回應仍無法證明 physical capacity 已釋放。

這不符合 change 要求的至少 40 headroom 與 unsubscribe confirmed-before-reuse 原則，所以初次探針刻意不做壓滿測試。之後使用者明確授權必要的 simulation API／MultiView 重啟，才先以重啟建立可回復的乾淨 maintenance window，執行下列受控測試。

## 乾淨 simulation maintenance window

執行容量探針前先重啟 simulation API 與 MultiView，確認：

```text
runtime_mode=simulation
production_readonly_job=stopped
smart_order_write_master=disabled
api_simulation=true
GET /api/v1/stream/status active_connections=0
MultiView deploymentTarget=local
MultiView shioajiAdapter.simulationOnly=true
MultiView shioajiAdapter.activeStreams=0
MultiView realtime.subscriptionCount=0
```

探針腳本：`probe-subscription-capacity.mjs`。腳本在任何 mutation 前自行檢查上述 simulation／loopback／零 SSE 基線，且最多只送到第 201 個 key，不繼續向上探測。

### A. 200 個不同 Tick key

結果摘要：

```json
{
  "mode": "tick-distinct",
  "eligibleContractCount": 1976,
  "acceptedUnique": 200,
  "duplicateSameTickKey": "HTTP 200 success",
  "distinctTick201Boundary": "HTTP 200 success",
  "proxyUnsubscribeExistingKey": "HTTP 200 success",
  "directSubscribeAfterProxyRelease": "HTTP 200 success",
  "duplicateUnsubscribeRemovedKey": "HTTP 200 success",
  "subscribeAfterDuplicateRelease": "HTTP 200 success"
}
```

這組結果只證明 HTTP server 接受請求；因第 201 個亦成功，無法以失敗邊界反推出 physical key 計數。同一個已退訂 key 再退一次仍成功，也再次否定「success 等於 refcount／容量已釋放」的推論。

### B. 100 商品 × Tick／BidAsk

在重啟後的新乾淨 simulation session，以 100 個商品各送 Tick 與 BidAsk，共 200 個不同 request key，再送第 101 個商品 Tick：

```json
{
  "mode": "mixed-types",
  "eligibleContractCount": 1976,
  "acceptedUnique": 200,
  "duplicateSameTickKey": "HTTP 200 success",
  "mixedKey201Boundary": "HTTP 200 success"
}
```

第二個 session 仍可接受 200 個 key，與 API restart 已建立新 session 的觀察一致；但 server 沒有 generation id 或 subscription inventory，因此這只能作為「舊 request state 未阻止新 session 接受請求」的間接證據，不能升格為逐 key release confirmation。第 201 個 mixed key 仍成功，所以也不能判定 Tick／BidAsk 是否分別計入官方 200 上限。

### 維護後狀態

每組探針完成後均立即重啟 simulation API。最後重新確認：

```text
runtime_mode=simulation
production_readonly_job=stopped
smart_order_write_master=disabled
api_simulation=true
api_business_session=available
GET /api/v1/stream/status active_connections=0
```

沒有啟用 production、沒有第二個 login、沒有下單、沒有保留探針 SSE client。由於上游不公開 physical inventory，文件不宣稱「全部訂閱已逐筆確認釋放」，而是以新 simulation process／session 作為安全清場邊界。

## 1.2 剩餘驗證條件

要完成 1.2，至少需要同一個當期 generation 下的下列證據之一：

1. Shioaji／HTTP server 提供可列舉 physical subscriptions、quote type、connection generation 與 confirmation 的官方 diagnostics；或
2. 在不建立第二個 login 的前提下，先取得一個已明確授權、可回復的乾淨 simulation maintenance window，並由 transport event callback／topic receipt 證明每個 subscribe 與 unsubscribe 結果；或
3. 將所有 owner 收斂到可列舉的單一 transport authority，再以受控 fixture 驗證 duplicate、跨 client、disconnect 與 200 limit。

在完成前，固定輸出：

```text
gate0EvidenceCurrent=false
globalOwnershipComplete=false
subscriptionCountingDimension=unknown
unsubscribeConfirmation=unknown
activeCapacity=0
```
