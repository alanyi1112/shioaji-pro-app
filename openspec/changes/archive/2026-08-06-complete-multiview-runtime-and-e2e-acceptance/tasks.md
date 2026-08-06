## 1. 前置保護與基準

- [x] 1.1 記錄 HEAD、origin/main、既有 dirty scope、OpenSpec 與 simulation runtime 狀態，確保不碰先前取消 change。
- [x] 1.2 保存目前本機 D1 schema、integrity、個人清單 row count／hash 與備份清單的去識別化基準。

## 2. MultiView launcher 與可見診斷

- [x] 2.1 在 5173 建立 MultiView launcher page，以 bounded timeout 檢查 5174 並在正常時導向既定 MultiView URL。
- [x] 2.2 顯示 5174 未啟動、Shioaji business session 離線、Yahoo 延遲 fallback、盤後資料異常及正常可用狀態，提供重試與精確本機操作指引。
- [x] 2.3 更新「版面」入口改開 launcher，驗證同步 `window.open`、popup blocker 與目前 workspace 不變。
- [x] 2.4 加入 launcher health schema、timeout、CORS／loopback、安全文案與 browser／unit tests。

## 3. 安全觀測與多圖效能

- [x] 3.1 建立固定版本的 document-local acceptance metrics，限制為 panel／SSE／demand／subscribe／request／indicator／render／duration 與 reason code。
- [x] 3.2 將 realtime coordinator、request coordinator、indicator scheduler 與 render lifecycle 接入低成本計數，不新增網路請求或 D1 write。
- [x] 3.3 加入 schema allowlist、重複商品去重、快速切換、背景／前景、cleanup 與 full-recompute contract tests。
- [x] 3.4 實際驗證 1／2／3／4／6／8 圖與重複商品，保存 CPU／heap 可用性、long task、request、SSE、subscription、render churn 與畫面穩定度安全摘要。

## 4. simulation 完整瀏覽器驗收

- [x] 4.1 驗證版面新分頁、日／週／月、RealTimeStock 與 MultiView 兩套清單互不影響。
- [x] 4.2 驗證非台股維持原 provider，以及台股 Shioaji 即時、Yahoo 延遲、auto fallback 與斷線重連。
- [x] 4.3 驗證 provisional 日／週／月、canonical handoff、volume availability 與技術指標 full-recompute 一致。
- [x] 4.4 驗證右鍵 OrderTicket 只傳商品識別，simulation 既有兩階段確認仍可用且不執行額外委託。

## 5. Runtime 生命週期與 fail-closed

- [x] 5.1 以 repo 外臨時 state 與 synthetic mode 驗證非 simulation 不啟動 5174，adapter 在轉送前回 `simulation_required`，且目前 simulation 不受影響。
- [x] 5.2 驗證目前 simulation runtime 的啟動、停止與重啟，以及各服務故障彼此隔離。
- [x] 5.3 在備份後驗證本機 D1 restore，核對 schema、row count、hash 與 `PRAGMA integrity_check`。
- [x] 5.4 驗證一般 uninstall 保留 D1、備份、個人清單及設定，再重新 install／start 並核對資料。
- [x] 5.5 在其他任務完成後保存接續狀態，取得使用者當次確認再執行 macOS 重新登入，登入後驗證 simulation 與資料一致。

## 6. 最終驗證

- [x] 6.1 完成 RealTimeStock 與 MultiView lint、typecheck、unit、contract、browser、build、governance、audit、秘密掃描與 `git diff --check`。
- [x] 6.2 更新本機操作文件與驗收證據，執行 `openspec validate complete-multiview-runtime-and-e2e-acceptance --strict`。
