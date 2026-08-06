## Why

MultiView 已完成本機整合與主要 simulation 功能，但服務未啟動時的可見診斷、多圖效能與訂閱去重證據、完整來源切換驗收，以及 macOS 本機生命週期仍缺乏可重現的終態證據。若不補齊，使用者遇到 5174、Shioaji 或盤後資料故障時仍難以判斷問題層級，也不能確認八圖長時間使用的資源邊界。

## What Changes

- 由 RealTimeStock 提供不依賴 5174 的 MultiView 啟動／診斷頁，區分 5174 未啟動、Shioaji business session 離線、Yahoo 延遲 fallback、盤後資料異常與正常可用，並提供精確重試或修復指引。
- 為 MultiView 增加只含去識別化計數的本機觀測資料，保存 document SSE 數、canonical symbol demand、subscribe／unsubscribe、行情 request、indicator full-recompute 對照、render churn 與 bounded timing，不輸出商品清單、行情內容或個人資料。
- 以 1／2／3／4／6／8 圖、重複商品、快速切換、背景／前景循環完成 CPU、記憶體、訂閱去重、指標一致性與畫面穩定度驗收。
- 在 simulation 完成版面新分頁、日／週／月、兩套獨立清單、非台股原 provider、台股即時／延遲／斷線 fallback、canonical handoff、技術指標及右鍵 OrderTicket 的人工矩陣。
- 以 repo 外的臨時 runtime state 驗證非 simulation fail-closed，不啟動 production、不取得正式行情、不載入 CA，也不執行任何真實委託。
- 驗證 MultiView 安裝、啟動、重啟、資料庫備份／restore、uninstall 保留資料；macOS 重新登入驗收安排在最後，執行前保存狀態並明確告知使用者會中斷目前桌面 session。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `multiview-workspace-navigation`: 增加由 5173 提供的啟動／診斷中介頁與可恢復操作，讓 5174 本身未啟動時仍有可見說明。
- `multiview-local-runtime`: 增加各服務與資料層的安全觀測契約、效能量測邊界及可重現診斷證據。
- `multiview-taiwan-realtime-market-data`: 增加多圖單一 SSE、需求去重、快速切換、指標 full-recompute 對照與背景／前景驗收要求。
- `safe-local-runtime-mode-switch`: 增加隔離狀態下的非 simulation fail-closed 驗證，以及重啟、restore、uninstall 與 macOS 重新登入的驗收契約。

## Impact

- RealTimeStock：`src/components/hud-header.tsx`、MultiView launcher／diagnostic UI、browser tests。
- MultiView：`public/static/app.js`、realtime coordinator／indicator instrumentation、Worker health／本機狀態 API、效能驗收工具。
- Runtime：`scripts/realtimestock-runtime`、`scripts/multiview-state`、repo 外臨時驗收 state 與 LaunchAgent lifecycle。
- 安全：維持 simulation-only；觀測輸出只允許安全計數與 reason code，禁止帳戶、CA、secret、完整商品清單及行情 payload。
- 驗證：不部署 Sites／Cloudflare，不切換 production，不建立 `production-trading`，不執行真實委託。
