# 選股查詢狀態隔離修復驗收

日期：2026-10-13，時間一律 Asia/Taipei。

## 原問題與判定範圍

- 使用者 17:53 圖片顯示「布林價量查詢尚未就緒」並併列有效 10/12、預期 10/13；17:57 五型態圖片則顯示有效與預期均 10/13。
- 唯讀 API 查核證實 v8 布林已於 **16:16:16.818** 發布 10/13，v9 五型態亦有 10/13 合法發布；一般選股 v7 尚為 10/12／mixed_session_dates。並非布林來源沒有當日資料。
- 程式根因：面板初始讀 v7 status，布林失敗只更新共用 error，沒有隔離舊 v7 的日期／原因；HTTP 失敗又統一寫成資料未就緒。
- 未保存 17:53 原始失敗請求，不追認其原因必為逾時。另一個已確認的風險是前測查詢約 7.3 秒，接近原代理 8 秒限制。

## 實作

- 一般選股／布林／五型態依 query family 隔離上下文，跨類型開始時清除其他 response／applied；初始選布林／五型態不借用 v7 日期。generation 防止舊回應覆蓋保持不變。
- 明確區分 query_timeout、回應過大、格式無效、服務離線、來源尚待準備及 HTTP 衝突；任意來源訊息不直接呈現。JSON 解析失敗不把原文反射至畫面。
- 同類型查詢失敗仍可檢視上次快照及其真實日期，但畫面說明本次失敗，開圖／清單按鈕停用；成功後解鎖。
- v8／v9 GET status／results 代理 20 秒、前端結果查詢 25 秒；body 也受界限約束。profile 寫入／讀取、舊版查詢及清單同步保持 8 秒代理預算。不增加自動重試，大小、方法、同源、loopback 與逐股驗證保持不變。
- 未快取 snapshot ID 略過驗證，也未更改公式、資料來源或使用者設定。此修正是可用性／期限對齊，不宣稱計算已加速。

## 隔離驗證

- Node24 Vitest：4 files、**36／36**。涵蓋 HTTP／安全訊息、v8／v9 二十秒 body 上限、九秒合法查詢成功、取消、回應大小與既有 allowlist。
- Chromium：3 files、**67／67**。涵蓋一般選股舊日期切布林失敗、具體錯誤、恢復、布林轉五型態失敗、同類型保留快照且操作封鎖、零 fixture 寫入及既有 UI 回歸。
- 代理正式寫入前另於 `/private/tmp` 隔離候選通過 5／5 Node 測試；未將候選或 fixture 當作正式資料驗收。
- 首次 Chromium 受沙箱測試埠 EPERM，改以隔離測試權限執行；新增回歸首次找不到收合的技術分類 checkbox，調整測試先展開分類後通過。並非正式資料服務故障。
- Node24 `tsc -b` 與 Vite build 通過；保留既有 >500 kB bundle 警告，不將警告寫成零問題。
- OpenSpec 本 change strict、`git diff --check` 及 130 份 untracked 文字 whitespace 檢查通過。

## 經授權的正式載入與唯讀證據

使用者本輪明確授權「測試通過後一次受控載入 5173」，待候選及 UI 回歸通過後，以同一批 gateway 修改觸發 Vite 共用入口載入；沒有執行服務 kickstart／停止命令，也沒有主動重載使用者分頁或點選新股票。

正式 5173 查核：

| 查核 | HTTP | 耗時 | 有效／預期日期 | 結果 |
| --- | --- | --- | --- | --- |
| 布林 status v8 | 200 | 8,876 ms | 10/13／10/13 | ready，快照 `f0063e54-6164-4194-8b2f-194464a81b82` |
| 五型態 status v9 | 200 | 2,619 ms | 10/13／10/13 | ready，快照 `56420e02-b740-4f3b-bddc-71b90e441dd7` |
| 已保存每日布林條件 results v8 | 200 | 7,777 ms | 10/13／10/13 | ready，首頁 20 列、1,691,282 bytes |

布林 status 超過原 8 秒仍成功，確認新代理期限已實際生效。策略母體 1,978、突破 3／準備 8／壓縮 11／未符合 1,891／unknown 65；unknown 保留原判定，不代表每股資料均完整。

前後 GET daily-profile revision 均為 **1**，SHA-256 均為 `661cc505e1f58c7e832b55c147d2d360c35adf2882f374182021e3db56733f2e`。上述正式查核皆為本機 GET，沒有 PUT／清單寫入、行情下載或 broker login／subscribe／交易操作。背景 watcher 可自然發布，不能把自然更新的 v9 head 冒充本輪手動寫入。

前後 listener：Web PID **924**、API PID **55152**、MultiView PID **75897** 不變。simulation、business session／2330 Snapshot available，watchdog healthy／restart_count 0，production stopped，write master disabled。原頁完整 network 錨點未保留，不宣稱自動重連或既有商品重要求恰為零；授權範圍內可能發生既有 SSE／商品重連，與本輪未發出新訂閱操作分開。

## 範圍與限制

- 一般選股 v7 若所需籌碼尚未同日，仍保持 pending；不改日期或借用 v8／v9 資料冒充已完成。
- 未改盤中監控 owner／原失敗收據；本 change 不代表量比簡化案的全日實盤或門檻切換已驗收。
- 其他 dirty work 保留；不歸檔、不 commit／push，不建立排程或第二套 downloader。

## 歸檔後的本機提交候選驗證

使用者另次授權先同步主規格再歸檔，後續再明確要求 commit；本段追加記錄後續階段，不改寫上述實作與正式查核原件。

- 主規格四項 Requirement／七項 scenario 與增量原文一致。歸檔後全工作區 OpenSpec strict 71／71 通過，六份原文件（含 metadata／驗收）移動前後 hash 相同。
- 本次 commit 精準選取 17 個相關檔案；面板原有 mixed_session_dates 說明修改、其他監控程式及測試、產生的 PNG／建置輸出均未納入。
- 只含暫存內容的臨時副本：單元 **36／36**、Chromium **66／66**、Node24 型別／build、OpenSpec strict **68／68** 通過。與完整工作區的 67 項 Chromium／71 項規格項目不同，因其他未提交測試及 active changes 未混入候選。
- 臨時副本首次測試載入預設 Vite runtime 設定而得到 unsupported_repository_version；未視為通過。改用不載入 runtime 的獨立單元測試設定後通過，瀏覽器使用隔離 fixture；未重啟現有服務。
- 暫存差異檢查通過。8080／5173／5174 的 PID 分別仍為 55152／924／75897；本機提交不代表 push 或重新部署。
