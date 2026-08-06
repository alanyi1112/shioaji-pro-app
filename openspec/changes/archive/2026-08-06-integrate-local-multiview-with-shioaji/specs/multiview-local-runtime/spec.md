## ADDED Requirements

### Requirement: MultiView 必須是 loopback-only 的獨立本機服務
系統 MUST 以獨立 process 在 `127.0.0.1:5174` 提供 MultiView Web／Worker API，並 MUST 與 `127.0.0.1:5173` 的 RealTimeStock Web及 `127.0.0.1:8080` 的 Shioaji server 分離。MultiView 不得監聽 `0.0.0.0`、LAN 或公開網路介面。

#### Scenario: 啟動本機服務
- **WHEN** runtime 啟動 simulation 工作環境
- **THEN** 5173、5174 與 8080 分別由預期服務監聽 loopback
- **AND** MultiView health 回報本機 target、build revision、D1 可用性與不含秘密的服務狀態

#### Scenario: MultiView process 異常退出
- **WHEN** 5174 process 非預期退出
- **THEN** `launchd` MUST 有界重啟 MultiView，而 5173 與 8080 MUST 維持原狀

### Requirement: 本機 D1 狀態必須位於 repo 外並可安全遷移
MultiView 的 D1／Miniflare state MUST 放在權限受限的 Application Support 路徑或等效 repo 外位置。schema migration 或資料匯入前 MUST 建立可識別的備份，寫入 MUST 使用 transaction，完成後 MUST 執行 `PRAGMA integrity_check`、schema version 與代表資料 coverage 驗證。

#### Scenario: 首次啟動空白資料庫
- **WHEN** 本機 D1 尚不存在
- **THEN** 系統建立資料庫、套用所有必要 migration 並保留可重入 schema marker
- **AND** repo MUST NOT 出現 D1、SQLite、Miniflare state 或個人資料檔

#### Scenario: migration 中途失敗
- **WHEN** migration、seed 或 import 在 commit 前失敗
- **THEN** transaction MUST rollback 且原資料庫或備份仍可使用
- **AND** 狀態只輸出安全 reason code，不輸出資料列或個人識別

### Requirement: Shioaji proxy 必須永久採 data-only allowlist
MultiView server MUST 只在 8080 回報 simulation 時轉送商品契約查詢、Snapshot、Kbars、行情 SSE、行情 subscribe／unsubscribe 與必要 info／health。任何非 simulation 模式 MUST 對上述資料路徑回 `simulation_required`；任何 order、update、cancel、account、CA、token、server management 或未知 path／method MUST 在 5174 端拒絕且不得到達 8080。

#### Scenario: 合法 Snapshot 請求
- **WHEN** MultiView 以合法、有界的台灣商品 contract body 呼叫 Snapshot proxy
- **THEN** adapter 轉送到 loopback Shioaji API，驗證 response shape 後回傳
- **AND** log 只增加去識別化成功／失敗計數

#### Scenario: 嘗試經 adapter 下單
- **WHEN** client 對 5174 請求任何 `/order/`、`place_order`、`update_order` 或 `cancel_order` 路徑
- **THEN** adapter MUST 回 `403` 與安全 reason code
- **AND** 請求 MUST NOT 轉送到 Shioaji server

#### Scenario: 非 simulation 模式嘗試讀取行情
- **WHEN** 8080 `/info` 回報非 simulation，client 請求契約、Snapshot、Kbars 或串流
- **THEN** adapter MUST 回 `simulation_required` 且不得轉送目標資料請求
- **AND** MultiView MUST 顯示延遲 fallback 或本階段不支援狀態

#### Scenario: 未知路由或超量 body
- **WHEN** path、method、content type、symbol count、body size 或 response size 超出 allowlist contract
- **THEN** adapter MUST fail closed，且不得回傳內部 stack、secret 或完整行情 payload

### Requirement: MultiView 必須在 Shioaji 不可用時維持非即時功能
5174 Web／Worker、既有歷史、國外商品及盤後資料 MUST NOT 以 Shioaji login 或 business session 成功作為啟動必要條件。Shioaji API 停止或回 `SessionNotEstablished` 時，MultiView MUST 可載入並顯示明確延遲／離線狀態。

#### Scenario: 8080 未啟動
- **WHEN** 使用者開啟 MultiView 但 Shioaji server 沒有 listener
- **THEN** MultiView 顯示即時來源不可用並保留 Yahoo／盤後功能
- **AND** 頁面 MUST NOT 因 adapter 失敗停在全畫面 loading

#### Scenario: HTTP health 成功但 business session 失敗
- **WHEN** `/health` 或 SSE 可連線，但 Snapshot／Kbars 回 `SessionNotEstablished`
- **THEN** 系統 MUST 將 Shioaji 行情判定為不可用，而不是 `LIVE`
- **AND** 自動模式 MUST 進入可見的延遲 fallback

### Requirement: Runtime log 與狀態不得洩漏秘密或個人資料
MultiView process、LaunchAgent、D1 path、health、diagnostic、test artifact 與 log MUST NOT 包含 API key、secret、CA path／password、帳戶、email、完整 request body 或全量 Tick。必要秘密 MUST 由權限受限的本機 secret handle 注入並以 `[REDACTED_SECRET]` 表示其存在。

#### Scenario: 使用者執行 runtime status
- **WHEN** 使用者查詢本機 runtime 狀態
- **THEN** 輸出只包含模式、job、port、HTTP health、business availability、source mode、D1 integrity 摘要與安全計數
- **AND** 輸出 MUST NOT 包含秘密值、帳戶或個人清單內容
