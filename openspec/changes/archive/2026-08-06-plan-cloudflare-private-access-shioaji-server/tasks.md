## 1. 實作授權與前置決策

- [ ] 1.1 取得使用者對本 change 的明確 apply 授權，並確認本輪僅執行哪一個里程碑；未獲授權不得建立 Cloudflare 資源或修改 runtime
- [ ] 1.2 重新核對 Cloudflare Access、Pages、Tunnel 的當期方案與配額，以及永豐對雲端代理、行情顯示與單一連線的使用限制
- [ ] 1.3 決定自訂網域與 host／path 拓樸、Google IdP 或 Email OTP、唯一允許帳號、Access session duration 與重新驗證頻率
- [ ] 1.4 確認小馬固定出口 IP、睡眠／斷電政策、24／7 可用性、服務自啟與純本機 rollback 程序

## 2. 本機安全基線與測試骨架

- [ ] 2.1 新增不含秘密的部署設定範例與環境驗證，固定 `SJ_PRODUCTION=false` 並拒絕任何 production 值
- [ ] 2.2 驗證 Shioaji server 僅綁 `127.0.0.1:8080`，外部網卡無法直接連線，並加入自動化檢查
- [ ] 2.3 建立秘密掃描與日誌遮罩測試，覆蓋前端 bundle、source map、URL、設定輸出、Access JWT、帳號及委託內容
- [ ] 2.4 建立 localhost 回歸測試，確認不啟用 Cloudflare 時既有 simulation 與離線工作區仍可使用

## 3. M2 靜態 Pages 與 Access 入口

- [ ] 3.1 建立獨立的 Cloudflare Pages 靜態建置設定，不注入 Shioaji Key、Secret、CA 或 Tunnel token
- [ ] 3.2 建立前端 Access application 與單一使用者 allow policy，禁止 Everyone／Bypass
- [ ] 3.3 驗證未授權請求在 Edge 被拒絕、已授權使用者可載入前端，且瀏覽器資產與網路請求不含秘密
- [ ] 3.4 記錄並演練 M2 rollback：停用 Pages custom domain／Access route 後 localhost 不受影響

## 4. M3 小馬 Origin Gateway 與 Tunnel

- [ ] 4.1 在小馬新增 Origin Gateway，限制 host、origin、method、content type、CORS、CSRF、速率與端點 allowlist
- [ ] 4.2 實作 Access JWT 簽章、issuer、audience 與到期驗證，驗證失敗或設定漂移時 fail closed
- [ ] 4.3 安裝並設定 `cloudflared` 主動建立 Tunnel，只把受保護的 API／SSE host／path 轉送至 Origin Gateway
- [ ] 4.4 將 Tunnel token 與必要本機秘密設為最小檔案權限，確認 repo、Cloudflare Pages 與一般日誌皆無秘密副本
- [ ] 4.5 驗證 Access 同時保護前端與 API／SSE，並確認 8080 沒有任何公開入站路徑

## 5. 單一 Shioaji session 與 SSE 契約

- [ ] 5.1 重構或驗證 Shioaji 登入生命週期只由 server 管理，多個瀏覽器分頁不得增加 `api.login()` 次數
- [ ] 5.2 為 API／SSE 加入去識別化 `X-Request-ID`、有限退避、`Last-Event-ID` 續接與重連上限
- [ ] 5.3 加入測試證明 SSE timeout、網路中斷、頁面重新整理及多分頁不會重登或重播交易副作用
- [ ] 5.4 以 Shioaji business session 與 server-backed 請求判定 `LIVE`，證明 HTTP health 200 或 Tunnel 可達不會誤判可用

## 6. 遠端離線工作區

- [ ] 6.1 擴充前端狀態模型，區分 Access session、Tunnel、Gateway 與 Shioaji business session 的離線原因
- [ ] 6.2 在頂部狀態與提示列顯示繁體中文 `OFFLINE`／非服務時間說明，禁止 transport health 單獨顯示 `LIVE`
- [ ] 6.3 擴充「重新檢查」流程，在完整路徑恢復後沿用既有 server-side session 並恢復 watchlist
- [ ] 6.4 加入 Access 過期、Tunnel 中斷、Gateway 503、`SessionNotEstablished` 與恢復流程的自動化測試

## 7. M4 受控模擬交易安全閘門

- [ ] 7.1 在修改型端點要求 `X-Idempotency-Key`，並實作同鍵回傳既有結果或拒絕重複副作用
- [ ] 7.2 實作 CSRF、simulation mode、端點能力及使用者二次確認的整合檢查
- [ ] 7.3 建立立即停止交易型端點、Tunnel 與 Shioaji server 的 kill switch，並以 simulation 演練復原
- [ ] 7.4 完成重送、逾時、部分失敗、瀏覽器重試與設定漂移的整合測試；所有案例不得切換 production

## 8. 觀測、安全驗收與交付

- [ ] 8.1 建立去識別化健康訊號與告警，分別監測 Access／Tunnel、Gateway、SSE 與 Shioaji business session
- [ ] 8.2 驗證未授權請求 100% 被阻擋、秘密掃描通過、日誌已遮罩且 Access／route／CORS／`SJ_PRODUCTION` 無漂移
- [ ] 8.3 逐頁驗收桌面與必要行動版介面，確認遠端 `OFFLINE`、恢復與多分頁行為可見且正確
- [ ] 8.4 文件化 rollback、kill switch、秘密輪替與純本機復原手冊，並完成最終 simulation 驗收
- [ ] 8.5 若未來要求正式環境、CA 或真實下單，停止本 change 的 scope，另開 OpenSpec 提案並取得使用者明確授權與必要合規確認
