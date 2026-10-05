# 驗證摘要

## 2026-10-05

實作與真實環境證據：[盤中前端修復紀錄](acceptance/implementation-2026-10-05.md)。

- 根因：1m `aggregate` 回傳原陣列及原 Candle，raw／display 更新造成別名、跨分鐘時間重複、同分鐘價量雙算；隔離失敗測試先重現再修正。
- 修正：獨立 Candle 所有權、快取／提交時間軸檢查、一次提交及最多一次 rollback、局部錯誤、歷史 prepend 後重新連接 live tail；保留既有成交量單位、成交值 cursor、generation、viewport 及指標契約。
- 16 個單元／整合檔 134 項及 3 個 Chromium 檔 35 項通過；型別、build、strict 與 whitespace 通過。合成來源及例外注入不冒充實盤。
- 既有 3090 真實頁面週期切換無崩潰，原背景監控 160 dataActive、同 session／generation 與服務 PID 未變。
- 未完成：4.2 真實 SSE 跨三分鐘邊界及單次價量增量；3090 觀察窗口沒有來源事件，不能以 REST 更新代替。已提出 2449 有界方案，未獲該輪授權前不擴大操作。
- 13/14 完成；目前不可歸檔，未 commit／push。

## 2026-10-05 12:48–12:56 有界增量驗收完成

以上為前一輪狀態，保留原紀錄。本輪使用者已明確同意改用 2449；完整證據見 [京元電真實增量驗收](acceptance/live-2449-2026-10-05.md) 與 [可重算 JSON](acceptance/live-increments-2026-10-05.json)。

- 真實既有 SSE 跨 12:50／12:51／12:52 三邊界，raw／display `495→496→497→498`；六筆來源成交與量／金額一次增量獨立重算通過。
- 真實 `1m→5m→1m→1D→1m` 無崩潰／重複時間。補清除切股或週期後殘留的最後成交診斷，35 項 Chromium 回歸及真實頁面確認通過。
- 17 項 focused tests、型別、build 通過；原 134 項完整相關單元／整合結果保留。strict／diff／新增文字檢查另於本輪結束核對。
- 已復原 3090／1D；同 session／generation、原服務 PID、160 dataActive／0 degraded、安全 Gate 未變。沒有新 login／第二行情連線、服務重啟、交易或清單寫入。
- tasks 14/14 完成，具備本 change 歸檔條件，未 archive／commit／push；不替代其他 monitor changes 的完整日驗收。
- 最終 strict／git diff --check／新增文字 11 檔 whitespace 通過，apply instructions 為 all_done。

## 2026-10-05 歸檔與提交前複核

- 使用者確認先同步主規格，再歸檔及本機 commit；其餘監控變更保留，不 push。
- 新增主規格 `openspec/specs/main-chart-candle-data-integrity/spec.md`，5 項 Requirement／13 個 Scenario 與 delta 逐字一致；確認完成後以 `--skip-specs` 避免重複套用，歸檔至本目錄。
- 本輪提交前重跑 13 個相關單元／整合檔 121 項、3 個 Chromium 檔 35 項皆通過；型別、Vite build 通過（既有 chunk size 警告保留）。這是提交前 focused 回歸，不改寫前一輪 134 項結果。
- 歸檔後 `openspec validate --all --strict` 67/67、`git diff --check` 通過。僅納入本修復的程式、測試、主規格、歸檔文件及小型增量證據；產生的截圖／建置輸出及其他進行中變更不提交。
