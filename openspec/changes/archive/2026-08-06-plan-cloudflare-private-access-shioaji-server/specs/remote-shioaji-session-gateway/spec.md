## ADDED Requirements

### Requirement: Origin Gateway 必須重新驗證遠端請求
小馬 Origin Gateway MUST 驗證 Access JWT 的簽章、issuer 與 audience，並限制允許的 host、origin、method、content type、CORS、CSRF、速率與端點能力；任何驗證缺失或設定漂移 MUST fail closed。

#### Scenario: 唯讀請求通過雙重驗證
- **WHEN** Access Edge 已放行請求，且 Gateway 驗證 JWT、origin 與唯讀端點能力均通過
- **THEN** Gateway 才可把請求轉送至本機 Shioaji server

#### Scenario: 修改型請求缺少安全條件
- **WHEN** 請求缺少有效 CSRF、合法 origin、允許 method 或必要端點能力
- **THEN** Gateway MUST 拒絕請求，且不得呼叫 Shioaji server

### Requirement: 系統必須共用單一 simulation session
Shioaji server MUST 維持唯一的 simulation 登入並集中處理行情、帳務及經核准的模擬交易；瀏覽器分頁、HTTP 重試或 SSE 重連 MUST NOT 各自觸發 `api.login()`。

#### Scenario: 多個瀏覽器分頁連線
- **WHEN** 同一已授權使用者開啟多個前端分頁並建立 API／SSE 連線
- **THEN** 所有分頁 MUST 共用既有 server-side Shioaji session，登入數不得增加

#### Scenario: SSE 斷線重連
- **WHEN** SSE 因 timeout、網路中斷或部分錯誤而重連
- **THEN** client MUST 使用有上限的退避續接事件，且 MUST NOT 觸發新登入或重播交易副作用

### Requirement: 修改型請求必須具備冪等與二次安全閘門
任何未來經核准的模擬交易型請求 MUST 帶有 `X-Idempotency-Key`，Gateway MUST 對相同鍵回傳既有結果或拒絕重複副作用，並 MUST 通過 CSRF、端點能力、simulation mode 與使用者二次確認。

#### Scenario: 相同模擬委託重送
- **WHEN** Gateway 收到相同 `X-Idempotency-Key` 的模擬交易請求
- **THEN** 系統 MUST 回傳既有結果或明確拒絕，不得再次送出模擬委託

#### Scenario: SSE 或瀏覽器自動重試
- **WHEN** 瀏覽器重試、頁面重新整理或 SSE 重連發生
- **THEN** 系統 MUST NOT 依此建立新的交易副作用

### Requirement: production 與正式交易必須 fail closed
本 change 的所有遠端能力 MUST 固定使用 `SJ_PRODUCTION=false`；任何 production 設定、正式環境、CA 或真實交易要求 MUST 被拒絕，直到另案提案、合規確認與使用者明確授權完成。

#### Scenario: 設定出現 production 值
- **WHEN** Gateway 或 Shioaji server 載入 production 設定，或 request 嘗試指定 production mode
- **THEN** 交易型能力 MUST 拒絕啟動或拒絕請求，且不得自動 fallback 至正式環境

#### Scenario: simulation session 不可用
- **WHEN** simulation business session 未建立或必要依賴失敗
- **THEN** 系統 MUST 回傳離線／503 類型狀態，不得改用 production

### Requirement: 可用性必須以 Shioaji business session 判定
`LIVE` 狀態 MUST 以小馬上的 Shioaji business session 及必要 server-backed 請求成功為依據；Cloudflare Access、Tunnel 或 HTTP health 200 單獨成功 MUST NOT 被視為行情或交易可用。

#### Scenario: transport 可達但 business session 未建立
- **WHEN** Access、Tunnel 與 HTTP health 均可達，但 Shioaji 回報 `SessionNotEstablished`
- **THEN** Gateway MUST 回傳離線狀態，前端不得顯示 `LIVE`
