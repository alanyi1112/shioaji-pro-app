# multiview-order-ticket-bridge Specification

## Purpose
TBD - created by archiving change integrate-local-multiview-with-shioaji. Update Purpose after archive.
## Requirements
### Requirement: 主圖右鍵選單必須提供有界的下單入口
MultiView 主圖右鍵選單 MUST 新增「下單」，且只有已成功解析為 RealTimeStock 可交易台灣契約、非 IND 且商品代碼通過 allowlist 時才可啟用。非台股、IND、解析失敗或不支援 contract MUST 顯示停用原因。

#### Scenario: 台股可交易商品開啟選單
- **WHEN** 使用者在已解析的 STK 或 WRT 主圖按右鍵
- **THEN** 選單顯示可操作的「下單」並以目前 panel 商品為目標

#### Scenario: 指數或國外商品開啟選單
- **WHEN** 使用者在 IND、非台股或無法解析商品按右鍵
- **THEN** 「下單」MUST 停用或不顯示，並提供不支援原因

### Requirement: 下單橋接只能傳遞最小商品識別
click「下單」MUST 在目前 MultiView 頁面疊加合適大小的 modal，並於其中顯示 RealTimeStock 既有 OrderTicket；MUST NOT 另開分頁或視窗。iframe URL 只允許 contract code 與必要 security type／exchange。account、side、price、quantity、price type、order type、CA、token 或任何可直接形成委託的欄位 MUST NOT 由 MultiView 傳遞。

#### Scenario: 從 2330.TW 開啟下單面板
- **WHEN** 使用者點擊 `2330.TW` 的「下單」
- **THEN** 同頁 modal 內的 RealTimeStock ticket 重新解析 `2330` contract 並顯示既有 OrderTicket
- **AND** 買賣別、價格、數量與帳戶 MUST 由既有 ticket 狀態／使用者操作決定

#### Scenario: 嘗試注入交易參數
- **WHEN** query、postMessage 或 BroadcastChannel payload 含 side、price、quantity、account 或 order action
- **THEN** bridge schema MUST 拒絕整個 payload，且不得開啟預填交易狀態或送出 request

### Requirement: MultiView 不得擁有或呼叫交易 API
`apps/multiview/` 的 runtime code、adapter、dependency、test fixture 與 build MUST NOT import RealTimeStock 交易函式或呼叫 place／update／cancel order。所有模擬委託能力 MUST 留在 5173 的既有 OrderTicket、帳戶、風控與 simulation guard；非 simulation 模式不得解析橋接契約或開啟 ticket。

#### Scenario: Adapter 路由掃描
- **WHEN** build 或安全測試掃描 MultiView route、client request 與 bundle
- **THEN** 不得發現可達的 order proxy 或直接交易 request
- **AND** 對任何 order path 的動態 request MUST 在 5174 回 `403`

#### Scenario: 非 simulation 模式嘗試開啟 ticket
- **WHEN** 8080 回報非 simulation 且使用者從 MultiView 開啟 OrderTicket
- **THEN** adapter MUST 回 `simulation_required`，bridge MUST NOT 解析商品或探測 5173
- **AND** MultiView MUST 顯示本階段僅支援 simulation，不得提供繞過方式

### Requirement: 下單面板開啟失敗必須安全且可恢復
同頁 modal／iframe 無法建立、5173 未啟動、contract 無法解析或 bridge timeout MUST 只產生可見錯誤與重試／開啟 RealTimeStock 指引，不得 fallback 成直接交易、改用未驗證商品或反覆建立面板。

#### Scenario: 同頁下單容器無法建立
- **WHEN** modal 或 iframe 不可用
- **THEN** MultiView 顯示「下單面板未開啟」與手動操作提示
- **AND** 不得發出任何交易 API request

#### Scenario: RealTimeStock 尚未啟動
- **WHEN** 5173 無 listener 或 OrderTicket 無法載入
- **THEN** 同頁 modal 或 MultiView 顯示本機服務未啟動，商品與目前圖表保持不變

### Requirement: 真實下單能力必須留待獨立 change
本 change MUST 只驗證 simulation 下單面板連動，不得取得正式環境行情、建立或啟用 `production-trading`。未來正式環境行情或真實交易 MUST 另立 change，明確涵蓋授權、Shioaji 文件簽署、simulation 測試、Trading 權限、CA、中央模式、風控、idempotency、kill switch、稽核與人工啟用。

#### Scenario: 本 change 進入驗收
- **WHEN** 實作者執行本 change 的端到端驗收
- **THEN** runtime MUST 維持 simulation，CA MUST 維持未載入且不得送出真實委託
- **AND** 真實 order task MUST 不存在或維持明確 out of scope
