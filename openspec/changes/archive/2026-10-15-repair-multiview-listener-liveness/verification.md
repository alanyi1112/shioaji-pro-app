# 5174 listener 假存活與選股斷線修復驗證

時間一律 Asia/Taipei，2026-10-15 晚間。

## 已確認的故障與限制

- 原 Node PID 977、workerd PID 1435 仍在，5174 的 TCP listener 已關閉；直接 health 連線被拒絕。launchd 顯示 `running`、原先只執行一次，因主程序未退出而未復原。
- 5173 固定選股代理的目的地是 5174，實際重現 v7 status 回傳 `local_data_service_unavailable`。此故障與選股條件依賴、資料日期及計算公式無關。
- 原 Node sample 顯示事件迴圈等待，不是忙迴圈；但這不等於已排除所有資源問題。原 stdout／stderr 丟至 `/dev/null`，最初關閉 socket 的操作／套件／系統事件仍 unknown，不能聲稱已查明該觸發者或有既存完整日誌。

## 復原與修正

1. 保存保護錨點後，只對原 `com.alanyi.realtimestock.multiview` 執行一次 `launchctl kickstart -k`，未使用會重寫其他設定的整體 restart helper。新 Node PID 76890，22:18 health 恢復；8080、5173 沒有重啟。
2. 新增純 listener 狀態機與 MultiView Vite plugin。5 秒取樣，只觀測自身 `httpServer.listening` 及固定 5174 的最多 1 秒單飛 TCP 握手，不傳 HTTP／SSE payload。真正監聽後持續失去 listener 60 秒才退出碼 86，原 launchd KeepAlive 處理復原；尚未監聽、短暫重載、SIGINT／SIGTERM 不誤殺。
3. Vite 重載透過 process-scoped 單一觀測接管，保留已監聽狀態、取消舊 timer 與訊號 listener，避免新 server 被舊 server 誤判；TCP probe 的遲到結果不能觸發退出。
4. 限定修改 `apps/multiview/vite.config.ts` 載入該 plugin，5174 在同一 PID 76890 自然重載。載入瞬間一次 health 請求遇到 `UND_ERR_SOCKET`，原失敗未刪除或當成成功；稍後真正 HTTP 200、`x-multiview-listener-guard: v1`、D1 true。沒有第二次手動重啟。22:26:45 再核仍健康，adapter activeStreams／accepted 均 0。

## 實際資料與 UI

- 復原後 v2–v9 status 均 HTTP 200、有效與預期日期均 2026-10-15。v2–v7 partial 代表仍有逐檔 unknown，不是日期或服務連線失敗，不說全部股票資料完備。
- 合法 v7「收盤在下軌外」查詢：HTTP 200、有效／預期 10/15、母體 1978、符合 190、不符合 1501、unknown 287；首頁取 5 筆。不是舊日快照。
- v8「布林壓縮與突破」：HTTP 200／ready，10/15，符合 3（breakout 2、preparing 1），unknown 55。
- v9 K 線反轉：HTTP 200／ready，10/15，符合 19、不符 1906、unknown 53；首頁取 5 筆。
- 初次手組診斷 query 用錯 `mode=and`／位置值且 v8／v9 未附必要 criteria，收到 400；這是診斷請求不符合契約，不是再度服務故障。改由正式預設 criteria 與合法解析契約驗證，未修改伺服器來放寬參數。
- 在現有標準交易分頁開啟選股面板，沿用使用者原 MACD 零軸下黃金交叉＋量能條件，沒有改草稿或點商品；實際按開始篩選後，顯示有效 10/15、9910 豐泰符合，原連線失敗消失。原盤中監控分頁未重載、名單／門檻未改，選股面板保留供使用者使用。

## 回歸與安全錨點

- Node24：11／11，含真實獨立子程序關閉測試 listener 後退出 86、真實 loopback TCP 開／關驗證、0 HTTP payload、短暫重載、單飛與正常終止。未以正式 5174 故障注入或新增券商行情連線測試。
- MultiView TypeScript `--noEmit --incremental false` 通過（整合前、整合後各一次）。此 change 只作用於 Vite serve，不改 production build 行為；未以整包 build 或 fixture 取代正式查詢。
- OpenSpec strict 70／70 通過；diff／新增文字空白另於完成前重驗。未擅同步主規格、歸檔、commit 或 push。
- 118 份原先 dirty／untracked 檔案逐份 hash 全未改。8080 PID 56546、5173 PID 971 與啟動時間、simulation generation `simulation:92bd78f3-a5fb-4dd3-859e-4d5dae2db2bf`、HEAD／staging 全不變。
- 全部原 RealTimeStock LaunchAgent plist hash、已載入明日盤前及盤後 job 全文與修復前相同。未更動 10/16 唯一 dynamic entry、授權、四盤前時點、盤後採集或原 Codex heartbeat。08:05 名目首輪／08:08:59 實際 next run 設定維持原值。
- 防護只處理目前程序能執行 timer 時的 listener 失效；不宣稱涵蓋整個 event loop 永久卡死、OS 停機或網路所有故障。未在正式服務刻意重現原最初關閉事件，因此沒有宣稱已取得原觸發者的實盤重現。

私密證據：`/Users/alanyi/Library/Application Support/RealTimeStock/Acceptance/multiview-listener-repair-20261015.zlm8a0/`，含 before／after、final-health-and-preservation、合法 query 結果與 UI 截圖。原其他 failed／partial 收據保留。

## 使用者授權的主規格同步與歸檔

2026-10-15 使用者另明確要求先同步主規格再歸檔，不影響 10/16 動態名單驗收、現有服務與排程，不 commit／push。

- artifact 完整、5／5 任務完成；新增主規格 `openspec/specs/multiview-local-listener-liveness/spec.md`，2 項 Requirement／4 個 Scenario 與 delta 原文逐字一致，保留原觸發事件 unknown 的界線。
- 搜尋 runtime、Vite 接線、測試、明日動態入口、LaunchAgent 與 10/16 heartbeat，均無本 change 原路徑的執行依賴；只搬移文件，不改程式、服務或排程。
- 歸檔前再次執行獨立 Node24 回歸 11／11；沒有重載正式服務、觸發盤前／盤後工作或重跑資料採集。歸檔前後保護程式／dirty 檔、三服務 PID 與啟動時間、generation、所有 plist、已載入盤前／盤後 job 及 heartbeat 設定另比對保存。
- 歸檔位置為 `openspec/changes/archive/2026-10-15-repair-multiview-listener-liveness/`，包含原 `.openspec.yaml`、proposal、design、delta、tasks、verification；不刪除原故障或 partial 證據。
- Git 後續注意：新增防護來源 `apps/multiview/build/local-listener-liveness.mjs` 目前受到既有 `build/*` 規則忽略。本輪不為文件歸檔修改 `.gitignore` 或 staging；未來獲准 commit 時須明確納入該必要來源，不能只提交 Vite import／測試而漏掉實作。
