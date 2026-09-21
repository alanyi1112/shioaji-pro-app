# Gate 0：subscription ownership 唯讀盤點

## 文件資訊

- Change：`add-configurable-intraday-relative-volume-monitor`
- 對應任務：1.1
- 盤點時間：2026-09-04 12:39（Asia/Taipei）
- 盤點模式：唯讀；沒有呼叫 subscribe／unsubscribe、沒有啟停服務、沒有變更 simulation／production、沒有 broker write
- 結論：**inventory 完成，但全域 ownership 不可完整列舉；盤中監控 admission 必須維持 fail closed，active capacity = 0。**

## 當次 runtime 快照

`pnpm local-runtime status` 與 listener 盤點顯示：

| 元件 | 當次狀態 | 可觀測資訊 | 不可觀測資訊 |
| --- | --- | --- | --- |
| RealTimeStock Web | `127.0.0.1:5173`，PID 905，loaded／listener up | process 與 listener 存在 | browser-local subscription 商品、quote type、owner、refcount、generation |
| MultiView local worker | `127.0.0.1:5174`，PID 911，loaded／listener up | `simulationOnly=true`、`maxSymbols=8`、`activeStreams=0` | browser-local active symbols、upstream physical subscription keys、owner refcount、generation |
| Shioaji HTTP API | `127.0.0.1:8080`，PID 924，simulation、business session available、health healthy | `/api/v1/stream/status` 回傳 `active_connections=13`、`status=healthy` | 13 條 connection 的 owner、商品、quote type、physical key、refcount、generation；active connections 也不是 subscription count |
| Smart-order sidecar | loaded，discovery valid-private，readiness not-ready，write master disabled | sidecar 安全狀態 | 當期 quote coordinator aggregates／physical usage 未由一般唯讀 status 公開 |
| Python MultiView gateway | `127.0.0.1:8788` 無 listener；5174 health 顯示 realtime gateway unavailable | 當次未接上 realtime gateway | 若另行啟動時的 provider login 與 subscription ownership 未納入 8080 status |
| 同一 login 外部 client | 無全域 inventory endpoint | 無 | process、connection、商品、quote type、usage 全部未知 |

補充：8080 `/api/v1/stream/receivers` 只回覆支援 tick、bidask、stock／futures／index quote 與 order event receiver，沒有列出實際 subscription。

## Owner 與責任鏈盤點

### 1. RealTimeStock chart／contract cache

- `src/lib/contracts-cache.ts:10-14` 以 module-local `subscribed`／`subscriptionPending` Set 依商品代碼去重。
- `src/lib/contracts-cache.ts:32-46` 第一次解析商品時呼叫 `subscribeContractQuotes`，但不保存 consumer identity、quote-type refcount 或 connection generation，也沒有對應 release handle。
- `src/App.tsx` 的 chart 透過 `useContract` 取得商品；實際 subscription owner 因而落在共用 contract cache，而不是可列舉的個別 chart block。

當前可表示的邏輯 key 是 `contract.code`；實際 POST 會再展開成 Tick／BidAsk。當次 browser 的實際商品集合與狀態沒有診斷出口，因此列為 unknown。

### 2. RealTimeStock watchlist

- `src/hooks/use-watchlist.ts:155-175` 另有 hook-instance-local `subscribed` Set，並再次呼叫 `subscribeContractQuotes`。
- 這個 Set 只以商品代碼辨識，沒有 owner id、physical confirmation、refcount、generation 或 unmount release。
- 相同商品若已由 contract cache 訂閱，watchlist 仍可能再次向 8080 送出 Tick／BidAsk subscribe；前端無法證明 server 是否把兩次呼叫計成同一 physical item。

當次可確認 owner 類別為 watchlist，但無法列出真實 active 商品、physical key 或 refcount。

### 3. RealTimeStock 共用 subscribe API／SSE registry

- `src/lib/shioaji.ts:380-425` 對一般商品直接 POST `/api/v1/stream/subscribe`；非指數商品每次呼叫 Tick 與 BidAsk 兩種 quote type。
- 一般商品路徑沒有像 capability subscription 的 `capabilityRefs`；每次 `subscribeContractQuotes` 都會送出 upstream request。
- `src/lib/stream.ts:240-260` 只在 subscribe 成功後，以 `${code}:${quote_type}` 寫入 browser-local replay registry。相同 key 會覆蓋，無法表示多 owner、呼叫次數、server physical state 或 refcount。
- `src/lib/stream.ts:462-464` 只公開 registry unique-key count，且沒有由 server 或外部 diagnostics 取得的 confirmation／generation。
- SSE `/api/v1/stream/data` 是共用 connection；SSE live 或 heartbeat 只能證明資料連線，不能證明每個 subscription 的 ownership 或完整性。

暫定的 client registry key 是 `code:quote_type`，但不能視為已證實的 Shioaji physical counting dimension。

### 4. Alert

- `src/lib/trigger-engine.ts:286-318` 的 notification-only alert engine 只以 `onAnyTick` 消費共用 SSE tick tape。
- Alert 沒有自己的 subscribe／unsubscribe 或 refcount；只有某個其他 owner 已訂閱相同商品時才可能收到 tick。

因此 alert 是邏輯 consumer，但目前無法在 subscription 層列出 demand 或證明其行情可用性。

### 5. 其他 RealTimeStock consumer

- `src/components/combo-ticket.tsx:175-187` 會對期貨／選擇權直接呼叫 Tick 與 BidAsk subscribe，沒有共用 consumer handle。
- `market-pulse-panel` 另有指數及 capability subscription；capability 路徑具有 browser-local `capabilityRefs`，但與一般商品 registry 分離。
- Tick tape、成交量分布、報價摘要與圖表多為 SSE consumer，不等於擁有或釋放 subscription。

本 change 雖只監控台股 STK，這些其他 consumer 仍可能占用同一 login／連線的官方資源，因此不能從 STK 名單外推剩餘 headroom。

### 6. MultiView 5174 local worker 路徑

- `apps/multiview/worker/local-shioaji-adapter.ts:1-18` 將 local adapter 限於最多 8 檔 request 範圍，health counters 只包含 accepted／rejected／upstreamErrors／activeStreams。
- `apps/multiview/worker/local-shioaji-adapter.ts:169-220` 允許 simulation-only 的 `/api/v1/stream/subscribe`、`unsubscribe` 與單一共用 SSE proxy，但沒有 server-side subscription registry。
- `apps/multiview/public/static/realtime-coordinator.js:660-676` 對每個可見商品只訂閱 Tick，並在 browser local `activeSymbols` 保存成功狀態。
- `apps/multiview/public/static/realtime-coordinator.js:738-747` 隱藏頁面或移除 demand 時 best-effort unsubscribe；失敗會被吞掉，因此 browser 無法確認 upstream physical subscription 已釋放。
- `apps/multiview/public/static/realtime-coordinator.js:750-775` 以 browser-local generation 防止舊事件覆寫，但該 generation 不會出現在 8080 global status。

當次 5174 health 為 `activeStreams=0`、realtime `subscriptionCount=0`、gateway unavailable；這只證明當時 worker／realtime hub 沒有 active stream，不證明 8080 沒有由其他 5174 browser 或先前失敗 unsubscribe 留下的 subscription。

### 7. MultiView Python gateway 路徑

- `apps/multiview/gateway/src/multichart_gateway/runtime_config.py:14-27` 固定 Shioaji 1.7.1，active universe 上限 32、subscription attempt 上限 128、Kbars daily limit 32。
- `apps/multiview/gateway/src/multichart_gateway/subscriptions.py:42-155` 可在該 Python process 內依 canonical symbol 保存 reference set、subscribed、in-flight 與 cooldown，並共用單一 upstream tick subscription。
- `apps/multiview/gateway/src/multichart_gateway/health.py:49-58` 的 loopback health 只公開 mode、state、reason、reconnect attempts 與 active-universe limit，沒有逐商品 refcount／physical key。

這套 manager 比瀏覽器路徑完整，但當次沒有 8788 listener，也沒有證據顯示它與 5173、5174 local worker 或 smart-order 共用同一 authority。

### 8. Smart-order quote coordinator

- `scripts/smart-order-runtime/quote-subscription-coordinator.mjs:9-24` 固定 160 tracked subscriptions，並把 Tick 與 BidAsk 視為不同 quote type。
- `scripts/smart-order-runtime/quote-subscription-coordinator.mjs:614-637` 以 contract＋quote type 建 aggregate，分開保存 runtime／browser demand Set、physical state、confirmation 與 resource reservation。
- `scripts/smart-order-runtime/quote-subscription-coordinator.mjs:839-912` 在 refcount 歸零後仍保留 unknown physical subscription，直到 transport lineage 被明確 invalidated；這符合 fail-closed 語意。
- coordinator 的回傳值反覆標示 `subscriptionTransportAuthority=false`，表示它本身只規劃／驗證，不能當成 5173、5174 與外部 client 的全域 transport authority。

當次 sidecar readiness 為 not-ready，且一般唯讀 runtime status 沒有逐 aggregate inventory；因此 smart-order 當期 contract、physical usage、refcount 與 generation 仍列為 unknown。

## 正規化 owner matrix

| owner class | contract | quote type | logical／physical key | refcount | generation | 當次狀態 | 完整性 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 5173 chart／contract cache | unknown | STK 通常 Tick＋BidAsk | client 暫存為 `code:quote_type`；physical dimension 未證實 | unknown | unknown | listener up | incomplete |
| 5173 watchlist | unknown | STK 通常 Tick＋BidAsk | hook 只以 code 去重；physical key 未證實 | unknown | unknown | listener up | incomplete |
| 5173 alert | 取決於既有 alert 與其他 owner | 消費 Tick，不自行 subscribe | 無獨立 key | 無可列舉 refcount | browser alert generation only | notification consumer | incomplete |
| 5173 other consumers | unknown | Tick／BidAsk／Quote／capability | registry 分散 | unknown | unknown | listener up | incomplete |
| 5174 local worker | health 未列商品 | STK Tick | browser-local symbol；physical key 未證實 | unknown | browser-local generation 未公開 | activeStreams 0 | incomplete |
| MultiView Python gateway | 當次未執行 | Tick per canonical symbol | process-local canonical symbol | process-local 可計但未執行 | process lifecycle only | 8788 absent | incomplete |
| smart order | unknown | Tick／BidAsk 分開 | coordinator contract＋quote type aggregate | unknown | unknown | sidecar not-ready | incomplete |
| 同 login 外部 client | unknown | unknown | unknown | unknown | unknown | 不可觀測 | incomplete |

## 8080 API 可見性結論

當次 OpenAPI 確認存在：

- `GET /api/v1/stream/status`
- `GET /api/v1/stream/receivers`
- `POST /api/v1/stream/subscribe`
- `POST /api/v1/stream/unsubscribe`
- 各類 SSE data endpoints

但沒有 subscription inventory endpoint。`GET /api/v1/stream/status` 只有 `active_connections`、`timestamp`、`status`；不能用 13 條 active connections 推導 13 個 subscriptions、13 檔商品或剩餘 187 額度。

## Gate 0 blocker 與後續輸入

本盤點已完成 owner 類別與責任鏈，但以下項目尚未證實，必須交由 1.2–1.6 處理：

1. Shioaji 200 上限的 counting dimension。
2. 8080 server 是否對重複 subscribe 去重，以及 unsubscribe 是否會移除其他 caller 的需求。
3. 同一 login 跨 5173、5174、sidecar、Python gateway 與外部 client 的共享範圍。
4. 可由單一 authority 列舉的 owner、physical key、refcount、connection generation 與 current usage。
5. unsubscribe timeout／失敗後的 physical state 與容量回收證據。

在上述項目未全部證實前：

- `gate0EvidenceCurrent = false`
- `globalOwnershipComplete = false`
- `activeCapacity = 0`
- `subscriptionTransportAuthority = false`
- 盤中監控只能保存 configured 名單，不得建立任何新即時 demand

## 可重現唯讀命令

```sh
pnpm local-runtime status
lsof -nP -iTCP:5173 -sTCP:LISTEN
lsof -nP -iTCP:5174 -sTCP:LISTEN
lsof -nP -iTCP:8080 -sTCP:LISTEN
lsof -nP -iTCP:8788 -sTCP:LISTEN
curl --fail --silent http://127.0.0.1:8080/api/v1/health
curl --fail --silent http://127.0.0.1:8080/api/v1/stream/status
curl --fail --silent http://127.0.0.1:8080/api/v1/stream/receivers
curl --fail --silent http://127.0.0.1:5174/api/health
```

這些命令只能證明 listener、business health、SSE connection count 及 allowlisted health counters；不得把其結果升格為全域 subscription ownership 證據。
