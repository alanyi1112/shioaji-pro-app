# 實作盤點與唯讀證據

本文件只記錄實作時核對到的資料契約與證據，不代表新功能已啟用或完成盤中驗收。時間以 Asia/Taipei 解讀；歷史收據及設定備份保持原狀。

## 現行契約與相容邊界

- `config-repository.mjs` 的 SQLite schema v1 只保存最新 config revision、門檻及最多 200 筆有序商品，沒有逐次修訂或可信操作者稽核。`replace()` 用 transaction 與 revision 驗證，但任何歷史操作者均無法由現有 DB 還原。
- `runtime-artifacts/.../cohort.json` 是 Stage-160 的固定商品 manifest。`direct-160-baseline.mjs` 的 baseline set v1 同時綁 `manifestHash`、160 檔筆數及每筆相同 index；逐檔 manifest 還帶原 `cohortHash`。它是歷史 exact-cohort 證據，不能改內容或把舊 hash 套用到新組合。
- `premarket-orchestrator.mjs` 的 `configuredCohortMatches()` 比對設定前 160 檔的每個 index；`resolvePremarketApprovedActiveLimit()` 在 manifest hash 不符時回退 20。`direct-160-product-runtime.mjs` 的 sink 同樣要求設定與基準按 index 完全吻合。
- `premarket-daily-session.mjs` 目前從歷史 cohort 產生 160 個 itemStates；`baselineCurrent` 主要核對目標日期與筆數，尚未逐檔驗證身分與 canonical 270 分鐘內容。`session-state-repository.mjs` 的 immutable session identity 綁 config revision、cohort hash、baseline hash、API generation 與 scheduler receipt；跨日 rollover change 正在使用，不能原地改寫既有 session 或收據。
- `local-api-service.mjs` 的設定寫入經 `configRepository.replace()`；目前狀態 API 分開計算 configured、eligible、waiting、active，但尚無每日 planned／待生效 revision 欄位。UI 匯入草稿與設定寫入不能被解讀為盤中 active 變更。
- 產品新路徑須使用版號不同的 daily plan／逐檔 baseline reference；不能把 Stage-160 bundle 重新命名為每日動態商品驗收，也不能改寫 2026-09-23 至 09-29 failed／partial 證據。盤中既有 session、訂閱與服務生命週期均不在此次離線盤點中修改。

## 2026-09-29 設定與 Stage manifest（唯讀）

- 使用 `sqlite3 -readonly` 查詢本機 rev8 備份與現行 rev9：兩者各 200 檔、共同 189 檔，舊備份 11 檔已不在 rev9，rev9 另有 11 檔。這是兩份設定間的差異，不是操作者紀錄。
- Stage-160 固定 manifest 與 rev8 比對：共同 149 檔、Stage 中 11 檔不在 rev8；共同 149 檔的相對順序一致。rev8 前 160 檔有 11 檔不是 Stage 成員，按 index 比較會產生 140 個位置不符；這不能被解讀為 140 檔被手動重排。
- Stage-160 固定 manifest 與 rev9 比對：160 檔全在 rev9 前 160 位且相對順序一致。rev9 為驗收暫行設定，不代表使用者已確認永久捨棄 rev8 中被暫移的 11 檔；不得自動恢復或推定由誰修改。

## 歷史基準流量樣本與邊界

- `readVerifiedBaselineBandwidthSamples()` 對 2026-09-29 讀到 3 個通過原 Stage-160 manifest、來源 hash 與最終基準驗證的樣本：09-14 消耗 19,719,021 bytes、09-15 消耗 17,933,604 bytes、09-23 消耗 24,454,730 bytes；provider 日額度均為 524,288,000 bytes。
- 既有 `createBaselineBandwidthBudget()` 使用可驗證樣本的最大值乘 3、保留 provider limit 的 25%，並以實際 `remaining_bytes` 判定；目前 `forecastPerSymbolBytes` 是對完整 160 檔推估值，不能未驗證便宣稱可直接預測新商品個別用量。新差異驗證仍須以取得當時的剩餘額度、實際 response 上限及既有檢查為 Gate；provider physical subscription usage/headroom 保持 `unknown`。
- 差異驗證預算契約：只用通過來源／hash／完整 160 檔驗證的近期樣本作風險估計，以其最大完整批次消耗量除 160，再乘既有 3 倍係數及本次待建檔數；同時保留 provider limit 的 25% 中央儲備。啟動前要求剩餘 bytes 足夠支付估計增量與儲備；每次請求前後讀取實際 usage，累計消耗不得越過本次 allowance，單次 response 不超過既有 16 MiB 上限。任何 usage 缺失、來源衝突、樣本不足、期限到達或實際消耗觸頂都 fail closed，保存獨立失敗收據；這是估計與硬截止，不是保證新商品耗量一定等於平均值。不得在程式寫死固定啟動 bytes 門檻，也不得把 provider physical subscription headroom 推成已知。
- 上述歷史樣本只證明已完成基準讀取的觀測用量，不構成新商品隔夜補建或當日 live capacity 的成功證據。

## 本輪已實作、但尚未啟用的邊界

- `dynamic-daily-cohort-plan.mjs` 建立版號獨立的每日候選 plan，使用官方交易日 authority、已核准容量 160、設定 revision/hash、原始穩定排序與 immutable plan hash；原子保存到新的 plan 路徑，不修改既有 session 或訂閱。
- `dynamic-daily-baseline-resolver.mjs` 以 `targetTradeDate + previousTradeDate + canonicalSymbol` 配對基準。舊 Stage-160 baseline set 先通過原本整包驗證，才可只引用其中的逐檔 manifest；新逐檔 manifest 使用穩定的單商品 cohort 身分，不綁整份 plan hash，因此重排不使同商品基準失效。缺基準只隔離該商品，`exact160BaselineReady` 仍要求完整 160 檔。
- 新 plan 與 resolver 模組目前是離線純流程，尚未接入盤後收集、08:35／08:45 排程、daily session、API 或 workspace；不得把單元測試通過寫成盤前已備妥新個股比較資料。真實跨交易日驗收仍待後續任務。
- `dynamic-baseline-delta-budget.mjs` 已把近期完整 160 檔實測樣本轉成新入選商品的預估增量與 25% 中央保留額度，並提供逐次實際 usage、單筆回應 16 MiB 與 08:35 截止檢查；此模組同樣尚未接入排程或發出任何 provider request。
- `dynamic-daily-admission.mjs` 新增與 Stage sink 分離的每日 admission 純元件：固定 plan 的訂閱商品與順序，將缺基準逐檔標示為不可比較，並把 planned、baseline-ready、subscription-requested、data-active 分別計數。控制面 receipt 必須證明同一 session／generation、單次 batch、原商品順序且無第二次 login／stream 或輪替；控制面 accepted 本身不提升 data-active。資料面只有同商品、同基準 manifest、合法單位與完整同分鐘證據才可提升比較資格；本元件一律不自行授權通知。
- `dynamic-daily-baseline-resolver.mjs` 加強同商品來源衝突：同時提供有效與無效 manifest 時不靜默採用有效版本，而僅隔離該檔並維持其他檔可用。新增回歸測試。
- admission 目前不呼叫實際 transport、API、SSE 或 broker；還需要把它接上既有共用串流與盤前封存 session，才能完成任務 2.3。不得將 fixture receipt、單元測試或注入的事件視為真實訂閱／盤中就緒；此次作業沒有對既有 simulation runtime 發出訂閱或修改服務。
- 最新 focused tests：4 個新模組與 4 個原 Stage-160／盤前測試檔，共 8 個檔案、43 項通過；`openspec validate support-dynamic-intraday-monitor-cohorts --strict` 與 `git diff --check` 通過。新增檔案仍是未追蹤檔，另以尾端空白檢查確認未發現問題。上述均為離線／fixture 測試，不是 2026-09-29 真實盤前或盤中驗收。

## 2026-09-29 盤中程式補強（13:19 Asia/Taipei）

本段更新前述「schema v1」與「尚未接 transport」的實作時點；上述歷史盤點不代表目前程式仍停在該版本。

- 設定儲存庫升至 schema v2，新增 append-only 去敏稽核、revision CAS、來源類型及成功／衝突／不合法設定的紀錄。舊 rev9 遷移只記 `legacy_state_observed / unknown`，不推定過往操作者。盤中編輯程式後，既有 Vite 本機服務自動載入新程式並使本機設定 DB 完成 v2 migration；沒有重啟服務、改寫 rev9 設定或刪除舊證據。確認／拒絕舊 plan 的正式 UI 流程仍未串接，因此 task 3.4 尚未完成。
- 新增盤後候選 plan 前置元件、有界差異基準 worker、本機唯讀 provider port、08:35／08:45 收據核心與設定修訂時間政策。worker 對缺基準檔做兩次獨立歷史 KBar 抓取、逐筆成交總量與 270 分鐘對帳；預算須由實測樣本發行並每次查詢前後重讀 usage，超時／超額停止並保留收據。`/api/v1/info` 與 `/health` 只能證明 simulation API 可用，port 不再自行宣稱已確認當前 business session；真正啟動仍需外部當前 session／generation 證據。
- 新增每日 profile 的 1–160 檔 shadow、bounded transport、與原 Stage 共用的排他 run registry、同分鐘純比較器及下一交易日的 live-stage 模組。live-stage 必須取得已雜湊核對的 08:45 Gate、逐檔 manifest 與排他 claim 才能在盤前啟動；測試證明一次 SSE／一次固定 batch、合法封分鐘比較與通知數為零。這是 fixture 離線測試，今天沒有呼叫該 `start()`，也沒有新增真實 SSE、login 或 subscription。部分缺基準的既有核准 plan 尚未完成可安全啟動的正式邊界，task 2.3 仍不勾選。
- 新增獨立每日狀態唯讀投影，將 configured、planned、waiting-capacity、baseline-ready、subscription-requested、data-active、實際生效日及待生效 revision 分開計算；它尚未接上 API 與 workspace，task 4.1 未完成。盤後差異 worker 與 08:35／08:45 Gate 核心尚未接實際 LaunchAgent／排程，task 3.1／3.2 未完成；不得把候選 plan 或 fixture 收據視為隔日已準備好。
- 13:19 再核對現有 runtime：simulation、API 健康、2330 Snapshot、5173／5174 均可用；production readonly stopped、write master disabled。現有監控 API 仍為 `feature_off / config_revision_mismatch`，當日 session rev8、已儲存設定 rev9、configured 200、data-active 0。這個當日不一致未以盤中熱換、第二條訂閱或重啟服務處理。
- 相關 focused tests 18 檔、76 項通過；repo-wide `pnpm test` 274 檔、2672 項通過；`pnpm build` 成功（僅有既有大型 bundle warning）；OpenSpec strict validation 與 `git diff --check` 通過。上述全為程式與 fixture 驗證，不等同 2026-09-29 盤中 acceptance。repo 另有大量其他進行中未提交變更，本輪未清理、commit、archive 或 push。

### 13:28 補充安全核對

- 新增本機 simulation session proof：先核對 `runtime-mode` 與預期 generation，只有符合才查 API info／health 及 2330 Snapshot，並要求 Snapshot 來源日為前一或目標交易日。production 或 generation 不符時，在任何 API 呼叫前拒絕。差異基準 worker 現在要求該 proof 的 schema、來源版本、日期及盤前期限一致；僅有 API 健康不可冒稱 business session current。
- 每日 live-stage 在開 SSE 前重讀本機 mode／generation；若 08:45 Gate 後 generation 已變，則不 claim、不訂閱。共用 run registry 的路徑固定為既有 Stage 的 `direct-160-live/registry`。純同分鐘比較器亦要求有效的當日 08:45 Gate；無 Gate 時即使有 KBar 和基準也只回 `unknown`，通知仍不授權。
- 13:28 相關新測試均通過；此段補強未連接今天正在執行的服務或真實 session，明日自動執行及跨交易日驗收依然未完成。

### 13:30 盤中邊界結論

- 13:30:20 Asia/Taipei 再讀既有 `/api/intraday-monitor/v1/status`：`feature_off / config_revision_mismatch`、設定 rev9、今日 session rev8、configured 200、data-active 0。直到盤中尾聲均無當日可驗收的合法監控資料面；不能補造首筆 KBar、比較或通知成功。
- 最後 focused regression 19 檔、81 項通過；strict validation 與 `git diff --check` 通過。未修改今天的設定、session、claim、訂閱或 failed／partial 收據。剩餘工作是將安全核心接入實際盤後／08:35／08:45 排程及 API/UI，並在下一適用交易日依真實證據驗收；本次沒有勾選這些任務。

### 13:46 盤後續作與證據邊界

- 既有 13:35 盤後基準排程於 13:35:00.425 Asia/Taipei 取得 `attempt=1`、`trigger=scheduled` 的 claim；截至 13:42 的唯讀 `--status --date=2026-09-29` 仍為 `claimed_without_receipt`，且原程序仍在執行。這是「進行中」，不是成功，也不是失敗；未停止、重啟或修改該程序正在使用的排程腳本與原始檔案。
- 新每日名單路徑補上不可覆寫的 `active-plan.json` 指標。啟用前必須能讀回已保存的候選 plan、08:35 基準 Gate 與 08:45 最終 Gate；三份 hash、商品身分、交易日、設定 revision 及先後時間都須相符。沒有指標時只表示尚未啟用，不能把候選 plan 顯示為已生效；來源不符時在任何 SSE／訂閱前拒絕。
- 候選 plan 驗證新增位置唯一性、原始優先順序、商品與交易所一致性；即使重新計算 hash，錯誤內容仍不得被接受。08:35 Gate 可在 08:35 分鐘內完成檢查，但所引用的新基準須在 08:35:00 前封存；08:36 起不得補造盤前就緒。
- 新增兩階段的離線封存協調器：先對已落盤候選 plan 保存 08:35 Gate，再由已落盤基準 Gate 與新鮮 simulation session proof 產生 08:45 Gate；只有 ready 時建立當日唯一 active pointer。失敗收據仍獨立保存，不會啟用。這些均是 fixture 驗證的程式路徑，**尚未接入真實 LaunchAgent、當日 API/UI 或既有行情 session**，不得把此段當成 9/30 已可自動運作。
- 新增來源相異的回歸：即使傳入的 coverage 自稱就緒，只要與 08:35 保存的 manifest/source hash 不同，live-stage 在開 SSE 前拒絕。13:46 focused regression 16 檔、73 項通過；後續仍需完整建置、strict validation 與盤後排程收據核對。未 commit、archive、push，未動 production、真實下單或第二條行情串流。

### 13:48 真實盤後結果與唯讀 shadow audit

- 既有 13:35 排程的 `attempt=1` 正式收據已於 13:47:56 Asia/Taipei 落盤，`outcome=verified`、來源交易日 2026-09-29、目標交易日 2026-09-30。正式 verification 顯示 `baselineUsable=true`、`verifiedCount=160/160`、43,200 個分鐘點、`liveCaptureAcceptance=false`。此結果屬原 Stage 固定 160 檔基準，不是新 daily plan 的 Gate 或盤中資料面成功。
- 使用新增的唯讀 `audit-dynamic-daily-baseline.mjs`，重新取得官方 TWSE／TPEx 下一交易日判定，再以只讀 SQLite、既有容量核准、已驗證的 Stage baseline set／cohort manifest 執行新 resolver。結果：rev9 設定 200 檔，規劃 160、候補 40、逐檔基準就緒 160、缺基準 0，來源版本 `sha256:2a6911b076ecf7d1678036862b5806d8d4a05aa63ab94730c912c908ec4941ff`，基準 set hash `393684a65a92aac079e120ed5d9ef20eec164898763e11e2abc34c20aec85b28`。另以唯讀 SQLite 與 baseline manifest 逐列比較，前 160 檔代碼／交易所／順序完全相同。shadow plan hash 每次 audit 可因觀測時間變動，未保存，不能當成當日正式 plan hash。
- shadow audit 的 `writePerformed=false`；沒有寫入 plan、Gate、claim、session、訂閱或通知。未驗證新增 11 檔進入前 160 後的有界補建、08:35／08:45 真實排程或 9/30 live SSE，故 task 3.1–3.5、5.2–5.4 仍未勾選。
- 後續全 repo `pnpm test`：275 檔、2,681 項通過；`pnpm build` 成功（僅大型 bundle 警告）；OpenSpec strict validation 與 `git diff --check` 通過。`pnpm local-runtime status` 仍為 simulation、business session available、API／5173／5174 健康、production stopped、write master disabled、watchdog restart count 0。MultiView 盤後資料 `verification_required/partial` 是獨立缺口，不混作本 change 成功。

### 13:58 每日狀態 API／面板的部分接線

- 新增獨立唯讀 `/api/intraday-monitor/v1/daily-status`；它只讀當日不可覆寫的 active pointer、候選 plan、08:35／08:45 Gate 三份證據。若沒有 active pointer 就回 `feature_off`、planned/data-active 0；證據損壞回 503，不將讀取失敗冒充零缺口。實際 5173 查詢目前顯示 configured 200、planned 0、data-active 0；既有 `/status` 仍為 `feature_off / config_revision_mismatch`、session rev8、設定 rev9。
- workspace 只有在 daily plan 真正封存時才另顯示「每日名單（新流程，與歷史 Stage 分開）」；分列規劃／候補、基準、訂閱、資料 active、降級、設定 revision 與待生效 revision。尚未接 live-stage 的資料時只標示「尚未有合法盤中資料」，不以固定 Stage GO 充數。revision 已變但沒有可信待生效決策時，狀態標為 `revision_unverified`，不編造生效日。
- 新 API／UI 尚未接上每日 live-stage 的執行中狀態與完整 scheduler；所以 task 4.1 仍是**部分完成**，不能宣稱新每日名單已實際上線。瀏覽器面板測試用正確 `pnpm test:browser` 指令 14/14 通過；第一次以一般 Vitest 指令執行 browser suite 因未啟用 Browser Mode 而失敗，屬執行方式錯誤，非測試案例失敗。型別與建置再次通過。

### 14:01 最後回歸

- 補測時發現新 plan 驗證曾把合法五碼但不支援 KBar 的商品也當成 plan 結構錯誤；現已改為允許它留在 `excluded / kbar_contract_unsupported`，但 `selected`／`waiting` 仍只接受符合監控條件的四碼普通股。新增正反例測試通過。第一次新增測試有括號語法錯誤，已修正並重跑；未遺留失敗測試。
- 全 repo `pnpm test` 重跑為 275 檔、2,683 項通過；`pnpm build`、盤中監控面板 Browser Mode 14 項、OpenSpec strict validation、`git diff --check` 全通過。`pnpm local-runtime status` 仍為 simulation、API／business session／5173／5174 正常、watchdog restart count 0、production stopped、write master disabled。既有 MultiView 盤後資料 partial 狀態與本 change 分開記錄。
- 今日市場已收盤；可在本交易日取得的真實盤中監控資料面依舊是 `feature_off / config_revision_mismatch`、data-active 0。任何 9/30 的 08:35／08:45 實際 Gate、live SSE、同分鐘比較與通知驗收仍須由下一適用交易日的真實排程與事件證明；本輪未造假收據、未 hot-switch、未啟用第二條訂閱，亦未 archive、commit、push。

### 21:48–21:58 開盤前補強與執行邊界

- 任務 2.3 補上 `partial_ready` 的獨立 Gate 語意：一檔缺完整基準時，逐檔 Gate 保留 `waiting_baseline`，已驗證商品可在同一不可變 plan 進入 bounded 單批觀測；`baselineReadyCount` 與 `exact160BaselineReady` 分列，缺基準商品的同分鐘結果維持 `unknown`、不可比較、不可通知，也不以候補補位。沒有任何商品具合法基準或官方／session Gate 失敗時整份 Gate 仍為 `failed`。新路徑只在已封存候選 plan、08:35／08:45 收據與 active pointer 相符時可開始；目前尚未接入真實 LaunchAgent 或既有行情 session，故此項完成僅指程式與 fixture 回歸，不是 9/30 live 驗收。
- 回歸測試先發現舊 evaluator 測試把「第二檔缺基準」等同「沒有正式 Gate」，已改為明確傳入無 Gate，另增加部分 Gate 下已驗證與未驗證商品的正反例。`dynamic-daily-*.test.mjs` 13 檔／51 項、全 repo `pnpm test` 275 檔／2,686 項通過；`pnpm build` 成功（僅既有大型 bundle 警告）、OpenSpec strict validation 與 `git diff --check` 通過。
- 21:55 唯讀模擬明日固定 Stage-160 的 9/30 effective config／baseline 路徑，`inspectPremarketGates` 的 simulation、business session、2330 Snapshot、8080／5173／5174、artifact、baseline、rev9 前 160 檔順序、磁碟均為 true，enabled=200；這是**今晚預檢**，不是明日排程收據。`requireStableGeneration=true` 時只有 generationStable=false，必須等真正的 08:20 warmup／anchor 與 08:35 重驗，不能預填通過。
- Mac 目前接 AC，原設定 1 分鐘自動睡眠且沒有 9/30 wake event。經此次準備，在使用者層啟動單次 `com.alanyi.realtimestock.premarket-awake-20260930`，執行 `caffeinate -is -t 60000`；`launchctl print` 讀回 running／runs=1，`pmset -g assertions` 讀回 PreventSystemSleep=1、PreventUserIdleSystemSleep=1。它只防自動睡眠，不保證關蓋、手動睡眠、斷電／網路或關機時排程仍會執行，沒有變更永久電源政策。
- 將既有已過期的驗收 thread heartbeat 更新至 2026-09-30；排程器資料庫實際 `next_run_at=1790730120000`，換算 Asia/Taipei 為 **2026-09-30 09:02:00**。此 Codex 驗收跟進與 macOS 08:20／08:35／08:45／08:50 LaunchAgent 不同，不會建立盤前 session，也不能代替真實收據。
- 仍未完成 3.1–3.5 的真實盤後／盤前動態名單接線、4.1–4.3 的完整 API/UI／設定確認及 5.2–5.4 的 live 證據；9/30 應以既有固定 Stage-160 的正式排程另行驗收，不能把今晚 partial-ready 單元測試冒稱動態名單已啟用。未重啟 API／watchdog／Web／MultiView、未做第二次登入／訂閱、未改歷史 failed／partial 收據，亦未 archive、commit、push。
