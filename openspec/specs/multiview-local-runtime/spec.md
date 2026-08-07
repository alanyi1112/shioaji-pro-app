# multiview-local-runtime Specification

## Purpose
TBD - created by archiving change integrate-local-multiview-with-shioaji. Update Purpose after archive.
## Requirements
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

### Requirement: 本機 D1 seed 報告必須去識別化且可重現
系統 MUST 在 Application Support 保存不含資料內容的 seed report，記錄 schema revision、allowlist table、remote／staging／local row count、date coverage、material hash、備份識別、結果與 allowlist reason code。報告 MUST NOT 包含 SQL values、完整 symbol 清單、email、user ID、Access／audit、secret、credential、帳戶或交易資料。

#### Scenario: 查看 seed 結果
- **WHEN** 使用者或 runtime status 讀取最近一次 seed report
- **THEN** 系統 MUST 分資料族群顯示 completed／partial／pending／blocked、source date、processed 與 remaining 安全摘要
- **AND** 不得只因 D1 可開啟或 integrity 為 ok 就顯示盤後資料完整

### Requirement: 市場資料匯入不得破壞本機個人狀態
市場資料 seed、restore 與 bounded backfill MUST 與 `user_tabs`、`user_instruments` 及 RealTimeStock watchlist 隔離。任何市場資料 transaction 前後 MUST 比對本機個人清單 row count 與 material hash，差異時 MUST rollback 或停止啟用。

#### Scenario: 匯入市場資料
- **WHEN** allowlist staging DB 合併至 live DB
- **THEN** 個人清單 row count、tab／instrument 排序與 material hash MUST 保持不變
- **AND** 不得建立或修改 Access、audit 或交易資料

### Requirement: MultiView 必須提供去識別化的 document-local 驗收計數
MultiView MUST 在目前 browser document 維護固定版本的安全驗收快照，內容只得包含 panel、SSE、canonical demand、subscribe、unsubscribe、行情 request、indicator full-recompute、render churn、long task、bounded duration、JS heap 可用性／總量與 allowlist reason code。快照 MUST NOT 包含商品代號清單、行情內容、個人清單、帳戶、CA、token、secret 或可回推出個人的時間序列。

#### Scenario: 八圖含重複商品
- **WHEN** 同一 document 顯示八圖且至少兩圖為相同 canonical 商品
- **THEN** 驗收快照 MUST 顯示一條 document SSE，且 active canonical demand 不得因重複 panel 增加

#### Scenario: 讀取驗收快照
- **WHEN** 本機 browser 驗收工具讀取快照
- **THEN** 系統 MUST 回傳固定安全 schema 與 bounded 計數
- **AND** schema 測試 MUST 拒絕 symbol、quote、account、credential 或任意未列名欄位

### Requirement: 多圖效能驗收必須保存可重現證據
系統 MUST 對 1／2／3／4／6／8 圖、重複商品、快速切換與背景／前景循環保存 panel、SSE、subscription、request、render、long task、JS heap 可用性與畫面錯誤摘要。平台不支援的數值 MUST 標示 `unsupported`，不得補造數值。

#### Scenario: 完成多圖矩陣
- **WHEN** 驗收工具依序完成所有圖數與 lifecycle 情境
- **THEN** 證據 MUST 證明 SSE 不超過一條、重複商品訂閱去重、舊 demand 可釋放、無未處理錯誤且指標結果保持一致

### Requirement: MultiView 必須在 simulation session 恢復後重新協調目前 demand
每份 MultiView document MUST 維持至多一條 Shioaji SSE，並 MUST 在 SSE open、週期 mode check、visibility 恢復與 browser online 時，比對目前 `desired` demand 與已完成 Snapshot／Kbars bootstrap 的 `active` subscription。對缺少的 demand，系統 MUST 執行 per-symbol single-flight、有界退避的重新訂閱；只有合法 business response 完成後才能將商品標為 active 或恢復 Shioaji 即時狀態。

#### Scenario: API 重啟後 SSE 早於 business session 恢復
- **WHEN** simulation API 重啟、SSE 已重新 open，但缺少商品的 subscribe、Snapshot 或 Kbars 仍回傳 `SessionNotEstablished`
- **THEN** MultiView 保留該商品為非 active 並依有界退避補訂閱，不得因 SSE open 宣稱即時行情已恢復

#### Scenario: 缺少 demand 後續恢復成功
- **WHEN** 目前仍可見商品的補訂閱與必要 Snapshot／Kbars bootstrap 成功
- **THEN** MultiView 將該商品加入 active set，套用合法來源時間的 Shioaji snapshot，並自動恢復即時狀態

#### Scenario: 補訂閱持續失敗
- **WHEN** business session 尚未恢復或 provider 持續拒絕 subscribe／Snapshot／Kbars
- **THEN** 自動來源模式維持 Yahoo 完整 snapshot 延遲備援，明確 Shioaji-only 模式維持不可用提示
- **AND** coordinator 不得建立第二條 SSE、重複同商品的 in-flight request 或無界重試

#### Scenario: 多 panel 使用相同商品
- **WHEN** 多個 panel 在 API 恢復期間要求相同 canonical 商品
- **THEN** coordinator 只建立一個該商品的補訂閱流程，成功後由相同 active subscription 服務所有 demand

### Requirement: Watchdog 重啟不得破壞 MultiView 非即時能力與本機資料
simulation API watchdog 重啟期間，5174 process、既有歷史、國外商品、Yahoo 延遲來源、盤後資料與 D1 MUST 維持可用且不得被 runtime 重設。recovery 流程 MUST 延續既有 data-only allowlist，不得新增 order、account、CA、token 或 server-management proxy。

#### Scenario: Watchdog 重啟 8080
- **WHEN** runtime 因符合門檻的 `SessionNotEstablished` recovery incident 重啟 simulation API
- **THEN** 5174 listener、D1 integrity／coverage、個人清單與盤後 pipeline 狀態保持不變
- **AND** 台股即時來源在中斷期間顯示延遲備援或不可用，不阻斷其他資料功能

#### Scenario: Session 恢復後重新啟用即時來源
- **WHEN** 8080 business probe 與目前 demand 的 Snapshot／Kbars bootstrap 均恢復成功
- **THEN** MultiView 自動恢復 Shioaji data-only 行情，且不得呼叫任何交易、帳務、CA 或 server-management 路徑
