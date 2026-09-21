# 2026-09-08 盤中推進紀錄

## 正式 capture 狀態

- 執行模式：simulation、feature-off、通知關閉、固定 20 檔 bounded KBar full-session capture。
- 交易日：2026-09-08。
- 10:16（Asia/Taipei）唯讀檢查時，capture process 已連續執行約 1 小時 22 分，且專用連線仍為 `ESTABLISHED`。
- runtime `/api/v1/stream/status` 回傳 `active_connections=5`；此數字只表示應用層連線，不能推算 provider physical usage、global ownership 或 headroom。
- `kbar-shadow-2026-09-08.json` 尚未存在；full-session recorder 預定在 13:31 完成後才以 `wx` 原子建立，盤中 pending 屬預期狀態。
- 本輪沒有停止或重啟 simulation API、5173、5174，也沒有修改 capture cohort、plan、receipt manifest 或 output target。

## runtime assurance 修正

- 發現 2026-09-08 v4 以 Playwright 新開交易頁面時，實際會產生 POST 與 `/api/v1/stream/subscribe`，但舊 builder 把 operations 固定寫成 GET-only／零 subscription mutation。
- 已保留原始 v4 evidence 並建立獨立失效紀錄；pending dossier 已移除 v4，避免錯誤證據進入正式 bundle。
- 新 builder 必須由呼叫端提供 operations；validator 可保存診斷結果，但非純 GET、subscription mutation 或其他 authority mutation 均維持 `ready=false`。
- 新 Playwright probe 會觀測實際 request methods 與 subscribe／unsubscribe request 數，不再自動宣稱零干擾。
- 曾嘗試只讀觀察使用者既有 Chrome 盤中頁面；沒有 reload、navigation、商品／週期切換，但 Computer Use 畫面只取得灰色內容且無 app DOM，因此沒有保存或冒充 chart freshness 證據，也沒有把可能包含帳戶／部位資料的全頁截圖寫入 repo。

### 12:00 後的被動 DOM 觀測修正

- K 線元件新增不含帳戶、部位或下單資料的 `candle-chart-passive-freshness/1` DOM 診斷屬性；只保存商品、週期、最後 visual commit 與來源時間。
- 在使用者原本已開啟的盤中選股頁執行三次唯讀 DOM query，沒有 reload、navigation、click、新增頁面或網路請求；IX0001 5 分 K 的 `lastVisualCommitAt` 由 `2026-09-08T04:00:24.974Z` 推進至 `2026-09-08T04:00:40.022Z`，第二次 freshness 為 221 ms。
- 保存 `passive-chart-freshness-2026-09-08.json`；其 canonical hash 為 `b45895d7cf17b05ab3d087cd2638e7c84d22fa0a62b8d29f7ccf17039376cd38`，provider physical usage／global ownership／release／headroom 仍為 `null`。
- 新增 `build-passive-runtime-assurance.mjs`，只用上述 DOM evidence 加上 trigger SSE 的 GET-only reconnect probe 組裝 assurance，不啟動新交易頁、不切週期、不提出行情 subscription。
- 已產生 `pilot-runtime-assurance-2026-09-08-v6.json`；validator 回傳 `valid=true`、`ready=true`、`reasons=[]`。v4 與其失效紀錄繼續保留稽核，但不得再作為正式入口。

## 本輪驗證

- `scripts/intraday-monitor-runtime/*.test.mjs`：21 files、144 tests passed。
- browser suite：9 files、101 tests passed。
- intraday monitor 前端 domain／API／watchlist targeted suite：9 files、31 tests passed（另有不影響結果的 Node `localStorage` experimental warning）。
- targeted runtime assurance／bundle／dossier：5 files、17 tests passed。
- `pnpm build`：passed；只有既有 Vite chunk-size warning。
- runtime assurance、capture CLI 與 bundle assembler Node syntax：passed。
- `git diff --check`：passed。
- `openspec validate add-configurable-intraday-relative-volume-monitor --strict`：passed。

## 尚未完成

本紀錄不是 8.2 完成證據。今日不干擾現有訂閱的 chart freshness assurance 已備齊；仍須等待今日 full-session capture 原子封存、完成第二個不同的完整交易日、組裝 deterministic replay bundle，最後再由人工審閱與簽核。

總卷版本說明：未帶版本的 prepared dossier 曾引用失效 runtime v4；v2、v3、v4 是修正過程的不可覆寫中間稿。v5、v6、v7 是被動 DOM evidence 串接過程的不可覆寫中間稿；完成本紀錄 hash 更新後須以 v8 作為今日最新 pending dossier。validator 預期回傳 `valid=true`、`readyForArchive=false`，只保留尚未完成的 20 檔兩日 bundle／人工簽核等 blocker。舊稿保留稽核但不得作為目前驗收入口。
