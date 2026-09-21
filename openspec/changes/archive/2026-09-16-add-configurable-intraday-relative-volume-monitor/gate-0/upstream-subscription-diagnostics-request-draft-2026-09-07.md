# 上游 subscription diagnostics 功能需求草稿

> 狀態：本機草稿，尚未送出。預定目標為 `Sinotrade/Shioaji` issue tracker；內容不含帳號、token、憑證或委託資料。

## 建議標題

`feat(http): expose correlated market-data subscription receipts and read-only inventory`

## 問題描述

Shioaji HTTP server 的 `POST /api/v1/stream/subscribe` 與 `unsubscribe` 目前回傳 `SubscriptionResponse { success, message, subscription }`，`GET /api/v1/stream/status` 只回報 SSE `active_connections`。在 simulation 1.7.1 的受控測試中：

- 同一 request 重複 unsubscribe 仍可回 `success=true`。
- 200 個不同 request key 後，第 201 個 request 仍可回 `success=true`。
- 無法由 response 判定 provider topic 已加入／移除、該 request 是否改變 physical state、目前使用量或剩餘 quota。
- 無法把 disconnect／server reconnect 與舊 subscription generation 明確分界。

官方 1.7.4 tag 的 `STREAMING.md` 也明確指出：unsubscribe 的 `success=true` 只應解讀為 accepted，不能自行推論剩餘訂閱狀態；`stream/status` 不能證明某個 symbol 已訂閱。

這使需要安全共用即時行情的多 consumer 應用無法在 200 subscriptions 限制內，證明去重、refcount、headroom 及 confirmed-before-reuse。

## 希望提供的唯讀／事件能力

請考慮提供版本化且不含帳務／交易權限的 diagnostics：

1. 每個 server market-data session 的 opaque `connection_generation`。
2. subscribe／unsubscribe response 的 opaque `operation_id` 及明確 `accepted` 狀態。
3. provider event SSE／receiver，逐筆包含：
   - `operation_id`
   - `connection_generation`
   - `action`：subscribe 或 unsubscribe
   - canonical contract、quote type、intraday odd lot
   - provider topic／physical key
   - event code、confirmed／rejected／unknown
   - event time
4. loopback read-only physical inventory，至少列出同一 generation 內的 canonical physical key、confirmation state，以及伺服器可證實的 usage/refcount。
5. 目前 quota 的正式 counting dimension 與 limit，包含 Tick／BidAsk／Quote、regular／odd lot、duplicate call 是否分別計數。
6. server/client disconnect、automatic reconnect 及 session replacement 後，舊 subscription 的失效／重建語意。

若安全考量不適合公開完整 topic，可回傳 session-scoped hash；但 operation、generation、action 與結果仍須可關聯。

## 建議最小 schema

```json
{
  "schema_version": "subscription_event/1",
  "operation_id": "opaque",
  "connection_generation": "opaque",
  "action": "subscribe",
  "contract": {
    "security_type": "STK",
    "exchange": "TSE",
    "code": "2330"
  },
  "quote_type": "Tick",
  "intraday_odd": false,
  "physical_key": "session-scoped opaque value",
  "event_code": 16,
  "state": "confirmed",
  "observed_at": "ISO-8601 timestamp"
}
```

## 驗收案例

- 同一商品相同 quote type 重複 subscribe：可判斷是否共用同一 physical item，以及 usage 是否變化。
- 同一商品 Tick 與 BidAsk：可判斷是兩個或一個 quota item。
- 兩個 HTTP clients 對相同 key subscribe，再分別 unsubscribe：每次 refcount／physical state 可觀察。
- 重複 unsubscribe：回傳 no-op／not-found／rejected 等可辨識終態，不誤報 physical release。
- 第 200／201 個實際 quota item：可由 confirmed inventory 與明確 rejection 重現 counting boundary。
- SSE client disconnect 與 market-data session reconnect：generation 前進，舊 receipt 不可套用至新 generation。

## 安全邊界

- diagnostics 限定 loopback 與 read-only。
- 不回傳 API key、secret、token、帳號、委託、成交或持倉。
- diagnostics GET 不建立 subscription、不登入、不啟停 server、不切換 production。
- subscription event 僅確認行情 transport，不授予 broker write authority。

## 本機重現資料

可在需要時提供去識別化的 request／response 摘要；不提供任何登入或帳戶資料。本草稿對應 RealTimeStock OpenSpec change `add-configurable-intraday-relative-volume-monitor` 的 Gate 0，功能目前維持 feature-off。
