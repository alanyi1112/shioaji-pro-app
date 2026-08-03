## Why

RealTimeStock 目前僅適合在小馬本機使用；若未來需要從外部瀏覽器安全存取，直接公開 Shioaji HTTP API 或把秘密放入前端都會破壞既有安全邊界。本提案先把可行架構、安全閘門與驗收順序記錄成可執行規劃，但目前不授權實作、部署或啟用正式交易。

## What Changes

- 規劃以 Cloudflare Pages 提供靜態前端，並以 Cloudflare Access 僅允許指定單一使用者存取前端與 API。
- 規劃由小馬上的 `cloudflared` 主動建立 Cloudflare Tunnel，把 API／SSE 流量轉送至僅綁定 `127.0.0.1:8080` 的本機服務。
- 規劃小馬 Origin Gateway 驗證 Access JWT、Origin、CORS、CSRF、速率限制、端點能力與修改型請求的冪等鍵。
- 規劃 Shioaji API Key、Secret、未來可能使用的 CA、帳務資料與唯一 business session 全部留在小馬；不得進入瀏覽器 bundle、Cloudflare 靜態資產、URL 或一般日誌。
- 固定第一階段為 `simulation` 與唯讀能力；任何 `production` 值、正式環境、CA 或真實下單需求均 fail closed，且必須另開提案並取得使用者明確授權。
- 擴充既有離線工作區契約：Access、Tunnel 或 Shioaji business session 不可用時必須顯示 `OFFLINE`，不得以 HTTP health 200 誤判為可用。
- 記錄可停止 Tunnel 並回復純本機模式的 kill switch 與分階段驗收門檻。
- 本 change 僅建立未來規劃，不執行 Cloudflare 設定、程式修改、部署、CA 安裝或 production 切換。

## Capabilities

### New Capabilities

- `cloudflare-private-access`: 定義 Cloudflare Pages、Access 與 Tunnel 的私人入口、身分邊界、秘密邊界、可回復性及部署閘門。
- `remote-shioaji-session-gateway`: 定義小馬 Origin Gateway、單一 Shioaji simulation session、API／SSE 安全契約、冪等、重連及 fail-closed 行為。

### Modified Capabilities

- `offline-simulation-workspace`: 將 Access、Tunnel 與遠端 Shioaji business session 失效納入離線判定、提示與重新檢查契約。

## Impact

- 未來可能影響 `src/` 的 API／SSE client、離線狀態與前端部署設定。
- 未來可能新增小馬 Origin Gateway、`cloudflared` 設定、Access application／policy、Pages project、網域、CORS／CSRF／JWT 與觀測設定。
- Shioaji server 仍在小馬執行，維持單一 simulation 登入；Cloudflare 不承載 Shioaji 原生程序或秘密。
- 必須另行確認 Cloudflare 方案限制、自訂網域、身分提供者、小馬固定出口 IP／可用性，以及永豐對雲端代理與行情使用範圍的要求。
- 目前無執行階段影響：不部署、不變更執行環境、不切 production、不處理真實委託。
