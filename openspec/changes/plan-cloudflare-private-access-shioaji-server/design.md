## Context

RealTimeStock 的 React／Vite 前端目前由小馬本機 `127.0.0.1:5173` 提供，Vite 將 `/api` 代理至僅在本機使用的 Shioaji server。Shioaji 登入、API Key／Secret、帳務資料與 business session 都在小馬；simulation session 未建立時，既有工作區會降級顯示 `OFFLINE`。

完整架構圖、決策表與里程碑另見 [RealTimeStock｜Cloudflare 私有前端與小馬 Shioaji Server 可行架構規劃](https://docs.google.com/document/d/1hdnfKnHBRIG-ZZKyiTezqOPWmutRDHTcsXVr0NVdkRI)。

未來若要從外部瀏覽器存取，系統需要同時保留以下邊界：

- 瀏覽器與 Cloudflare 靜態資產不得持有 Shioaji 秘密。
- 小馬不得開放 8080 入站連線。
- 前端與 API／SSE 必須由同一私人身分邊界保護。
- 多個瀏覽器分頁只能共用小馬上既有的單一 Shioaji session，SSE 重連不得觸發新的 `api.login()`。
- 規劃階段固定 `simulation`；正式環境、CA 與真實下單不在本 change 的授權範圍。

建議資料流：

```text
指定使用者瀏覽器
  -> Cloudflare Access
     -> Pages 靜態前端
     -> Tunnel（API／SSE）
        -> 小馬 cloudflared
           -> Origin Gateway
              -> 127.0.0.1:8080 Shioaji server（單一 simulation session）
                 -> 永豐 Shioaji API
```

## Goals / Non-Goals

**Goals:**

- 定義單一使用者的 Cloudflare 私人前端與安全 API／SSE 路徑。
- 保留秘密只在小馬、8080 只綁 loopback、單一 Shioaji simulation session 的安全邊界。
- 定義 Access JWT、Origin、CORS、CSRF、速率限制、端點能力與冪等契約。
- 定義 `OFFLINE` 判定、有限重連、觀測、kill switch 與純本機回復路徑。
- 建立先靜態、再唯讀 simulation、最後才評估受控模擬交易的分階段驗收順序。

**Non-Goals:**

- 不在本 change 內修改程式、建立 Cloudflare 資源、部署、安裝 CA 或切換 production。
- 不支援多人共用 Key、多使用者交易服務或公開行情散布。
- 不把 Shioaji server 移至 Workers、Pages Functions 或 Cloudflare Containers。
- 不授權正式委託、production fallback 或任何自動切換正式環境的行為。

## Decisions

### 1. Pages 與 Access 同時保護前端和 API

前端採 Cloudflare Pages 靜態託管；Pages host 與 API host／path 都納入 Access application 及明確 allow policy，只允許指定單一使用者。未授權請求必須在 Cloudflare Edge 即被拒絕，Origin Gateway 仍必須驗證 `Cf-Access-Jwt-Assertion` 的簽章、issuer 與 audience，避免把 Edge 驗證當成唯一防線。

替代方案是只保護前端或使用公開 API。這會讓攻擊者可繞過 UI 直接呼叫 API，因此不採用。

### 2. Tunnel 只做加密轉送，Shioaji server 留在小馬

小馬的 `cloudflared` 主動建立 outbound-only Tunnel；公開 host 只路由至本機 Origin Gateway，Shioaji server 仍只綁 `127.0.0.1:8080`。Tunnel token 只存在小馬，且不得進入 repo、Pages 變數或一般日誌。

替代方案包含直接開放 8080、把 Shioaji server 放入 Workers，或使用 Cloudflare Containers。前兩者分別破壞安全邊界及不符合原生常駐 Shioaji／Solace session；Containers 會增加付費、scale-to-zero、秘密與交易 session 進入第三方雲端等成本，皆不符合目前最小變更原則。

### 3. 小馬 Origin Gateway 是第二道安全閘門

Gateway 負責：

- 限制允許的 host、origin、HTTP method、content type 與端點能力。
- 驗證 Access JWT audience；拒絕遺失、過期或不符 policy 的 token。
- 對瀏覽器修改型請求驗證 CSRF，並限制 CORS 至明確列出的前端網域。
- 產生／傳遞去識別化 `X-Request-ID`，套用速率限制及最小化稽核日誌。
- 要求修改型請求具有 `X-Idempotency-Key`，同一鍵不得造成重複副作用。
- 當設定漂移、驗證失敗或 session 不可用時 fail closed。

Gateway 不保存 Shioaji API Key、Secret、CA 密碼、Access JWT 全文或完整委託內容。

### 4. Shioaji 維持單一 simulation session

Shioaji server 在程序啟動時建立唯一登入並統一處理行情、帳務與未來受控的模擬交易。瀏覽器分頁只建立 HTTP／SSE client，不得各自觸發 `api.login()`。SSE 可使用 `Last-Event-ID` 與有上限的退避重連，但不得依重連事件重播交易副作用。

是否 `LIVE` 必須以 Shioaji business session 及必要 server-backed 請求為依據；HTTP health 200 或 Tunnel 可達不代表行情／交易可用。

### 5. production 永遠由新提案與新部署授權

此規劃固定 `SJ_PRODUCTION=false`。若 request、環境變數或設定出現 production 值，Gateway 與後端都必須拒絕啟動交易型能力。正式環境、CA、真實委託、雲端代理使用範圍及行情授權須另案確認，不由本 change 或 M4 里程碑隱含授權。

### 6. 分階段遷移，任一階段可回復純本機

日後若使用者明確核准 apply，順序為：

1. M1 文件化：本 System Design 與 OpenSpec change，狀態維持未實作。
2. M2 靜態入口：Pages + Access，尚未連接 Shioaji API；驗證唯一身分與 bundle 無秘密。
3. M3 唯讀模擬：Tunnel + Gateway + 唯讀 simulation API／SSE；驗證 8080 不公開、OFFLINE 正確、SSE 重連不增加登入。
4. M4 受控模擬交易：完成 CSRF、冪等、二次確認、kill switch、稽核及安全驗收後，才可評估模擬委託。

任何階段都能停用 Tunnel／Pages route，回復既有 localhost 使用模式。每個里程碑必須有獨立核准，不得將文件化視為部署授權。

## Risks / Trade-offs

- [小馬睡眠、斷電或網路中斷造成遠端不可用] → 前端明確顯示 `OFFLINE`、採有限退避、保留純本機回復與可見 Tunnel 健康訊號。
- [Access policy 或 route 漂移意外擴大存取] → 禁止 Everyone／Bypass、定期檢查 drift、Gateway 再驗 JWT audience 及 origin，異常即 fail closed。
- [SSE 重連風暴增加登入或重複交易] → Shioaji 登入只在 server 端管理、重連有上限、修改型端點要求冪等鍵，SSE 不攜帶副作用重播。
- [秘密或帳務資料外洩至前端、Cloudflare 或日誌] → 秘密只存小馬、bundle／設定／日誌做掃描與遮罩，Cloudflare 僅轉送介面所需資料。
- [免費方案配額或產品條款變更] → apply 前重新核對 Cloudflare 官方方案、Access 使用者上限、Tunnel／Pages 配額與永豐使用規定。
- [固定 IP 綁定誤解] → 若永豐 Key 綁定出口 IP，應綁小馬連往永豐的固定出口 IP，而非 Cloudflare Edge IP。
- [安全設計增加維運複雜度] → 先唯讀、分階段啟用、保留 kill switch；若個人 VPN 更簡單且符合需求，重新評估替代方案。

## Migration Plan

目前只完成 M1 文件化，不建立或變更任何 runtime 資源。日後每次 apply 都必須先確認當次 scope，並遵循以下 rollback：

- M2 失敗：移除／停用 Pages custom domain 或 Access application，localhost 不受影響。
- M3 失敗：停止 `cloudflared`、停用 Tunnel route，保持 Shioaji server 只在 loopback 使用。
- M4 失敗：立即停用交易型端點與 Tunnel；simulation session 可由本機流程復原，禁止切換 production。

不得在 rollback 時刪除或覆寫本機秘密；日誌只保留去識別化診斷。

## Open Questions

- 正式採用單一 host 的 `/api`，或同一 Access application 內的 app／api 多網域？
- 身分驗證採 Google IdP 或 Email OTP？唯一允許帳號、session duration 與重新驗證頻率為何？
- 小馬是否具備固定出口 IP、24／7 運作與 SSE 長連線所需的斷電／睡眠復原能力？
- 未來正式環境前，是否需要永豐書面確認雲端代理與行情使用範圍？
- 受控模擬交易的二次確認 UX、kill switch 與最終核准人為何？
