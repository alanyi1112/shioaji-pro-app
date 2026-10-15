# 2026-10-12 盤後受控 Web 重載與收尾語意驗收

全部時間為 Asia/Taipei。使用者明確允許一次受控重載 5173，保留 8080、watchdog、5174 與券商登入；允許瀏覽器重連既有 SSE／既有商品，不選新商品、不下單。本次只修復收尾狀態誤標，沒有把原 live partial 改判完整。

## 原因與修正

gateway 原先將 08:50 長時工作的失敗收尾收據一律解讀為盤前啟動失敗，造成已成功啟動且收尾 partial 的今日 session 顯示 `premarket_capture_failed`。現已接入無副作用分類器，逐項核對原 summary 的日期、session、generation、cohort、160 商品身分、已接受啟動及合法完成時間。缺件或身分不一致仍保留原失敗語意。

API 與前端對同日、同 revision、已核實 ended／partial 且只因收尾 freshness 過期的 session，保留終態唯讀顯示；不同日期、generation 或真正啟動失敗仍拒絕。此顯示不賦予 current、freshness、訂閱或通知權限。

## 一次重載與服務邊界

- 先在隔離暫存副本完成回歸及型別檢查，再接入工作區。Vite 的 config 相依變更於 17:54:59.621–17:55:01.011 觸發一次自動重載；沒有再呼叫 kickstart 或執行第二次服務重啟。
- Web PID 924、LaunchAgent runs=1；重載前後 8080 PID 75828、5174 PID 75897 均未變。API generation 均為 `simulation:6c92ef97-ec80-49cf-b34f-ac1de5b6e6b0`。沒有操作 watchdog、券商登入、production、CA 或交易。
- 最後唯讀 runtime status：api_simulation=true、api_health=healthy、business session／2330 Snapshot available、watchdog healthy／consecutive_failures=0／restart_count=0、production_readonly_job=stopped、Web listener up。
- 瀏覽器實際記錄一次 Vite 連線中斷後重連。後續文案修正只經元件 HMR，不是第二次 Vite config 重載。
- 重載後圖表暫時等待商品，已由既有結果還原原先的 2449 京元電子、5m；未選新商品、寫清單或更改通知設定。狀態區驗收展開後已還原收合。
- 本次允許既有商品重新要求訂閱；沒有完整操作前後 network counts，不宣稱零訂閱 HTTP 或精確流量成本。服務 PID 與 generation 未變不能取代逐請求 counts。

## 真正 API／UI 結果

- API：`state=degraded`、`reason=daily_close_partial`、`session.current=false`、`staleReason=evidence_stale`，不再是 `premarket_capture_failed`。
- UI：「今日監控 · 部分收尾」、「session：已收尾（唯讀）」、「逐檔完整／部分：158／2」；目前無即時權限，active 不冒充盤中 160，過期證據仍明示。
- 當日結果 94 筆保留：即時 0、收尾保留 35、歷史重播 59。提示明示唯讀且不再發送盤中通知；頁內提示音仍關閉、系統通知仍未授權。
- 翌日基準顯示 2026-10-13、160 檔就緒；不把盤後歷史基準當成今日 live 完整。
- 本次瀏覽器擷取窗口的 error／warn 為空；不宣稱整日永久零錯誤。第一次以 button role 找 summary 未成功且未執行動作，改依真實 DOM 文字展開後完成驗收。
- 18:01 畫面保存於 `/private/tmp/realtimestock-authorized-web-reload-2026-10-12.jpg`，屬本機驗收附件。

## 原始證據不變

重載前後五份原檔逐 byte SHA-256 一致：

| 原檔（IntradayMonitor 相對路徑） | SHA-256 |
| --- | --- |
| premarket/receipts/2026-10-12-0850.json | d6c0c11baa94b57a5d7f03eb414f72f3600871fdf15fdebd2e77ece0e1eab468 |
| daily-run/2026-10-12/summary.json | d974585e017eb90744278e60e2987442726650dff7835aa89ea0e7d37160d509 |
| daily-run/2026-10-12/postclose-tail-reconciliation.json | 7485cf60b31998420a1655cdf634f65eca1c14337e68c27d5f3381c02def3ff6 |
| daily-minute-volume-collection/2026-10-12/attempt-01-receipt.json | eda3814086477b2d6236b3ce9adc215b061c6928b3221cb0fc20c64f333e0490 |
| daily-minute-volume-collection/2026-10-12/attempt-02-receipt.json | a5ee989dbc9a7380a509aac8ac5813b317df14561130070c731707b641252c98 |

## 回歸與未完成範圍

正式工作區 API／view-model Vitest 25／25、純分類器 Node 10／10 通過；TypeScript、Vite build 與兩案 OpenSpec strict validation 通過，build 僅有既有大 chunk 警告。隔離副本首次本機測試監聽受 sandbox EPERM，獲允許後重跑通過；不是產品 live 故障。文件完成後另做 diff 與新增文字 whitespace 檢查。

兩案 strict validation、`git diff --check` 與本輪新增／修改文字尾隨空白檢查皆通過。

今日 live 仍為 158／160；3665.TW、6239.TW 的 13:30 上游來源缺口尚未完全定位，原 13:40 `coverage_incomplete` 不改判。原生下一輪完整同鍵 no-op 與結案彙整仍須各自補證；本次重載成功不能代替全日 live 成功或 scheduler 實際 next-trigger。沒有 archive、commit、push。
