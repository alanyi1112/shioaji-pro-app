## ADDED Requirements

### Requirement: 前端與 API 必須位於同一私人身分邊界
系統 MUST 使用 Cloudflare Access 保護 Pages 前端以及所有 API／SSE 公開路由，且 allow policy MUST 僅允許明確指定的單一使用者身分。

#### Scenario: 已授權使用者存取前端與 API
- **WHEN** 指定使用者完成 Access 驗證，且 session 與 application policy 皆有效
- **THEN** 系統允許其取得靜態前端，並在相同受保護範圍內呼叫 API／SSE

#### Scenario: 未授權或 policy 不符
- **WHEN** 請求缺少有效 Access session，或身分不在 allow policy 中
- **THEN** Cloudflare Edge MUST 拒絕請求，且請求不得抵達小馬 Origin Gateway

### Requirement: 小馬不得開放 Shioaji 入站連接埠
Shioaji server MUST 只綁定 `127.0.0.1:8080`；遠端 API／SSE 流量 MUST 由小馬主動建立的 Cloudflare Tunnel 轉送至 Origin Gateway，不得直接公開 8080。

#### Scenario: 遠端唯讀請求成功
- **WHEN** Tunnel 已由小馬建立、Access 驗證有效且 Origin Gateway 驗證通過
- **THEN** 請求經 Tunnel 到達 Gateway，再由本機路徑存取 Shioaji server

#### Scenario: Tunnel 中斷
- **WHEN** `cloudflared` 停止或 Tunnel route 不可用
- **THEN** 遠端 API／SSE MUST 不可達，但 localhost Shioaji server MUST 不得因此對外開放

### Requirement: 秘密只得存在小馬
Shioaji API Key、Secret、未來可能使用的 CA／密碼、Tunnel token 與完整帳務或委託內容 MUST NOT 出現在前端 bundle、Cloudflare Pages 靜態資產、公開 URL、repo 或一般日誌；必要秘密 MUST 只儲存在小馬且採最小檔案權限。

#### Scenario: 前端建置與部署檢查
- **WHEN** 建立 Pages 靜態資產
- **THEN** 秘密掃描 MUST 證明 bundle、source map、環境輸出與 URL 不含任何 Shioaji 或 Tunnel 秘密

#### Scenario: 錯誤與稽核日誌
- **WHEN** Access、Tunnel、Gateway 或 Shioaji 請求失敗
- **THEN** 日誌 MUST 僅保留去識別化 request ID、狀態與安全摘要，不得記錄秘密值、Access JWT 全文、帳號識別或完整委託內容

### Requirement: 文件化不得視為部署授權
系統規劃 MUST 將文件化、靜態入口、唯讀模擬及受控模擬交易拆成獨立里程碑；每個部署里程碑 MUST 取得使用者新的明確授權，且 MUST 提供可停止 Tunnel 並回復純本機模式的 rollback。

#### Scenario: 只有規劃核准
- **WHEN** 使用者只要求記錄可行方案而明確表示目前不實作
- **THEN** 系統 MUST 只產生文件與 OpenSpec artifacts，不得建立 Cloudflare 資源、部署或修改 runtime 設定

#### Scenario: 遠端入口需要回復
- **WHEN** Access、Tunnel、Gateway 或安全驗收失敗
- **THEN** 維運者 MUST 能停止 Tunnel／route 並回復 localhost 模式，而不切換 production 或刪除本機秘密
