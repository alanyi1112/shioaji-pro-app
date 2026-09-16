# Gate 0：共用 subscription transport authority 決策

## 決策摘要

- 對應任務：1.5
- 決策：盤中監控的共用 transport authority 應落在**獨立、本機、data-only 的 quote subscription authority sidecar**，由既有 local runtime 管理生命週期，但不與 Shioaji login、MultiView gateway 或 smart-order broker-write authority 合併。
- 當前狀態：此 authority 尚未實作，既有 owner 也尚未遷移，因此 Gate 0 仍為 no-go。
- hosted target：永遠 feature-off；authority 只接受固定 loopback client，且只代理行情 subscription／stream，不接受任何 order、account、position、CA 或 production mutation。

## 現況拓樸

```text
5173 browser ────────┐
                     ├─ 直接 POST subscribe/unsubscribe ─┐
5174 browser → Node ─┘                                   │
                                                         ├─ Shioaji HTTP 8080 → 同一 login
smart-order sidecar ─ 直接 POST + 自有 local coordinator ┘

Python MultiView gateway（當次未啟動）→ 另有 process-local manager
外部 client → 可直接連 8080，當前不可列舉
```

此拓樸沒有單一 owner registry。8080 只提供 request-level success 與 SSE connection count，不提供 physical subscriptions、refcount、generation 或 unsubscribe confirmation。

## 目標拓樸

```text
5173 chart/watchlist/alert ─┐
5174 MultiView ────────────┼─ demand handle ─→ local quote authority ─→ Shioaji HTTP 8080
smart-order quote demand ──┘                         │
                                                    ├─ physical key inventory
                                                    ├─ generation/refcount/priority
                                                    ├─ subscribe state + receipt evidence
                                                    └─ one normalized data stream fan-out
```

authority 必須：

1. 以 `connection generation + canonical contract + quote type + intraday_odd` 建立 physical key。
2. 只接受不可偽造、具 owner identity 與 lease 的 demand handle。
3. 對相同 physical key 去重，保存 consumer refcount 與 priority。
4. 將 `planned`、`request_sent`、`confirmed`、`unknown`、`unsubscribe_pending`、`released` 分開，不以 HTTP 200 單獨確認釋放。
5. 公開不含秘密值的 loopback read-only inventory／capacity diagnostics。
6. 以一個 normalized SSE fan-out 供各 consumer 使用，避免每個頁面再建立無法回收的 8080 SSE。
7. Gate 0、外部 bypass、generation 或 inventory 不確定時，拒絕 intraday monitor demand，但不得中斷既有高優先 demand。

## 為何不選其他落點

### 不直接以 Shioaji HTTP 8080 作 authority

8080 是不能由本專案補上 refcount／owner inventory 的上游 binary。它對重複 unsubscribe 仍回 `success=true`，也沒有逐 subscription diagnostics；只能作 provider transport，不能作本應用程式的 ownership authority。

### 不以 5173 browser 作 authority

browser module-local Set 無法跨分頁、5174、sidecar 或 browser crash；`beforeunload` 也不是可靠 cleanup。前端只能是 consumer，不能持有 physical truth。

### 不以 5174 local worker／Durable Object 作 authority

5174 local adapter 目前只代理 request，health counter 與實際 8080 connection 已出現不一致；Durable Object／hosted worker 也不應取得本機 Shioaji session。它可作 consumer 或 fan-out client，不能作 local login 的 authority。

### 不直接把 smart-order coordinator 升格

既有 smart-order coordinator 有良好的 unknown-resource reservation 與 fail-closed 規則，但其 contract 明示 `subscriptionTransportAuthority=false`，且 smart-order 是 safety-critical 邊界。直接擴權會把一般 UI demand 與安全功能綁在同一控制面。目標 sidecar可重用經 contract tests 證實的純 coordinator invariants，但 smart-order broker-write authority 必須維持獨立且不得被放寬。

### 不以 Python MultiView gateway 作全域 authority

該 gateway 有自己的 32 檔 active universe 與 process-local refcount，但當次沒有執行，且 5173、5174 local adapter、smart-order 不受其控制。強行採用會造成第二套 ownership truth。

## 遷移前置條件

這項架構決策不代表可立刻啟用。實作 authority 前仍需：

- 先完成 1.2 的 counting dimension 與 transport confirmation；若上游無可取得的 event receipt，authority 必須將結果維持 unknown。
- 完成 1.4 的 bootstrap 成本與完整度量測。
- 逐一將 5173、5174 與 smart-order quote demand 改為 authority client，並以 contract tests 固定既有優先級與安全不變量。
- 對直接連 8080 的外部 client 建立明確排他規則或可觀測證據；無法排除 bypass 時，盤中監控 capacity 固定為 0。
- 正常 close、browser crash、sidecar restart、8080 reconnect 與 response timeout 都要造成 generation rollover，舊 handle 不可釋放新 generation 的資源。

## 生命週期與 rollback

- local runtime 可管理 sidecar 是否 loaded，但「盤中選股」頁面只建立／續期 lease，不自行啟停 simulation API、5173 或 5174。
- 最後 lease 消失只釋放 intraday-only demand，不停止 authority，也不影響 chart／alert／smart-order。
- rollback 先拒絕新 intraday lease，將 intraday demand 降為 release pending，待 transport confirmation 或 generation invalidation 後才回收容量。
- 任何錯誤都保持 feature-off；不得自動切 production、登入第二個 session或改走 polling。
