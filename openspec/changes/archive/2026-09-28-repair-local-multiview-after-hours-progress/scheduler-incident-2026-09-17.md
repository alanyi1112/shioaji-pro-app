# 2026-09-17 排程漏做調查與修正

## 已確認證據（Asia/Taipei）

- 09:02:33：automation-2 開始，原始 function_call_output 含完整三組 heartbeat 指令。
- 09:02:59–09:04:45：實際讀取 runtime／tasks 並開啟 2330 成交明細驗收頁；並非完全沒有執行。
- 09:05:38：compacted replacement_history 不含 `<automation_id>automation-2</automation_id>`，最後保留 user 指令是歷史「收工」。
- 09:05:48：後續回覆明確轉入 shutdown-sync；09:08:56 以「收工完成」結束，而非原定三組巡訪結果。
- read_thread 與 wait_threads 回傳該輪空 items／null message，原始 rollout 卻有工具呼叫及 final。先前以空回覆推論「無工具紀錄」錯誤，已更正。

來源為本機 task `01a08b13-4cd7-7c03-8f60-4616925e830d`、turn `01a0ace3-0142-71c0-9fc1-fbeca8a343d0` 原始 rollout。僅保存事件與結論，不複製原始私密內容。

## 專案端修正

- 原排程保留，前置明確要求 begin → 各組 record → finish；不另建重複排程。
- `scripts/maintenance-run-receipt.mjs` 原子保存三組 checkpoint，重入保留 running；未巡訪不能 finish，受阻不能回傳 verified。
- AGENTS 與 runbook 要求壓縮後恢復磁碟紀錄，最新使用者取消／改派仍優先。
- 向原 task 送入明確補跑訊息，使本輪目標成為可保留的使用者訊息，取代「收工」作為最新工作要求。
- 查核成果以 receipt、驗收文件、來源結果互證；空白查詢結果只能視為觀測不足。

## 驗證與邊界

- 3 項回歸測試通過：壓縮重入保留進度、漏組拒絕 finish、blocked 不成功及完成必須有證據。
- OpenSpec strict 與 git diff --check 通過。
- 更新後讀回 prompt 已含 checkpoint；scheduler DB 實際 next_run_at 為 **2026-09-18 09:02:20 台北時間**，ACTIVE。
- 補跑 turn `01a0ad11-691b-7df2-aca2-a131e88934b4` 已啟動；以後續 receipt 判斷是否巡訪完整，不預先宣稱資料已完成。
- 尚未修改 Codex App 內部 compaction 或 task 查詢程式。防護依賴執行者遵循 runbook，不能保證底層缺陷消失；task 3.4 仍須下一次真正排程驗收。

## 使用者追加今天盤中完成要求

- 補跑已真正建立 running receipt 並記錄第一組阻擋：舊驗收頁本功能歷史查詢 8 次預算耗盡，資料僅到 09:03。不能把此 partial 當通過。
- 使用者要求不要延到下個交易日，已令原執行者優先調查預算耗盡、修正重複補齊並以隔離 Playwright context 進行真實 API／SSE 驗收；不清空舊預算或無限重試。
- 基線離線測試：3 檔 19 單元測試、2 檔 15 browser 測試通過；不取代 live 驗收。
- 同一 task 只能綁定一個 heartbeat，因此沿用 automation-2 暫改 13:26 規則，scheduler 實際下一次為 **2026-09-17 13:27:21 台北時間**。這取代上節原先明日的下一次時間。
- 今日接續先驗 13:25 起大單排除，再等實際收盤成交核對全部成交；當輪結束恢復每日 09:02 並移除臨時 prompt。不能以 13:27 尚未收盤的資料宣稱包含收盤已驗證。
