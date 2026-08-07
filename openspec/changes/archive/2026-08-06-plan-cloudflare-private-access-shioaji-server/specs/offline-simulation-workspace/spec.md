## MODIFIED Requirements

### Requirement: 服務不可用時允許進入工作區
當前端本身可載入，但 Cloudflare Access／Tunnel／Origin Gateway 不可用，或 Shioaji 本機 HTTP server 可回應但 server-backed watchlist 因 `SessionNotEstablished` 無法取得時，系統 MUST 結束全畫面載入狀態並渲染既有工作區。

#### Scenario: 模擬 session 未建立
- **WHEN** 初始 watchlist 請求回傳含有 `SessionNotEstablished` 的錯誤
- **THEN** 系統結束「載入交易終端…」並以空白 watchlist 進入工作區

#### Scenario: 後端短暫啟動競態
- **WHEN** 初始 watchlist 請求因非 `SessionNotEstablished` 的暫時性錯誤失敗
- **THEN** 系統先進行有限度退避重試，再於仍失敗時降級進入工作區

#### Scenario: 遠端傳輸或身分路徑失效
- **WHEN** 前端靜態資產已載入，但 Access session 過期、Tunnel 中斷或 Origin Gateway 不可用
- **THEN** 系統 MUST 在有限重試後進入既有工作區並維持離線狀態，不得無限停留在全畫面載入

### Requirement: 明確顯示離線或非服務時間
系統 MUST 在降級狀態下於頂部狀態與工作區提示列清楚指出遠端入口、Tunnel 或模擬服務離線，或可能處於非服務時間，且 MUST 說明行情、自選與交易功能暫不可用。HTTP health 200 或 Tunnel 可達不得單獨使狀態顯示 `LIVE`。

#### Scenario: 模擬 session 降級提示
- **WHEN** watchlist 初始化因 `SessionNotEstablished` 失敗
- **THEN** 頂部狀態不得顯示 `LIVE`，並顯示可辨識的離線狀態與繁體中文說明

#### Scenario: 遠端入口降級提示
- **WHEN** Access、Tunnel 或 Gateway 路徑失效，但前端仍可顯示既有畫面
- **THEN** 系統 MUST 顯示 `OFFLINE` 與對應的繁體中文原因，不得將 transport health 誤判為行情或交易可用

### Requirement: 服務恢復後可重新連線
系統 MUST 提供重新檢查操作，並在 Access session、Tunnel、Origin Gateway 與 Shioaji business session 皆恢復，且 watchlist 服務成功時載入 server-backed watchlist、清除離線提示並恢復正常狀態。重新檢查與 SSE 重連 MUST NOT 建立新的 Shioaji 登入。

#### Scenario: 手動重新檢查成功
- **WHEN** 使用者在完整服務路徑恢復後按下「重新檢查」且 watchlist 請求成功
- **THEN** 系統載入自選清單、解除離線提示並更新工作區資料，且沿用既有 server-side Shioaji session

#### Scenario: 手動重新檢查仍失敗
- **WHEN** 使用者按下「重新檢查」但 Access、Tunnel、Gateway 或 `SessionNotEstablished` 問題仍存在
- **THEN** 系統保留工作區與離線提示，不重新顯示全畫面載入狀態，也不得切換 production
