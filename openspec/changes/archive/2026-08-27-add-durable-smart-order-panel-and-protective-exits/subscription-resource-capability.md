# Shioaji 全域資源 ownership／usage 能力判定

- 版本：`smart-order-subscription-resource-capability/2026-08-22.2`
- 查核日期：2026-08-22（Asia/Taipei）
- 對應任務：Task 0.16、Task 5.10
- 結果：`blocked_unknown_shared_ownership`
- production 決策：smart-order 新增行情 subscription 與 write master 維持 disabled／off-wire

## 官方限制重新查核

[Shioaji Use Restrictions](https://sinotrade.github.io/tutor/limit/) 於本次查核仍明列：

- 盤中即時行情應使用 `api.subscribe()` 或 SSE，不得以輪詢 `snapshots`、`ticks`、`kbars` 代替；order／deal 應以 callback 或 SSE 為主，不應輪詢 `update_status()`。
- market data 為每 10 秒最多 50 次、accounting 為每 5 秒最多 25 次、orders 為每 10 秒最多 250 次。
- `api.subscribe()` 最多 200 subscriptions、每個 `person_id` 最多 5 個 connections、`api.login()` 每日最多 1000 次。
- `api.usage()` 公開投影只有 connections、bytes、limit bytes 與 remaining bytes，沒有 subscription item 的逐項 ownership／usage。

官方頁面沒有定義「200 subscriptions」的 Tick／BidAsk／商品等實際計數維度，也沒有提供跨 process／client 的 subscription 清單。因此本專案不得把 200 解讀為「200 個標的」，亦不得宣稱已證明它是同一 login 可由本機完整列舉的共享池。

## RealTimeStock consumer 盤點

| consumer | 可否由目前單一 authoritative ledger 完整列舉 | 判定 |
|---|---:|---|
| 5173 workspace | 否 | browser lifecycle、面板與圖表需求沒有由同一 server ledger 提供完整 usage snapshot。 |
| 5174 MultiView | 否 | 為另一個本機 consumer／process 邊界，current sidecar 無法證明其全部 active subscriptions。 |
| charts | 否 | 可找到 production callsite，但無法由 smart-order Runtime 證明所有視窗與重連後的實際共享計數。 |
| watchlist | 否 | 同上；source inventory 不等於 current live usage。 |
| alerts | 否 | 同上；browser／舊頁面需求無 authoritative complete-set head。 |
| smart_order_runtime | 是，僅限自身 | `quote-subscription-coordinator` 可 refcount／dedupe Runtime 自己的 demand，但不能把自身 ledger 冒充全域 ledger。 |
| external_clients | 否 | 券商 App、其他 Shioaji client 或同帳號其他程序不在 RealTimeStock 控制面內。 |

只要任一列為未知，`ownershipComplete=false`、`usageComplete=false`、`sharedPoolVerified=false`。目前沒有資格產生 `executionMode=live-readonly`、`overall=pass` 的 subscription ownership evidence，也不能簽發 160／40 admission handle。

## operation bucket 判定

官方將 `update_status` 與 place／update／cancel 列入 orders bucket，position／balance／PnL 類讀取列入 accounting bucket，歷史／snapshot 類列入 market-data bucket；但一個 reconciliation operation 可能同時包含 status、trades、positions、working set、fee／tax 等多個 transport call。current production 尚無可信 complete-set operation-to-bucket usage issuer，因此：

- caller 不得提供 bucket hint；未知 operation kind 一律拒絕。
- 所有已分類 Runtime operation 先共用 rolling 每秒最多 5 筆的保守 limiter，不宣稱取代官方各 bucket 上限。
- bounded queue 固定保留 reconciliation／status 與 cancel／reduce-only protection capacity；new exposure 最低優先，但 weighted cycle 防止永久飢餓。
- scheduler grant 只代表進入 bounded queue 的執行權，不預付 transport 額度；observer JSON／SSE、mode `/api/v1/info`、Gate probe JSON／SSE，以及 Node-safe adapter 的 target read／write，均須在每次實際 first-byte 前由同一 module-issued coordinator 逐一取得 operation unit，禁止 grouped undercount。
- 一旦 write 可能已送出 bytes，timeout／connection error 只可轉 unknown／reconciling，原 operation 不重排、不重送。

## 可機械驗收的 production 決策

1. managed sidecar 必須實際建構 module-issued resource coordinator，不得再以 `null` 當作未接線替代。
2. 在本文件的 negative capability 結果下，quote coordinator 雖已接到 resource capability，任何 demand 都必須得到 `subscription_ownership_unverified`，不得形成 subscribe plan 或 transport byte。
3. broker dispatch 必須在 adapter 前取得 server-derived operation classification與 resource queue grant；queue／rate／classification 任一失敗都必須在 adapter byte 前 durable fail closed。
4. coordinator status、Runtime status 與 sidecar status 均不得宣稱 write master 或 broker authority。
5. 禁止以 `snapshots`、`ticks`、`kbars` polling fallback 補足行情。
6. managed sidecar 的同一 coordinator 必須同時注入 quote coordinator、trade observer、mode admission、Gate probe、broker dispatch 與 Node-safe adapter；任何獨立 fallback coordinator 或 caller-supplied unit 都視為 fail closed。

此 negative capability closure 完成 Task 0.16 的「驗證並在無法計入時停用」責任，但不代表共享 subscription ownership 已知。Task 5.10 以 production-wired bounded queue、保守 rolling 5/s 與 per-first-byte admission 完成未知 bucket 期間的安全 coordinator；subscription usage 未知仍拒絕 160／40 handle。未來只有新的可信 complete-set live evidence 同時覆蓋上述七類 consumer、實際 counting dimension 與 current fingerprint，才可另行簽發 160／40 admission；本文件本身永遠不得作為 positive Gate conjunct。
