# 維護排程接續與防漏做

本文件供 automation-2 以及使用者明確要求的補跑使用。既有 heartbeat 的完整來源、額度、交易安全及發佈限制仍有效；本文件不新增交易或發佈授權。

1. 首個動作執行 `node scripts/maintenance-run-receipt.mjs begin`，再讀取本文件及三個 change 的 tasks／verification。已有 running 紀錄必須原地接續，不能覆蓋。
2. 優先檢查並執行 cloudflare 實際額度內的逐批補檔，再處理 local-data；tick-tape 已完成的驗收只讀確認，未完成且需要當日特定盤中時點時優先接續該時點。一組受阻仍須巡訪下一組，不能轉去處理舊對話的收工。
3. 每組工作後立即執行 `node scripts/maintenance-run-receipt.mjs record GROUP STATUS '不含秘密的證據路徑、實際結果、阻擋原因及下一步'`。GROUP 為上述三個名稱；STATUS 為 verified、progress、blocked、deferred。只有該組所有必要驗收成立才能 verified。deferred 必須寫明允許再次嘗試的時間或條件。
4. tick-tape 對應 `full-session-tick-tape-with-configurable-large-trades` task 5.1；local-data 對應 `repair-local-multiview-after-hours-progress` task 3.x；cloudflare 對應 `complete-cloudflare-tdcc-verified-archive-acceptance-after-quota-reset`，包含正式來源 repo 的 Free-tier 8.7。不得用盤中資料推進尚未完成交易日，不得略過官方來源冷卻或 Cloudflare 當日配額檢查。
5. 每次上下文壓縮後，先執行 `node scripts/maintenance-run-receipt.mjs status`，恢復 pending 組別。紀錄位於 git 忽略的 `.codex/maintenance-runs/active.json`，僅存證據摘要，不存 cookie、token 或帳號。每次命令由單一執行者依序操作；不可並行補跑同一排程。
6. 結束前執行 `node scripts/maintenance-run-receipt.mjs finish`。有未巡訪組別會失敗且保留 running；全部巡訪但未全部驗收會回傳 incomplete 及 exit 2，必須如實回報。exit 0 僅表示三組皆已有 verified 紀錄，仍需核對所引用證據。這個檢查不取代資料／UI 驗收。
7. heartbeat 最終回覆遵循當次系統的 heartbeat 格式。新失敗、漏做或新阻擋應通知；已記錄且未變的非可操作等待可以保持安靜，但不可省略持久紀錄。使用者直接要求補跑時，正常回報結果。

## 查核排程是否真的執行

`ACTIVE`、turn completed 與空白 read_thread 回覆都不能證明工作成功或沒做。先比對本輪 receipt 的 startedAt／checkedAt 與任務文件；必要時唯讀查看該次原始 rollout 的工具呼叫與結果。原始紀錄含私密資訊，僅擷取時間、事件種類及去識別化結論，不複製整份到 repo。

## 2026-09-17 事故

09:02:33 heartbeat 正確收到三組工作。09:05:38 compaction 的 replacement_history 未保留 heartbeat 指令，最後 user 指令回到前一天「收工」。09:05:48 後轉進 shutdown-sync，09:08:56 結束。成交明細首次開啟曾檢查，隔離 SSE 終驗未完成，其餘工作漏做。read_thread／wait_threads 顯示空 items／null message，與原始 rollout 不一致，不能再用它判定沒有執行紀錄。

專案端採持久 checkpoint、AGENTS 接續規則、完整 prompt 及明確新訊息補跑減輕上下文遺失；未修改 Codex App 內部 compaction／查詢工具，也不能保證底層缺陷已修復。
