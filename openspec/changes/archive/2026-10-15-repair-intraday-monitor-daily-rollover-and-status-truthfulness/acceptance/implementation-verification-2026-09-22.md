# 2026-09-22 實作與安裝驗證

## 安裝結果

- `node scripts/intraday-monitor-runtime/install-daily-rollover-state.mjs --dry-run`
  - 結果：通過。
  - runtime bundle hash：`14e3305833b60bc76122613950359d3d771f36661d1ab1f95267a018ce12cdd5`。
  - 2026-09-16 legacy state 僅遷移為 historical approval；`currentSessionCreated=false`、subscription／results／notification authority 均為 `false`。
  - 官方下一適用交易日為 2026-09-23，previous trade date 為 2026-09-22。
  - 四個 computed local triggers 分別為 `2026-09-23 08:20:00`、`08:35:00`、`08:45:00`、`08:50:00`，全部為 `Asia/Taipei` 且 consistency 為 `ready`。
  - `originalEvidenceModified=false`、`serviceLifecycleMutations=0`。
- `node scripts/intraday-monitor-runtime/install-daily-rollover-state.mjs --execute`
  - 結果：通過；安裝上述 immutable bundle、durable approval 與 premarket config v2。
  - config 已移除固定 `tradeDate`、active-change `manifestPath`／`planPath`／`prerequisitePath` 及固定 `baselinePath`。
  - 未重啟、停止或切換任何 runtime 服務。
- `plutil -p /Users/alanyi/Library/LaunchAgents/com.alanyi.realtimestock.intraday-premarket.plist`
  與 `launchctl print gui/501/com.alanyi.realtimestock.intraday-premarket`
  - 結果：LaunchAgent 已載入，四個 calendar interval 為 08:20、08:35、08:45、08:50；程式入口仍指向目前 repo 的 `premarket-orchestrator.mjs --scheduled`。

## 離線與建置驗證

- `pnpm exec vitest run scripts/intraday-monitor-runtime/*.test.mjs src/lib/intraday-monitor-view-model.test.ts`
  - 結果：51 個 test files、315 個 tests 全部通過。
- `pnpm exec vitest run --config vitest.browser.config.ts src/components/intraday-monitor-panel.browser.test.ts`
  - 結果：1 個 browser test file、13 個 tests 全部通過。
- `pnpm build`
  - 結果：`tsc -b` 與 Vite production build 通過；僅保留既有 large chunk warning。
- `openspec validate repair-intraday-monitor-daily-rollover-and-status-truthfulness --strict`
  - 結果：change valid。
- `git diff --check`
  - 結果：通過，無 whitespace error。

## 安裝後 live read-only 狀態

- `pnpm local-runtime status`
  - simulation API、business-session watchdog、Web 5173 與 MultiView 5174 均維持既有 loaded／healthy 狀態；本次未做 lifecycle mutation。
- `GET http://127.0.0.1:5173/api/intraday-monitor/v1/status`
  - `state=feature_off`、`reason=current_session_missing`。
  - 歷史容量核准為 160、reviewer type 為 `codex_delegated`、evidence trade date 為 2026-09-16。
  - 今日 `dataActive=0`、`waitingGate=160`、`waitingPilotLimit=40`、baseline unknown=200、fresh=false。
  - 此結果證明歷史 GO 已不再冒充 2026-09-22 current session。

## 尚未完成的 live acceptance

- 7.4：等待 2026-09-23 由 durable scheduler 自動建立第一日 session 與完整證據。
- 7.5：等待下一個適用交易日再次自動 rollover，並於 09:02 後驗證 data plane、sealed-minute、results 與 notification Gate。
- 7.6：完成上述兩日後才能產出跨交易日 dossier；目前不得標記 ready for archive。

## 2026-09-23 第一個適用交易日實查（Asia/Taipei）

### Runtime 與 premarket 原始結果

- 09:05–09:17 間 `pnpm local-runtime status` 持續回報 `runtime_mode=simulation`、`production_readonly_job=stopped`、`smart_order_write_master=disabled`、`api_health=healthy`、`api_business_session=available`、5173／5174 listener 皆為 up；未執行任何 service lifecycle mutation。
- 09:06:41 的 2330 Snapshot 可用，交易時間為 2026-09-23 09:06:41、累計量 2,697 張，證明 business session 與真實盤中行情存在。
- 08:20 scheduler receipt 已建立 `session-2026-09-23-76037f50e69a83f9ea26d78d`，official authority 為 2026-09-23、previous trade date 為 2026-09-22，outcome 為 `waiting_baseline`；session 內 160 檔均為 `baseline_missing`，`baselineHash=null`、control-plane requested／accepted 均為 `false`。
- API 目前 generation 為 `simulation:b418ea6d-3a6c-47f3-b59d-01a2caf8973a`，session 與 generation anchor 仍為 `simulation:c77980d3-eae3-4c85-8937-7daba18f8a78`。
- 08:35 與 08:45 receipts 均保留 `generation_mismatch`；08:50 receipt 保留 `calendar_authority_unavailable`，authority reason 為官方來源回傳 `<!DOCTYPE ...` 而非 JSON。以上失敗證據未刪除、覆寫或改日期。

### UI 誠實性

- 09:06 在 `?layout=intraday-stock-selection` 顯示歷史容量核准 `160 · GO · 2026-09-16 · Codex 代理審閱`，並將今日監控分開顯示為「今日未啟動」。
- 畫面顯示交易日 2026-09-23、data active 0、訂閱未接受、尚無首筆 KBar、evidence stale／未證實，且明示「今日 session 與 API generation 不一致」。
- 這證明 fail-closed UI 語意正常，但不構成 7.4 的成功證據。

### 結論

- task 7.4 保持未勾選：第一日 session 雖由 durable scheduler 自動建立，但 baseline、generation 與後續 Gate 未成立，沒有 control-plane／data-plane／freshness 完整證據。
- tasks 7.5、7.6 仍須等待下一個適用交易日與跨兩日 dossier；本次不得標記 ready for archive。

### 本次自動化回歸

- `pnpm exec vitest run scripts/intraday-monitor-runtime/premarket-orchestrator.test.mjs scripts/intraday-monitor-runtime/premarket-daily-session.test.mjs scripts/intraday-monitor-runtime/current-session-authority.test.mjs src/lib/intraday-monitor-view-model.test.ts`：4 個檔案、24 項全數通過。
- `openspec validate repair-intraday-monitor-daily-rollover-and-status-truthfulness --strict`：通過。
- `git diff --check`：通過。

### 下一適用交易日接續

- official authority 於 2026-09-23 09:20（Asia/Taipei）解析下一適用交易日為 2026-09-24、previous trade date 為 2026-09-23，authority source version 與本日相同。
- 因 thread 只能附掛一個 heartbeat，將本次 `automation` 原地更新為「盤中監控跨日驗收 2026-09-24」，prompt 已縮限為 tasks 7.5／7.6，不再執行 tick-tape 驗收。
- scheduler database readback：`next_run_at=1790211720000`，換算 `Asia/Taipei` 為 2026-09-24 09:02:00（CST +0800）；不是僅依 RRULE 文字推定。

### 11:49 盤中複查

- 既有 simulation API、business session、2330 Snapshot 與 8080／5173／5174 均可用，production stopped、write master disabled；本輪未啟停服務、重新登入、增減 pilot 訂閱或改寫 session／receipt。
- `/api/intraday-monitor/v1/status` 仍為 `feature_off/generation_mismatch`，今日 `dataActive=0`、control-plane 未接受、baseline missing 149／unknown 51、freshness=false。這與先前 08:20 `waiting_baseline`、08:35／08:45 `generation_mismatch`、08:50 `calendar_authority_unavailable` 的失敗鏈一致；不能用健康的 2330 Snapshot 冒充 pilot 成功。
- 7.4 所需 official authority、baseline、scheduler receipt、逐檔 control/data plane 與 freshness 未同時成立，保持未勾選；7.5／7.6 按已核對的 2026-09-24 09:02 Asia/Taipei heartbeat 接續，不以今日人工操作替代自動 rollover。

### 12:49–12:51 第 7.4 項盤中再稽核

- 唯讀核對四份 2026-09-23 原始 scheduler receipts；它們的 computed fire time／實際開始時間（Asia/Taipei）依序為 08:20:00／08:20:04、08:35:00／08:35:05、08:45:00／08:45:05、08:50:00／08:50:01。08:20 建立 `session-2026-09-23-76037f50e69a83f9ea26d78d`，outcome=`waiting_baseline`；08:35、08:45 同 session 均為 `generation_mismatch`；08:50 為 `calendar_authority_unavailable`，官方來源回傳 HTML 而非預期 JSON。失敗收據沒有覆寫或重跑。
- Session manifest 保存的 official authority 為交易日 2026-09-23、前一適用交易日 2026-09-22、來源 `TWSE and TPEx official annual calendars` 與 source version `sha256:2a6911b076ecf7d1678036862b5806d8d4a05aa63ab94730c912c908ec4941ff`。目前 manifest 仍為 `phase=waiting_baseline`、`baselineHash=null`、`blocker=baseline_missing`；預期的 `intraday-baselines/2026-09-22-for-2026-09-23-verified/baseline-set.json` 不存在。
- Manifest 的 160 檔逐檔資料全部為 `waiting_baseline`／`baselineState=missing`／`subscriptionState=none`，`firstKbarAt` 非空為 0；control-plane requested／accepted 均為 false。12:51:12 的 `/api/intraday-monitor/v1/status` 仍為 `feature_off/generation_mismatch`、session `current=false`、data active 0；互斥狀態為 `waiting_gate=160`、`waiting_pilot_limit=40`，另列 baseline missing 149／unknown 51，沒有把互斥狀態誤認為基準完整率。freshness evidenceAt 08:20:03、age 約 16,269,031 ms、budget 0、`fresh=false`，notification authority=false、broker write authority=false。
- 原始 session 與四份 receipts 的 SHA-256 依序為 `ce5a664b30a241559f8dbf5d23d8dab673c03cc45145a37f469d5a8724cf1d46`、`5f17d396f589d03ec3697814f3c494c5037ec690e1f5d78faa1d4981cbe2abf5`、`db5a5314ae8914f4c65d724f73f4e95400d05accacb77f4a759ab72532136562`、`8264f745f2e42583866718871ffcdd117bac08fdc2dee7668ee72dab2fff2523`、`d081296d334a1f6df86641cc672b72ed42fe95238bd4749cec03fb08260413e4`。這些雜湊只做證據識別，沒有複製或改寫原件。
- 結論：7.4 可以完成唯讀稽核與失敗證據保存，但「第一適用交易日的 baseline、control／data plane 與 fresh evidence 同時成立」仍不滿足；不勾選 7.4，不手改日期、session、receipt 或人工補一份 scheduler 成功紀錄。7.5／7.6 仍需由下一適用交易日自動 rollover 的真實結果判定。

### 13:01–13:04 基準建檔可行性與安全阻擋

- 既有 `direct-160-baseline.mjs` 確實以正式歷史 1 分鐘 K 棒的 `minute_delta` 累計 270 個已完成分鐘，並核對雙次歷史 K 棒、契約身分、官方交易日與逐筆成交量；問題不是計算方法不存在，而是 2026-09-22 對 2026-09-23 的 160 檔原始採集與 `baseline-set.json` 未產出。Application Support 的 `intraday-baselines` 目錄目前沒有任何名稱含 `2026-09-22` 的來源或基準檔；不能把其他交易日檔案改日期重用。
- 唯讀查詢既有 simulation API 的 `/api/v1/auth/usage` 得 `remaining_bytes=227813609`（約 217 MiB）；`collect-direct-160-baseline.py` 的起始安全門檻為 256 MiB，執行中保留門檻為 128 MiB，並要求資料交易日當天 13:35 後才可採集。故現況不符合原工具的執行前提；本次未降低保留門檻、未發起 160 檔歷史請求，亦未新增登入或訂閱。
- 13:01 `pnpm local-runtime status` 仍為 simulation、business session available、2330 Snapshot available、8080／5173／5174 up、production-readonly stopped、smart-order write master disabled。`/api/intraday-monitor/v1/status` 仍為 `generation_mismatch`，session 仍為 `waiting_baseline`、`baselineHash=null`、control-plane requested／accepted=false、dataActive=0、fresh=false。即使日後取得基準，也不能忽略既存 generation mismatch、改寫 08:20 session 或覆蓋失敗收據來宣稱今日通過。
- 現有 change 的 7.5 明訂「下一個適用交易日」自動 rollover 與 09:02 後的 live 驗收；因此 2026-09-23 單日無法完成整個跨日 change。若要修正每日自動建檔與 API generation 換代後的受控恢復，須先更新 OpenSpec 設計與安全驗收條件，另行實作與測試，不能在原始證據上補寫成功狀態。

### 13:19–13:30 後續實作與安全驗證

- 已在本 change 補充收盤後 1 分 K 基準建檔與未訂閱前 generation epoch 受控恢復的繁體中文 proposal、design、delta spec 與 tasks。採集器仍採既有 256 MiB 啟動、每 20 檔 128 MiB 執行中保留、8 GiB 磁碟保留、160 檔逐一雙抓及逐筆驗證；本次沒有降低門檻或使用圖表快取偽造基準。
- 新增 `postclose-daily-baseline.mjs`：台北時間 13:35 後依 TWSE／TPEx 官方日曆確認適用交易日與下一適用交易日，使用既有 simulation business session 和歷史採集器、builder；只有 160 檔與日期、cohort、官方日曆版本均合格才產出精確隔日 `baseline-set.json`。日期專屬 claim 與成功／失敗 receipt 不覆寫，`--status --date=YYYY-MM-DD` 提供唯讀查詢。既有基準檔損毀時不再採集覆寫；來源 159 檔、官方日曆無效或流量不足均保留失敗證據並不發布基準。跨年度日曆目前明確 fail closed，未當成成功。
- 08:35／08:45 受控恢復只接受同日、同 revision 與完整 Gate、原 session 160 檔均未訂閱且未收第一筆 KBar、今日 capture／observation／trigger 均不存在。恢復收據包含舊／新 generation 與舊／新 session identity hash；同 session 換代後重新查所有 Gate。08:50 若才發現換代仍 fail closed，不在資料擷取啟動步驟換代訂閱。2026-09-23 的原始 mismatch／calendar 失敗 receipt 均未修改。
- 13:22 唯讀 provider usage 為 `remaining_bytes=227592915`（約 217 MiB），低於 256 MiB；今天若排程執行，應記錄 `provider_bandwidth_reserve_insufficient` 並保持不採集。未以人工改日期執行 9/22 歷史工作，也未補寫 9/23 的 baseline 或 current session。
- 13:24 透過專用安裝入口安裝 `com.alanyi.realtimestock.intraday-postclose-baseline` LaunchAgent；`plutil -lint` 為 OK，`launchctl print gui/501/...` 讀回 `com.apple.launchd.calendarinterval` 的 `Hour=13`、`Minute=35`，當時 `runs=0`、`state=not running`，系統時區顯示 `CST`（Asia/Taipei）。它只執行 `postclose-daily-baseline.mjs --scheduled`，未啟停既有 API、watchdog、5173、5174，亦未登入、訂閱或下單。13:24 `--status --date=2026-09-23` 顯示 `not_claimed`；須等真實 13:35 觸發後另記 receipt，不能用 interval 文字冒充成功。
- 13:27 repo-wide `pnpm test`：260 個檔案、2607 項全部通過；另針對收盤後基準新增 10 項測試全過、generation repository／orchestrator 測試全過；`pnpm build`、`openspec validate repair-intraday-monitor-daily-rollover-and-status-truthfulness --strict`、`git diff --check` 通過。測試與建置不取代下一適用交易日的真實 simulation 驗收；7.4–7.7 暫不勾選。

### 13:35 真實 LaunchAgent 觸發結果（Asia/Taipei）

- `launchctl print gui/501/com.alanyi.realtimestock.intraday-postclose-baseline` 由安裝後 `runs=0` 變成 `runs=1`、`last exit code=1`；日期 claim 的 `claimedAt=2026-09-23T05:35:02.198Z`，即台北時間 13:35:02，不是人工執行或假設排程已觸發。
- 不可覆寫 receipt 的 `startedAt=05:35:02.214Z`、`endedAt=05:35:03.759Z`，官方 authority 確認 2026-09-23 → 下一適用交易日 2026-09-24、source version `sha256:2a6911b076ecf7d1678036862b5806d8d4a05aa63ab94730c912c908ec4941ff`。實際 outcome=`failed`、reason=`provider_bandwidth_reserve_insufficient`；當下 `remainingBytes=227509396`，啟動最低值 `268435456`，可用磁碟 `377746481152` bytes。這是安全拒絕，不是成功基準。
- 日期 claim 與 receipt 的 SHA-256 分別為 `36b9ed8c6c7808ef159ed33cd2fb78e8aec15df19b4d3e6ffcd50526288cd226`、`61495ec9076d25529290c0ad9b88bac7b6cf5d40cbec43601c5e80464f430855`，供後續唯讀交叉核對。
- 唯讀查詢確認 `2026-09-23-direct160-source` 與 `2026-09-23-for-2026-09-24-verified` 均不存在；沒有發出 160 檔採集，也沒有發布隔日 `baseline-set.json`。因每日 claim 不重試，不會在同日以補跑覆寫此失敗證據。
- 觸發後 `pnpm local-runtime status` 仍顯示 simulation API／business session／2330 Snapshot／5173／5174 可用，production-readonly stopped、smart-order write master disabled、watchdog restart count 0。四份 9/23 原始 premarket receipts 的 SHA-256 再次核對與 12:49 記錄完全相同。未改寫 session、原始收據、訂閱或服務生命週期。
- task 7.7 已取得真實 trigger 與失敗 receipt，但尚欠下一適用交易日 160 檔基準及受控換代的真實 simulation 驗收，保持未勾選；7.4–7.6 同樣未完成。若 provider 額度未補足既有安全門檻，2026-09-24 的盤中基準仍會缺席，不能宣稱跨日驗收完成。

### 2026-09-23 14:00–14:05 動態流量預算與同日重試實作

- 原本 13:35 的固定 256 MiB 判斷已由同 cohort、最近 30 日至少兩份完整驗證基準的實測成本取代；目前找到 2026-09-14、09-15 兩份 160/160 合格來源，provider 計費增量分別為 19,719,021、17,933,604 bytes。09-11 不同 cohort／159 檔來源沒有納入。14:00 唯讀查詢 quota 為 `limit_bytes=524288000`、`remaining_bytes=215737025`；同時點計算之保留額 131,072,000、三倍最大實測成本 59,157,063、所需 190,229,063 bytes，`ready=true`。這只是啟動可行性，不是已採集成功；採集器會在每個資料請求前再檢查額度。
- 首次 13:35 原始 claim／失敗 receipt 保持不變，14:04:55 再算 SHA-256 仍分別為 `36b9ed8c6c7808ef159ed33cd2fb78e8aec15df19b4d3e6ffcd50526288cd226`、`61495ec9076d25529290c0ad9b88bac7b6cf5d40cbec43601c5e80464f430855`。新嘗試改用獨立 `attempt-02`／`attempt-03` claim、budget、來源目錄與 receipt，最多三次；前次尚無 receipt 或成功則 no-op。
- 已安裝獨立的 `com.alanyi.realtimestock.intraday-postclose-baseline-retry` LaunchAgent；`plutil -lint` 為 OK，`launchctl print gui/501/...` 讀回 14:15／14:55 的 calendar interval，14:04:55 時 `runs=0`，尚未宣稱觸發成功。原 13:35 LaunchAgent 未重啟或修改。`pnpm local-runtime status` 回報 simulation、business session available、2330 Snapshot available、8080／5173／5174 up、production stopped、write master disabled、watchdog restart count 0；未登入、訂閱、下單或啟停服務。
- `pnpm exec vitest run scripts/intraday-monitor-runtime/*.test.mjs`：52 檔、332 項通過；動態預算／重試 focused tests 2 檔、17 項通過；Python budget guard 3 項通過；repo-wide `pnpm test` 261 檔、2615 項通過。`pnpm build`、OpenSpec strict validation 與 `git diff --check` 均通過。測試包含不同 cohort、少量樣本、quota 算術不符、採集中餘額驟降、舊首次收據保留、並行單次執行、第三次上限、成功後 no-op。
- tasks 3.9–3.12 為程式與離線測試已完成；7.4–7.7 仍待真實 scheduler、完整 160 檔建檔與下一適用交易日驗收，不以 `ready=true` 或 LaunchAgent loaded 代替。

### 14:15–14:29 真實重試與隔日基準驗證（Asia/Taipei）

- `launchctl print gui/501/com.alanyi.realtimestock.intraday-postclose-baseline-retry` 從 `runs=0` 變為 `runs=1`、最後 `last exit code=0`；獨立第二次 claim 的時間 `2026-09-23T06:15:01.269Z`，即台北時間 14:15:01。排程不是人工補跑。14:15:13 的預算 receipt 使用相同 cohort 的 09-15、09-14 完整樣本，provider 剩 215,554,762 bytes，動態需求 190,229,063 bytes，`ready=true`。第一份 13:35 失敗仍保留原文與原 hash，沒有改成成功。
- 採集進行中的 20／40／60／80／100／120／140 檔 usage checkpoints 均存在，分別記錄剩餘 211,623,453／207,855,012／199,130,555／196,918,577／195,967,566／194,466,245／192,788,290 bytes。採集器於每次資料請求前查額度；本次沒有碰到保留額或發生 quota 中途拒絕。來源 `usage-start` 剩餘 215,554,762、`usage-160` 剩餘 191,100,032，provider 計費增量 24,454,730 bytes，低於三倍歷史最大成本 59,157,063 bytes；結束時仍高於 131,072,000 bytes 保留額。
- 原始 `request-ledger.json` 共 1,290 筆；其中資料請求 640 筆（契約 160、K 棒 320、逐筆 160），usage 查詢 649 筆。逐筆檢查 ledger 順序，640 筆資料請求每筆前一筆均為 `/api/v1/auth/usage`，證明不是只在啟動時查一次額度。這是現有共用 session 的 REST 歷史採集，不是新增行情訂閱。
- 來源 `complete.json` 為 `collected=160` 且明示 `awaiting_independent_validation`，不能單憑採集完成宣稱成功。獨立 `verification.json` 之後確認 `verifiedCount=160`、`expectedCount=160`、`baselineUsable=true`、`minuteCount=43200`、failed results=0，來源目錄指向本次 `2026-09-23-direct160-attempt-02-source`。已發布的精確檔案 `/Users/alanyi/Library/Application Support/RealTimeStock/intraday-baselines/2026-09-23-for-2026-09-24-verified/baseline-set.json` 含 160 個 manifests，官方目標交易日 2026-09-24，`validateDirect160BaselineSet` 在目前 immutable cohort 下回傳 true；baseline hash 與第二次收據同為 `17527f9f4896ad8bcd4eacf43a26f2a3dd92e3d7fd72688bf58558472047e08a`。來源記錄的 budget hash 與 budget 檔、第二次收據的 budget hash 皆一致。
- 14:29 再算原始 claim／失敗 receipt SHA-256 仍是 `36b9ed8c6c7808ef159ed33cd2fb78e8aec15df19b4d3e6ffcd50526288cd226`／`61495ec9076d25529290c0ad9b88bac7b6cf5d40cbec43601c5e80464f430855`；第二次 claim／成功 receipt 的 SHA-256 為 `95cbfa15fc5768184c8e90c9dcad461f76ef25e8c9b0057aaff1ea523ec56982`／`9d49be42865778d4959e81c063b0429910e36ba3b172f856d495ccbdc4f1a985`。14:29 第三次 claim 尚不存在；14:55 排程屆時應因已 verified 而 no-op，**目前尚未把尚未發生的 14:55 行為寫成實測通過**。
- `pnpm local-runtime status` 在成功後仍為 simulation、business session available、2330 Snapshot available、API／Web／MultiView up、production stopped、write master disabled、watchdog restart count 0；未啟停服務、另行登入／訂閱或下單。新 09-23 成功來源已可由後續樣本讀取器驗出，計費增量 24,454,730 bytes 與同 cohort 09-15、09-14 兩筆一起供將來預算估算。
- 這項結果完成「9/24 隔日基準檔建立」的真實驗證，但不能回填 9/23 早上的 `baseline_missing`、`generation_mismatch` 或官方日曆失敗，也不構成當日 task 7.4 通過。7.5／7.6／7.7 仍須 9/24 自動 rollover、真實盤中 sealed-minute／Gate／受控換代政策跨日驗收；不得現在歸檔。

## 2026-09-24 跨交易日驗收：未通過的部分 dossier（Asia/Taipei）

本次於 16:08–16:14 唯讀稽核既有 simulation runtime、原始收據、API 與使用者已開啟的瀏覽器分頁；**不是 09:02 當下的盤中觀測**。只處理 task 7.5／7.6，沒有手動補跑 premarket step、建立 session、改日期、登入、訂閱、啟停服務、下單或改寫原始 evidence。

### 已證實的成功與保留證據

- 前一交易日 9/23 自動重試產出的 9/24 基準仍在：runtime artifact bundle 驗證有效；`validateDirect160BaselineSet` 對目前 immutable 160 檔 cohort 與目標交易日 2026-09-24 回傳 `true`，`baselineHash=17527f9f4896ad8bcd4eacf43a26f2a3dd92e3d7fd72688bf58558472047e08a`。這只證明可用基準已備妥，**不代表今日 session 已使用它**。
- 9/23 原始收盤後第一次失敗 receipt 與第二次成功 receipt 的 SHA-256 仍分別為 `61495ec9076d25529290c0ad9b88bac7b6cf5d40cbec43601c5e80464f430855`、`9d49be42865778d4959e81c063b0429910e36ba3b172f856d495ccbdc4f1a985`，與昨日紀錄相同。
- 16:12 再以正式 TWSE／TPEx 年度日曆唯讀解析，得到 `current=true`、2026-09-24 為適用交易日、上一適用交易日 2026-09-23、source version `sha256:2a6911b076ecf7d1678036862b5806d8d4a05aa63ab94730c912c908ec4941ff`。這表示**查詢時**來源可用，不能倒填成 08:20 或 08:50 成功。
- `pnpm local-runtime status` 顯示 simulation API 與 business session 可用、watchdog 無重啟、5173／5174 運作、production-readonly stopped、smart-order write master disabled；8080 `/api/v1/info` 的 `simulation=true`。唯讀 2330 Snapshot 回傳 2026-09-24 14:30:00、累計量 13,005 張；這只證明共用行情／business session 可用，不是監控 cohort 的首筆 KBar。

### 失敗與未通過的 Gate

- 9/24 只有 `premarket/receipts/2026-09-24-0820.json` 與 `2026-09-24-0850.json`；08:35／08:45 receipts 缺席，9/24 claims 與 `session-state/sessions` 中的 9/24 session 也缺席。LaunchAgent plist 與 `launchctl print` 都列有四個 calendar triggers，但 `runs=3`、`last exit code=1` 不能證明 08:35／08:45 曾成功執行；不補造缺失收據。
- 08:20 receipt 的 computed／actual 為 08:20:00／08:21:17，`rolloverOutcome=failed`、`reason=calendar_authority_unavailable`、authority reason=`fetch failed`、`sessionId=null`。08:50 receipt 的 computed／actual 為 08:50:00／08:48:23，亦為相同失敗與 `sessionId=null`；實際時間比計算觸發時間早 97 秒，另列為 scheduler 時序異常，原因尚未證實。兩份收據的 SHA-256 分別為 `47eadbd18006180795efee567ea589b7bd046fe32656526c87b9578f4326c924`、`353ae288d9ca4b553c22f734111583befb25fc1b1e793fc0cd8f25bc117625d9`。
- 9/24 `premarket/events.jsonl` 保留兩筆 `scheduler_calendar_authority_unavailable` 與一筆 09:04:08 的 `premarket_failure`／`premarket step input is invalid`；後者不能當成任一指定 step 的成功 receipt。沒有刪除或覆寫這些事件。
- 16:10–16:13 讀取 5173 本機監控 API：`/status` 為 `feature_off/current_session_missing`，authority trade date=9/24、session trade date=null、`current=false`、control-plane requested／accepted=false、firstKbarAt=null、dataActive=0、notificationAuthority=false；互斥等待數為 waitingGate=160、waitingPilotLimit=40，baseline summary 在**目前 session 投影**為 unknown=200，fresh=false。`/diagnostics` 無 completed minute；`/results?tradeDate=2026-09-24` 為 `items=[]`、`authority=unverified`、`replayNotificationAuthority=false`。不能以獨立基準檔 160/160 取代 session 內的 baseline summary。
- 既有瀏覽器 `?layout=intraday-stock-selection` 分頁顯示歷史 `160 · GO · 2026-09-16 · Codex 代理審閱` 與「今日未啟動」、data active 0、未接受訂閱、尚無首筆、evidence stale，這部分如實；**但空結果區卻同時顯示「監控已啟動，目前沒有達標結果」**，與 current-session 狀態互相矛盾，UI 語意 Gate 未通過。原始碼在 `src/components/intraday-monitor-panel.tsx` 的 `emptyResultMessage` fallback；本輪只記錄問題，沒有改動程式或把它說成通過。該分頁 console 另有 Vite WebSocket 連線失敗與 React `Maximum update depth exceeded`，目前無法把其成因歸給監控面板，保留為待查異常。

### Partial／unknown 邊界與回歸

- API generation 檔目前為 `simulation:a13b7ee2-c275-46f5-8eb5-abef72414ee7`，但因 9/24 session 不存在，無從驗證當日 generation anchor 或受控換代。`/api/v1/stream/status` 在瀏覽器唯讀檢查前後均為 8 個 connections，監控 lease 數為 0；不能據此推論所有 physical subscription ownership 已證實。
- 因無當日 session 與 control-plane acceptance，09:02 後第一筆合法 KBar、sealed-minute 同分鐘累計量比較、逐檔 data-plane freshness、達標結果及通知 Gate 均**沒有成功證據**。09:02 當下網路事件未在本次取得，明列 unknown；收盤後空結果與零 active 是 fail-closed 現況，不是盤中計算正確的證明。
- focused Node／Vitest：`pnpm exec vitest run scripts/intraday-monitor-runtime/premarket-orchestrator.test.mjs scripts/intraday-monitor-runtime/premarket-daily-session.test.mjs scripts/intraday-monitor-runtime/current-session-authority.test.mjs src/lib/intraday-monitor-view-model.test.ts` 為 4 檔、25 項通過。首次誤將 browser test 放進一般 forks pool，得「vitest/browser can be imported only inside the Browser Mode」；改用 `--config vitest.browser.config.ts` 後 13 項中 9 通過、4 失敗，表現為 fixture 交易日固定 2026-09-04、執行當日 2026-09-24 時，預期的 live event／通知／frame 未出現。日期不一致是可能原因，但本次未獨立完成根因證明，不將測試失敗記為通過。失敗截圖保留在 `src/components/__screenshots__/intraday-monitor-panel.browser.test.ts/`，未刪除或修飾。這些離線測試不能代替盤中驗收。
- `openspec validate repair-intraday-monitor-daily-rollover-and-status-truthfulness --strict` 與 `git diff --check` 通過；由於本 change 目錄在現有混合工作樹中尚未追蹤，另外對本 acceptance 檔執行 `git diff --no-index --check /dev/null <file>`，沒有空白錯誤輸出（exit 1 僅表示檔案與空檔不同）。
- 結論：7.5 **未通過**（9/24 durable scheduler 未建立 current session）；本節構成 9/23＋9/24 的**部分 dossier**，但 7.6 的完整兩日 Gate 與 UI/API 語意未通過，**不得標記 ready for archive**，兩項 tasks 均保持未勾選。應另行修復官方日曆間歇失敗／scheduler 缺失與 UI 空結果文案後，等待下一個適用交易日的真實自動 rollover，再做 09:02 live acceptance；不能重寫 9/24 歷史。

### 下一適用交易日接續

- 16:16 由正式 TWSE／TPEx 年度日曆唯讀解析，下一適用交易日為 **2026-09-29**，上一適用交易日為 2026-09-24；不是把週末或休市日當盤中驗收日。
- 將原有的一次性 thread heartbeat 更新為 2026-09-29 跨日驗收；首次更新後唯讀查到 scheduler `next_run_at` 誤落在台北 17:02，已立即更正。最終 scheduler database `next_run_at=1790643720000`，換算 **Asia/Taipei 2026-09-29 09:02:00**；這是實際排程欄位讀回，不只依名稱或規則文字推定。
- 後續排程仍須保留 9/23、9/24 failed／partial 證據，且只有當天 premarket 自動 rollover 與 live Gates 完整成立才能勾 7.5／7.6。本輪沒有把 9/24 的失敗改寫為成功。

## 2026-09-28 補查 9/24 排程與歷史基準補建（Asia/Taipei）

### 原始失敗診斷（不改寫 9/24）

- `pmset -g log` 顯示 9/24 08:21:16 為約 45 秒 DarkWake，08:22:01 再入睡；08:32:36 再短暫 DarkWake，08:33:21 入睡至 08:48:22。故 08:35、08:45 均落在睡眠期間，且 `premarket/claims`、`receipts` 與 `events.jsonl` 均無兩步執行紀錄；這解釋了缺席，但不能補造成功或失敗收據。
- 08:20 收據實際開始 08:21:17，正落在 DarkWake；08:50 收據實際開始 08:48:23，也正落在 DarkWake。`premarket-orchestrator.mjs --scheduled` 以與指定 step 相差不超過兩分鐘來歸類啟動，故 08:48:23 被歸到「08:50」；這是程式的時點歸類行為，不能據此宣稱 08:50 準點觸發。兩份原始收據仍是 `calendar_authority_unavailable`／`fetch failed`。
- `pmset -g log` 另顯示 13:42:02 再次短暫 DarkWake；原 postclose claim 為 13:42:03、receipt 於 13:42:03.758 結束，`reason=fetch_failed`，在約 75 毫秒內失敗。睡眠／DarkWake 與排程延後、即時外網連線失敗高度吻合。原收據沒有每個官方來源的 URL／HTTP／網路例外，**無法追溯究竟是 TWSE、TPEx 或本機網路哪一層失敗**，不以事後成功冒充當時可用。
- 9/28 唯讀重查官方兩端點均為 HTTP 200／JSON；現時重新解析的 9/24 官方適用交易日及下一交易日為 9/29，source version `sha256:2a6911b076ecf7d1678036862b5806d8d4a05aa63ab94730c912c908ec4941ff`。這只供事後補建，不改寫 9/24 authority failure。
- 補建前原 9/24 postclose receipt／claim 的 SHA-256 為 `33224d01364301341073d469e38f7d95a385efd85083b0e0330098372c410a00`／`13effc3f062d37a411dc6a42c15edab2511ec7c28b9093e2648ba81faf435d98`；08:20／08:50 receipt 的 SHA-256 仍為 `47eadbd18006180795efee567ea589b7bd046fe32656526c87b9578f4326c924`／`353ae288d9ca4b553c22f734111583befb25fc1b1e793fc0cd8f25bc117625d9`。

### 歷史補建安全界線與驗證狀態

- 新增明確 `--historical-backfill=<來源交易日>` 路徑：只可讀取過去 1–30 日、下一官方交易日仍在未來的來源，獨立 claim／budget／source／receipt，原同日排程 namespace 不動；最多三次，任一次 claim 無 receipt 會 fail closed。採集器仍用既有 simulation session、串行限速、30 分鐘總期限、單回應 16 MiB、動態額度預算與每請求檢查，不執行 login、subscription、服務生命週期或交易寫入。
- 當前固定 160 檔 cohort 驗證有效；既有完整實測樣本 9/23、9/15、9/14 的 provider 用量分別 24,454,730、17,933,604、19,719,021 bytes。補建前 `remaining_bytes=522,742,352`；有界預算 `requiredStartBytes=204,436,190`，其中保留額 `131,072,000`、預估 `73,364,190`，狀態 ready。這是補建前讀值，不保證採集中額度不變；採集器每次資料請求仍重查。
- 9/24 的 2330 歷史來源初次實測只有 266 根 KBar；逐筆來源對缺的四分鐘為零成交，原 verifier 因沒有零量證明而正確拒絕。已改為僅在同日 ticks 該分鐘為零、KBar 與 ticks 全日量一致、雙抓一致時才補零分鐘；2330 獨立檢查變為 270 分鐘、末量 12,990 張。非零缺口仍拒絕，不能用填補冒充有成交的 KBar。此修正須待整體 160/160 驗證後才可發布。

### 事後補建結果與保留證據

- 2026-09-28 **18:04:58–18:17:09 台北時間**執行唯一一次 `--historical-backfill=2026-09-24`；獨立 receipt 位於 `IntradayMonitor/historical-baseline-backfill/receipts/2026-09-24-attempt-01.json`，記錄 `historicalBackfill=true`、`scheduledRunAttribution=not_applicable`、`outcome=verified`。這不是 9/24 13:35 或 9/29 08:20 排程成功的證據。
- 採集器完成 160 檔，來源 `complete.json` 仍標 `baselineUsable=false`／等待獨立驗證。來源 usage 由 `remaining_bytes=522,732,675` 降至 `503,922,877`，實測消耗 **18,809,798 bytes**，未觸及 `requiredStartBytes=204,436,190` 的啟動 Gate，且逐請求保留額檢查通過。
- 正式 `verification.json` 為 `verifiedCount=160`、`expectedCount=160`、`minuteCount=43,200`、failed=0，160 筆結果各 270 個已封閉分鐘，`baselineUsable=true`。獨立讀回 `baseline-set.json` 有 160 個 manifests／43,200 分鐘；`validateDirect160BaselineSet` 對現有不可變 cohort 與目標 9/29 回傳 true，`liveCaptureAcceptance=false`，bundle hash `7a83d91225f590238177bbaca14c073f049cc9bd2c372abb1c09d808006fb7e8` 與補建 receipt 相同。
- 原子發布精確檔案 `/Users/alanyi/Library/Application Support/RealTimeStock/intraday-baselines/2026-09-24-for-2026-09-29-verified/baseline-set.json`，其 verification 檔同目錄。補建後重算原 9/24 postclose receipt／claim、08:20／08:50 receipt 的 SHA-256，四者與本節「補建前」完全相同；08:35／08:45 仍沒有收據，沒有偽造或補寫。
- 補建前後 `pnpm local-runtime status` 均為 simulation／business session 可用、8080／5173／5174 運作、production stopped、smart-order write master disabled、watchdog restart count=0。只使用既有 API 的歷史契約、KBar、ticks、usage 與 2330 Snapshot 唯讀請求；沒有 login、subscription、服務啟停或交易寫入。**9/29 自動 session、data-plane、sealed-minute 比較、results 與通知 Gate 尚未驗收**，7.4–7.7 保持未勾選。
- focused Vitest 以 `pnpm exec vitest run` 執行 postclose runner、bandwidth budget、builder、direct baseline 四檔，共 23 項全過；`npx openspec validate repair-intraday-monitor-daily-rollover-and-status-truthfulness --strict` 通過；`git diff --check` 通過。change 及新增 runner／test 為未追蹤檔，另以 `git diff --no-index --check /dev/null <file>` 核對，無空白警告（exit 1 僅表示檔案與空檔不同）。未執行 archive、commit、push。

## 2026-09-28 18:36 台北時間：空結果文案修正與 9/29 開盤前唯讀核對

### 面板文案與回歸測試

- 原面板狀態標籤已能將 `session.current=false` 顯示為「今日未啟動」，但空結果區只處理少數等待狀態，其預設分支錯稱「監控已啟動，目前沒有達標結果」。改以同一 view-model 判斷空結果文案；session／freshness 不成立時顯示「今日監控未啟動，沒有可驗證的當日達標結果」，paused、reconnecting、首筆 KBar、pilot limit 等各有明確文案。只有 current session、freshness、`active`、lease accepting events、data active 同時成立，才顯示「監控已啟動」。
- View-model 單元測試 4/4 通過，包含缺 session／過期 freshness／lease 關閉／重新連線與真 active。Browser regression 直接檢查 2026-09-16 歷史 `GO`、今日未啟動且零結果時，不出現錯誤啟動文案。完整面板 browser tests 最終 13/13 通過。
- 首次執行完整 browser tests 時有 4 項既有通知 fixture 失敗：假 session／事件固定在 9/4，且假 lease 到 2099 年造成 `setTimeout` 超過計時器上限後立即續租、fixture 無續租回應而失效。只把這些通知 fixture 改為執行當日交易日與 60 秒有效 lease，保留產品對舊交易日事件的拒絕規則；重跑 13/13 通過。`pnpm build` 成功（Vite 僅有既有大 chunk 警告）。

### 9/29 唯讀 preflight：已證實與限制

- 9/28 官方 TWSE／TPEx 年度日曆查詢成功，`current=true`、9/28 非交易日、上一適用交易日 9/24；以 9/24 為來源解析的下一適用交易日為 **9/29**，source version `sha256:2a6911b076ecf7d1678036862b5806d8d4a05aa63ab94730c912c908ec4941ff`。這是查詢時 authority 可用，不代表 9/29 08:20 查詢必然成功。
- 讀回 immutable runtime artifact bundle 有效、cohort=160；9/24→9/29 已發布的 `baseline-set.json` 仍為 160 個 manifests／43,200 個分鐘，`verification.json` 為 160/160、failed=0、`baselineUsable=true`，`validateDirect160BaselineSet` 對現有 cohort 及 9/29 回傳 true，hash `7a83d91225f590238177bbaca14c073f049cc9bd2c372abb1c09d808006fb7e8`。容量 approval 為 160／`go`，其 bundle hash 與目前 runtime bundle 相同；9/29 session 目前尚不存在，不能宣稱 live ready。
- `pnpm local-runtime status` 顯示既有 simulation API／business session／2330 Snapshot／8080／5173／5174 可用、watchdog healthy 且 restart count=0、production stopped、smart-order write master disabled。使用 9/29 正式基準路徑執行 **唯讀** `inspectPremarketGates(..., requireStableGeneration:false)`，simulation、API generation、business session、Snapshot、Web、MultiView、artifact、160 cohort、baseline、disk 及 broker write blockade 全通過，`brokerWriteAuthority=false`；磁碟可用 376,265,932,800 bytes。此檢查不建立 session、沒有 login／subscription／交易寫入，也不等同 9/29 開盤時 Gate。
- 現有 generation 與舊 generation anchor 不一致；08:20 預期由原 scheduler 流程重新 warmup／錨定，08:35／08:45 須重新檢查穩定性，不能把本次 `requireStableGeneration:false` 的成功當成 08:35 Gate 成功。9/29 的 08:20／08:35／08:45／08:50 claim 與 receipt 目前均不存在，符合排程尚未執行；不補造它們。
- `LaunchAgent` 已載入，plist 與 `launchctl print` 均列出每日本地 08:20、08:35、08:45、08:50 四個 calendar triggers；依官方下一交易日，計畫時點為 9/29 台北時間上述四時。`launchctl print` 未提供四個 **實際 next fire** 的可靠讀值，因此只確認已載入與設定，未宣稱 scheduler 明早必定觸發。`pmset -g sched` 未列出 9/29 開盤前明確 wake event，且系統 sleep 設定為 1 分鐘；9/24 曾因睡眠使 08:35／08:45 沒執行，明早無人值守仍有風險。未變更電源政策或排程。
- 原 9/24 postclose receipt／claim 及 08:20／08:50 receipt 的 SHA-256 再次核對，依序仍為 `33224d01364301341073d469e38f7d95a385efd85083b0e0330098372c410a00`／`13effc3f062d37a411dc6a42c15edab2511ec7c28b9093e2648ba81faf435d98`／`47eadbd18006180795efee567ea589b7bd046fe32656526c87b9578f4326c924`／`353ae288d9ca4b553c22f734111583befb25fc1b1e793fc0cd8f25bc117625d9`；08:35／08:45 歷史收據仍缺席，沒有覆寫或美化。
- 7.4–7.7 的跨日 live acceptance 仍待 9/29 真正 scheduler、first KBar、sealed-minute 比較、results、notification Gate 與 freshness 證據；本節只完成文案修正及 preflight，不標記 ready for archive。
- 本輪 `npx openspec validate repair-intraday-monitor-daily-rollover-and-status-truthfulness --strict` 通過；`git diff --check` 通過。對本 change 的未追蹤檔逐一執行 `git diff --no-index --check /dev/null <file>` 無空白警告；exit 1 僅表示檔案與空檔不同。未執行 archive、commit、push。

## 2026-09-28 19:35 台北時間：明早排程與睡眠風險處置

- `pmset -g batt` 顯示 AC 已接、電池 80%；AC 與電池模式的系統 sleep 均為 1 分鐘。`pmset -g sched` 沒有 9/29 開盤前的喚醒事件；`LaunchAgent` 已載入且 plist 有 08:20、08:35、08:45、08:50 四個時點，但「已載入」不等於明早一定執行。
- 嘗試以非互動管理員權限建立 9/29 08:10 的一次性 wake event，`sudo -n pmset schedule wake` 回覆 `a password is required`，**沒有成功建立**，也未改寫 macOS 電源設定。改啟動有界的 `caffeinate -is` 防睡眠程序；為避免依賴互動終端，最後以使用者層 `launchctl submit` 建立只執行一次、50,000 秒後自動退出的 `com.alanyi.realtimestock.premarket-awake-20260929`，關閉先前互動測試程序。`launchctl print` 讀回該 job 為 `state=running`、`runs=1`，`pmset -g assertions` 讀回 `PreventSystemSleep=1`、`PreventUserIdleSystemSleep=1`。這是當下有效的防**自動**睡眠措施，不保證關蓋、拔除 AC、手動睡眠、登出或 Mac 關機時仍會觸發排程；因無管理員權限，尚不能宣稱喚醒風險完全排除。
- 既有一次性 thread heartbeat `automation` 已更新為同時驗收盤中監控、分價量表及即時資金流向，移除過時的「空結果文案仍錯誤」描述。從 Codex scheduler 資料庫唯讀讀回 `status=ACTIVE`、`next_run_at=1790643720000`，換算台北時間為 **2026-09-29 09:02:00**；這是 Codex heartbeat 時點，與上述四個 macOS LaunchAgent 執行時點不同。
- 本節只處理明早可觀測性與睡眠風險，不建立今日 session、補造收據、登入或訂閱；7.4–7.7 保持未完成。明早須先驗證四個原始 scheduler receipts 與 160 檔 baseline，再以真實盤中資料判斷結果，不得以防睡眠 assertion 或 heartbeat 觸發冒稱功能驗收成功。

## 2026-09-28 20:10 台北時間：官方日曆短暫錯誤的有界補強

- 讀取 9/28 原始 premarket 紀錄：08:35／08:50 留下 `calendar_authority_unavailable`、底層 `fetch failed` 收據，其他時點不能由 `LaunchAgent` 已載入推論成功；`pmset -g log` 顯示 08:19:28、08:35:14、08:48:57 進入 Maintenance Sleep，08:34:29、08:48:12 為 DarkWake。今晚原函式與修改後函式均可取得雙來源正式日曆，判定 9/28 非交易日、上一適用交易日 9/24。這些證據支持早晨睡眠／網路不可用風險，但無法從既有紀錄證明每筆 `fetch failed` 的精確網路層原因。
- `trading-calendar-authority.mjs` 現在每次 TWSE／TPEx 雙來源擷取及解析共用 4 秒期限，逾時中止；同一年度來源最多三次嘗試，失敗後等待 250／500 毫秒。每次成功仍需兩份正式來源皆回 HTTP 200 並完成既有年份／欄位／日期解析，沒有使用舊快取、單來源或推測交易日。若三次皆失敗，維持 `current=false`、`calendar_authority_unavailable`；原 premarket step 保存失敗 receipt、不建立 session claim。此次沒有變更 08:20 建 session、後續時點唯讀核對的既有契約。
- 回歸測試以 fixture 證明首次 `fetch failed` 後成功、三次全失敗、官方端點回 HTML 與來源完全不回應均有界結束，另確認 08:20 全失敗時 receipt 為 failed、session id／claim 為 null。`pnpm exec vitest run` 指定日曆、premarket orchestrator、daily session、postclose baseline、direct baseline 與官方核心來源六檔：**51／51 通過**；`pnpm build` 通過（僅既有大 chunk 警告）；`npx openspec validate repair-intraday-monitor-daily-rollover-and-status-truthfulness --strict` 通過；`git diff --check` 通過。
- 20:10 唯讀重查仍為 simulation、business session／2330 Snapshot／5173／5174 可用、production stopped、write master disabled，既有 Codex heartbeat `next_run_at` 仍是 9/29 09:02 台北時間。本輪沒有登入、訂閱、重啟服務、建立今日 session、覆寫任何舊收據、archive、commit 或 push。**重試與離線測試不能證明 9/29 早晨來源一定可用或 live rollover 成功**；tasks 7.4–7.7 仍待明天真實驗收。

## 2026-09-29 09:02–09:11 台北時間：真實排程失敗與盤中 Gate 反例

- 官方 authority 將 9/29 判為適用交易日、上一適用交易日為 9/24；9/24→9/29 歷史基準原檔保持 160/160、43,200 個封閉分鐘。08:20 真實收據為 `session_created`；08:35、08:45 均為 `step_complete`，同一 session id。08:50 原始收據則為 `failed`／`direct_160_capture_failed`，於 08:50:06–08:50:07 結束。`premarket/events.jsonl` 的 `capture_failure_sidecar` 指向原始失敗檔，底層 TypeError 為 `direct 160 product sink inputs are invalid`。本節不重跑、改寫或補造任一 claim／receipt。
- 以唯讀 SQLite 和 immutable cohort 比對：目前設定有 200 檔 enabled；設定順序的前 160 檔與核准 cohort 有 **140 個位置不同**，其中 **11 檔是集合差異**，而該 11 檔核准 cohort 商品甚至不在目前 200 檔 enabled 設定中。`createDirect160ProductSink` 要求前 160 檔順序及商品皆與核准 manifest 一致，因此 08:50 啟動前正確 fail closed，沒有向不同 cohort 偷換訂閱。這不是基準檔缺失：9/24 基準 160 檔各有 270 分鐘，核准 product state 仍為 160／`complete_go`，manifest hash 與 immutable cohort 相同。要恢復監控須另行明確處理設定與核准 cohort 的差異，不能在已開盤的 9/29 臨時替換名單或補造排程成功。
- 09:03 `pnpm local-runtime status` 為 simulation、business session 與 2330 Snapshot 可用、8080／5173／5174 正常、watchdog restart count 0、production stopped、write master disabled。09:09 唯讀 `/api/intraday-monitor/v1/status` 仍投影 `session.phase=starting`、`controlPlaneRequested=false`、`controlPlaneAccepted=false`、`firstKbarAt=null`、`dataActive=0`、`waitingGate=160`，但在 20 分鐘 freshness budget 未過前同時回 `session.current=true`、`capacity.notificationAuthority=true`、`reason=none`。這與已存在的 08:50 failed receipt 不一致，是今日 status truthfulness 缺口；不能用 `current` 或 `notificationAuthority` 推論已有真實成交監控、結果或通知。未修改正在運作的 API／排程／session。
- 因 08:50 未建立 control-plane、沒有第一筆合法 KBar、sealed-minute 對照及今日結果證據，tasks 7.4–7.7 **保持未完成**。9/23、9/24 的 failed／partial 原始證據及本日失敗 sidecar 原樣保留；本節是 failed／partial 驗收，不是跨日成功 dossier。
- 09:13 前後復核 runtime 仍為 simulation、business session／2330 Snapshot 可用、8080／5173／5174 運作、watchdog restart count 0、production stopped、write master disabled。原 08:50 receipt 與 failure sidecar SHA-256 依序為 `ee82b73dfa6925a10690cef69b0cf9bb9b02379c10a58e8a34a74f9cd82b1533`、`cf4081b03fb592ae2cf709094b6f8a1f7d1be2bd9b1453db13eca4ff59e46c11`。本輪 focused current-session／premarket tests 20/20 通過，三個 change strict validation 與 `git diff --check` 通過；無 archive、commit、push。

## 2026-09-29 09:19–09:24 台北時間：當日重啟驗收評估與狀態誠實性修正

- 使用者要求在本交易日重啟盤中監控驗收。再次唯讀比對核准 cohort 與設定：原核准 160 檔之中，`2303.TW`、`2317.TW`、`2412.TW`、`2603.TW`、`2615.TW`、`2891.TW`、`2801.TW`、`2834.TW`、`2881.TW`、`2882.TW`、`6756.TW` 不在現有 200 檔 enabled 設定中；前 160 檔另有 140 個位置不一致。這是 08:50 `direct_160_capture_failed` 的具體前置條件缺口，不是少 11 個基準檔。目前沒有修改使用者清單或原核准檔案。
- 現有正式 `full-session` capture 限定當日 08:50:00–09:00:30 開始，盤中已錯過；`partial-rehearsal` 雖可於 09:01 後有界執行，但程式明定不能接入 product runtime，亦不會補出 08:50 的自動排程成功、09:02 第一筆 KBar 或完整跨日證據。當日調整名單會使已建立的 session revision 不一致，不能重寫 session、假造 08:50 receipt 或放寬開始時限以宣稱 tasks 7.4–7.7 完成。原收據與失敗 sidecar 保持不變。
- 針對 09:09 發現的狀態誤判，current-session authority 現在讀取同交易日真正 08:50 receipt；若 `rolloverOutcome=failed`，立即 fail closed 為 `premarket_capture_failed`，UI 顯示中文具體原因。09:23 本機 API 唯讀回應已觀察 `session.current=false`、`reason=staleReason=premarket_capture_failed`、`controlPlaneRequested=false`、`firstKbarAt=null`、`dataActive=0`、`notificationAuthority=false`，不再於 20 分鐘 freshness 視窗內誤報今日可用。此修正沒有重啟服務或新增訂閱。
- focused current-session 與 view-model 測試 14/14 通過，`pnpm exec tsc --noEmit`、本 change OpenSpec strict validation、`git diff --check` 均通過。09:23 `pnpm local-runtime status` 仍為 simulation、business session／2330 Snapshot／8080／5173／5174 可用、watchdog restart count 0、production stopped、write master disabled。今日 live full-session 驗收仍為 **failed／未完成**；不得將本次狀態修正或未來盤中 partial rehearsal 記為正式驗收成功。

## 2026-09-29 09:38 台北時間：盤中補測與名單調整前保全

- 使用者要求立即調整清單並盡可能於今日驗證。現有 repository 設定上限 200 檔；原核准 160 檔與目前 200 檔的聯集為 211 檔。依現有額外商品原順序保留前 40 檔、暫移尾端 11 檔，可形成 200 檔且前 160 檔與原 manifest 完全同序的合法 draft；`validateIntradayMonitorConfig` dry-run 通過。尾端 11 檔為 `1414.TW`、`1455.TW`、`1468.TW`、`1599.TWO`、`1616.TW`、`2230.TWO`、`2347.TW`、`2528.TW`、`2548.TW`、`2726.TWO`、`2923.TW`。因這會改變使用者目前清單，已請求確認，尚未執行設定替換。
- 先以 SQLite `.backup` 在本機 Application Support `IntradayMonitor/config-backups/2026-09-29-vuzDyV/intraday-monitor.sqlite3` 保存原 revision 8／200 檔；備份檔 `PRAGMA integrity_check=ok`，SHA-256 為 `953af26f7a0771543b31a0d374330079639c68a2c45e64feb48c93db78aac64e`。備份不含使用者憑證，不在 repo，也沒有改寫原設定。
- 透過既有 simulation API，對核准 cohort 的 `2303.TW`、`2317.TW`、`2412.TW` 各以當日 `POST /api/v1/data/kbars` 唯讀雙次查詢；截止 09:37 的 37 根 1 分 K 兩次內容相同，與 9/24 正式基準同分鐘累積量依序為 `42,209／45,449`（0.9287）、`10,325／15,531`（0.6648）、`1,808／1,499`（1.2061）。這是今日真實歷史 K 棒與基準的有限補測，**不是**監控 runtime 的真實 SSE、第一筆合法 KBar、160 檔 data active、trigger 或 notification 驗收；不勾 7.4–7.7。
- 補測後 provider `remaining_bytes=522,517,247`、`connections=1`；此 connection 數不證明全域 subscription ownership。原 08:50 failed receipt SHA-256 再讀仍為 `ee82b73dfa6925a10690cef69b0cf9bb9b02379c10a58e8a34a74f9cd82b1533`。未新增登入／訂閱、沒有 production、broker write、服務重啟、archive、commit 或 push。

## 2026-09-29 09:59–10:07 台北時間：核准後暫移 11 檔與當日唯讀補測

- 使用者明確同意暫移前節列出的 11 檔。先複查原 revision 8 備份 `config-backups/2026-09-29-vuzDyV/intraday-monitor.sqlite3`，SQLite integrity=`ok`、SHA-256=`953af26f7a0771543b31a0d374330079639c68a2c45e64feb48c93db78aac64e`。再透過既有設定 repository 的 revision guard 原子替換為 revision 9：核准的 160 檔保持原 manifest 精確順序置於前段，後段保留原設定額外商品中最前面的 40 檔，總數仍為 200 enabled。既有商品的 source／門檻設定照原值保留；補回的 11 檔核准商品以 `manual` 來源及無個別覆寫值建立。沒有修改 immutable cohort／baseline、建立新 session、補造排程收據或改動服務生命週期。
- revision 9 SQLite 讀回 `integrity_check=ok`、200 configured／200 enabled、前 160 檔與核准 cohort 完全同序。10:06 對既有 runtime 做唯讀 preflight：simulation、API generation、business session、2330 Snapshot、5173、5174、artifact、160 檔基準、configured cohort、磁碟、generation anchor 與 broker write blockade 均為 true；`configuredCohort={matches:true,enabled:200}`。這證明**當前設定**符合下一次盤前檢查，不代表今日 08:50 的失敗已修復。
- 補強盤前檢查，直接從設定 SQLite 唯讀比對前 160 檔與核准 manifest 的商品及順序；08:35／08:45／08:50 發現可讀取的設定不符時，以 `configured_cohort_mismatch` 明確失敗並保存收據，避免到 capture sink 才拋模糊錯誤。若 artifact 或設定檔本身不可讀，不誤稱為清單不符，仍由原 Gate fail closed。focused 3 檔 Vitest 27/27 通過，涵蓋精確順序與 08:35 失敗收據。此為**下次排程的防呆**，不能追溯套用到今日已執行的排程。
- 09:59 以既有 simulation API、未新增 login／subscription 的歷史 KBar 契約串行讀取核准 160 檔；160/160 回應有效、各檔最新分鐘為 09:59，與 9/24 已驗證基準同分鐘比對的例子：`2303.TW` 當日累計 49,150 張／基準 71,712 張、`2317.TW` 13,517／19,064、`2412.TW` 2,311／1,889。provider remaining bytes 由 522,405,631 至 521,768,057，消耗 637,574 bytes。這是當日**唯讀歷史資料補測**；沒有真實監控 SSE、control-plane accepted、data-plane event 或通知證據，不得勾選 7.4–7.7。
- revision 9 生效後，本日 08:20 建立的 session 仍綁定 revision 8；10:07 `/status` 如實回 `config_revision_mismatch`、`session.current=false`、`firstKbarAt=null`、`dataActive=0`、`notificationAuthority=false`、waitingGate=160／waitingPilotLimit=40。今日不能藉由改設定把原 08:50 failed receipt 變成成功，亦不可繞過 full-session 起始時限冒充自動 rollover。原 08:50 receipt SHA-256 再查仍為 `ee82b73dfa6925a10690cef69b0cf9bb9b02379c10a58e8a34a74f9cd82b1533`。
- 10:07 `pnpm local-runtime status` 仍為 simulation、business session／2330 Snapshot／8080／5173／5174 可用、watchdog restart count=0、production stopped、smart-order write master disabled。沒有真實下單、第二個登入或訂閱、服務重啟、archive、commit、push。今日正式跨日 live acceptance 仍為 **failed／未完成**；revision 9 與防呆須待下一個適用交易日的真實 08:20→08:50→09:02 流程驗證。
- 本輪 `pnpm build` 通過（僅既有大 chunk 警告）；`npx openspec validate repair-intraday-monitor-daily-rollover-and-status-truthfulness --strict` 與 `git diff --check` 通過。上述測試、build 與規格驗證只保證實作回歸，不代替尚缺的 live acceptance。

## 2026-09-29 10:12 台北時間：要求重新進行正式盤中驗收的可行性核對

- 再次依本 change 的 proposal／design／四份 delta spec／tasks 核對正式完成條件：必須保留第一日的真實 scheduler、session、control-plane／data-plane 與 freshness 證據，並在下一適用交易日證明 durable scheduler 自動 rollover 及真實 KBar／sealed-minute／results／notification Gate。不能把同日補測取代跨交易日自動驗收，亦不能重新命名已失敗的 08:50 收據。
- 10:12 對正式 capture start gate 唯讀實算：`full-session` 回 `allowed=false, reason=full_session_start_missed`；`partial-rehearsal` 可啟動，但程式禁止連結 product runtime，且不會建立今日 current session。08:20 原 session 鎖 revision 8、現存設定為 revision 9，API 已如實回 `config_revision_mismatch`。目前程式沒有符合規格、能把既有 08:50 failed claim 安全轉為當日 full-session 成功的獨立恢復入口。
- 既有 simulation API `/api/v1/health` 仍為 healthy，`/api/v1/stream/status` 回 17 active connections；connection 數不等於 160 檔監控訂閱，也不能證明 control-plane／data-plane。為避免建立第二組需求、超出未知 provider headroom 或污染正式證據，本輪沒有啟動 `partial-rehearsal`、更改 session、放寬時間 Gate、重新送出 08:50 step 或改寫原 receipt。
- 結論：可以在今日繼續保存唯讀行情補測，但**不能在不變更正式驗收契約與重建機制的前提下，於同一交易日完成 7.4–7.7**。即使另設有明確命名、獨立收據的盤中恢復流程，也只能構成「當日恢復」證據，不等於已發生的 08:50 自動 capture 或下一個交易日的自動 rollover；原四項 task 保持未勾選，等待使用者決定是否另提恢復規格，同時保留下一適用交易日的正式驗收要求。

## 2026-09-30 08:20–08:52 台北時間：當日官方來源失敗與有界人工補建

- 08:20 的真實 LaunchAgent 已觸發，但 `premarket/receipts/2026-09-30-0820.json` 為 `calendar_authority_unavailable`，`sessionId=null`，原始 SHA-256 為 `7f9546630604fdf99b89f68dcbbda9cae5f4f4208c3df9df7bafb372a857539d`。當時 TWSE 舊端點回 HTML／非 JSON；原收據保持原樣，未重跑同一步驟覆寫。
- 08:35 真實收據為 `current_session_missing`；08:45 真實收據再次因官方日曆失敗。唯讀 HTTP 診斷顯示 TWSE 舊端點為 403／HTML，TPEx 為 200／JSON。這兩份失敗收據也未修改。
- 08:35 左右重新成功擷取雙官方年度資料，確認 9/30 為交易日、上一交易日 9/29；9/29→9/30 基準為 160/160、43,200 分鐘、`baselineUsable=true`。在使用者明確要求當日補建後，以獨立 `2026-09-30-0820-manual-recovery.json` claim／receipt 建立唯一 session，收據標 `scheduledSuccess=false` 並保存原 08:20 收據 hash；這**不是** 08:20 自動 rollover 成功證據。補建後 session 160 檔、phase `starting`，revision 9、現有 generation、基準及 160 檔前段精確順序均通過 Gate。
- 擷取器原先只接受 08:35 前 generation anchor；針對這次補建，新增限 08:50 前且需驗證原失敗收據、獨立 recovery 收據、同日 session、基準與 generation 的例外。沒有 recovery 證據仍維持 08:35 截止。TWSE 舊端點失效時改由 TWSE 官方 OpenAPI 即時取得年度資料，仍與 TPEx 官方資料共同解析全年開休市，雙端均失敗時仍 fail closed，不使用舊快取。
- 08:50 真實 LaunchAgent 已啟動 `full-session` 擷取器；events 有 `capture_started` 與 `subscription_requested`，API `session.current=true`、`controlPlaneAccepted=true`。監控頁面取得單一頁面 lease，`acceptingEvents=true`，目前仍等待開盤後第一筆合法 KBar，`dataActive=0`、結果未驗證。08:50 長時間擷取的終局收據須待程序結束，不把啟動事件冒充整日成功。
- 目前只成立**當日功能恢復與啟動**，不符合 7.5 所要求的「完整自動跨日 rollover」，亦尚缺 09:02 後 data-plane、sealed-minute、results、通知 Gate 及跨兩日 dossier；7.4–7.7 保持未完成。

### 09:02–09:03 真實資料面增量

- 09:02:05 API `state=active`、`session.phase=running`、`session.current=true`、`firstKbarAt=2026-09-30T01:01:02.511Z`、`dataActive=160`、`active=160`、`awaitingFirstKbar=0`；監控頁面仍為唯一 lease，`acceptingEvents=true`。實際頁面顯示「監控中」、200 configured／160 admitted／160 data active、stream connected，未以歷史 GO 代替今日狀態。
- 09:02:15 擷取器原始 `first_minute_canary` 事件記錄 `receivedCount=160`、`missingCount=0`、`liveAvailabilityComplete=true`。此為今日真實 full-session 擷取過程，不是離線 fixture。
- 09:02:41 `/results` 有 63 筆 09:01 `kind=historical` 的補入結果，例如 `8210.TW` 同分鐘當日累積 159 張、9/29 基準 21 張、`completeness=complete`、`notificationAuthority=false`。09:03:20 結果增至 68 筆，其中 5 筆 `kind=live`，例如 `3217.TWO` 09:02 當日累積 2 張、9/29 基準 1 張、門檻 1.5、資料完整；UI 對歷史列明示「歷史重播（不通知）」、對新列明示「即時觸發」。REST 結果頁的 `notificationAuthority=false` 是重播輸出，不視為已實際發送通知；頁面提示音關閉、系統通知未授權，通知 Gate 尚須另核。
- 09:03:20 前後再次確認 simulation、既有 business session、2330 Snapshot、8080／5173／5174 可用；production job 停止、smart-order write master 停用、watchdog restart count=0。未新增第二個 login 或 broker subscription，未重啟服務。
- 本輪截至 09:03 的驗證為「今日人工恢復後，真實監控已啟動並產生 data-plane／同分鐘結果」；**自動 08:20、08:35、08:45 均有原始失敗收據，不能將 7.4–7.7 判定為完整跨日自動驗收通過**。08:50 擷取仍在執行，終局品質及整日證據待收盤後確認。

## 2026-09-30 09:02–09:15 台北時間：人工恢復後真實盤中接續

- **成功（今日資料面）**：重新擷取 TWSE／TPEx 官方年度日曆回傳 `current=true`，確認 9/30 為交易日、上一交易日 9/29。9/29→9/30 已發布基準為 160/160、43,200 個封閉分鐘、`baselineUsable=true`。固定 Stage 160 session 鎖 revision 9、cohort hash `e7743272…bef6985`、基準 hash `393684a6…e85b28`。09:02:15 原始 `first_minute_canary` 記錄 `receivedCount=160`、`missingCount=0`。09:12 API 回報 current／running、control-plane requested／accepted、第一筆合法 KBar 09:01:02.511、data active 160、baseline complete 160、freshness 約 41 ms、notification Gate=true；UI 顯示「監控中」、160 active、40 檔等待 pilot limit，並將 9/16 歷史容量 GO 分開呈現。這只描述**固定 160 檔**，不代表尚未正式接線的 dynamic daily plan 已啟用。
- **同分鐘與結果**：已發布基準中 `3217.TWO` 的 9/29 09:02 累積量為 1 張；今日 `/results` 的 09:02 `kind=live` 為 2 張、門檻 1.5、`completeness=complete`。09:12 結果共有 79 筆（歷史 64、live 15）；歷史列在 UI 標明「歷史重播（不通知）」。API `notificationAuthority=true` 代表 Gate 成立，不代表實際發送通知；頁內聲音仍關閉、系統通知未授權，沒有進行通知副作用。
- **失敗／未完成（自動 rollover）**：08:20 原始 LaunchAgent receipt 為 `calendar_authority_unavailable`，08:35 為 `current_session_missing`，08:45 再為 `calendar_authority_unavailable`；三份原始 SHA-256 分別為 `7f954663…a857539d`、`b246734b…cf84cd36`、`62fd406d…740fee48`，均未覆寫。08:37 獨立人工 recovery receipt 明示 `scheduledSuccess=false`，不能算 08:20 自動 session 成功。08:50 真實 claim 已存在，`full-session` 擷取程序仍在執行；本時點沒有 08:50 終局 receipt。故 7.4–7.7 不勾選，跨交易日自動驗收與收盤後 dossier 尚未完成。

## 2026-09-30 09:35–09:48 台北時間：盤前交易日判定架構修正（未冒充今日排程）

- **原始原因**：08:20 真實 LaunchAgent 已執行，舊 TWSE JSON 端點回 HTML（原 receipt reason 為 `Unexpected token '<'`），造成 `calendar_authority_unavailable`、無 session。08:35 官方日曆已重新有效，但現行步驟不會補建失敗的 08:20 session，故 `current_session_missing`；08:45 再遇日曆來源失敗。三份原 receipt SHA-256 仍為 `7f9546630604fdf99b89f68dcbbda9cae5f4f4208c3df9df7bafb372a857539d`、`b246734b0ac40e560b51c6c1028afee0f877283295ea980c80af3795cf84cd36`、`62fd406d8f463c04ae0f2a392afc090daba7fe0056f8c426be18c5a3740fee48`；沒有修改、刪除或重跑原時點。
- **設計修正**：盤前四個 step 改以已發布、完整驗證的前日 `baseline-set.json` 所附 TWSE／TPEx 官方年度日曆在本機判斷，不再每步向官方網站發請求；核對 baseline hash、雙來源解析、source version、來源／目標日期與有界保存期限，最新檔無效即 fail closed。盤後建檔才取遠端官方來源，TWSE OpenAPI 優先、另一個官方年度端點備援，TPEx 仍必備。08:35／08:45 加入僅限原 08:20 日曆失敗且今日零資料活動、所有 Gate 重驗通過時的自動補救；補救明標非 08:20 成功，08:50 不補建。
- **唯讀驗證**：既有 9/29→9/30 baseline 含 160/160，9/29 13:47 已擷取雙官方來源，source version `sha256:2a6911b076ecf7d1678036862b5806d8d4a05aa63ab94730c912c908ec4941ff`。以新本機 resolver 讀取它得到 `current=true`、`tradeDate=2026-09-30`、`previousTradeDate=2026-09-29`、`authorityKind=verified_postclose_local_snapshot`；用 08:19:59 的非落檔 dry-run 得 `scheduleConsistency=ready`，不把這些離線結果冒稱 08:20 當時成功。
- **回歸**：`pnpm exec vitest run scripts/intraday-monitor-runtime/trading-calendar-authority.test.mjs scripts/intraday-monitor-runtime/postclose-daily-baseline.test.mjs scripts/intraday-monitor-runtime/premarket-orchestrator.test.mjs scripts/intraday-monitor-runtime/capture-direct-160-stage.test.mjs` 通過（4 檔、46 tests）；`openspec validate repair-intraday-monitor-daily-rollover-and-status-truthfulness --strict`、`git diff --check` 及三個修改檔的 `node --check` 均通過。`pnpm local-runtime status` 仍顯示 simulation、既有 business session 與 2330 Snapshot available、8080／5173／5174 up、watchdog restart count 0、production job stopped、smart-order write master disabled。今日執行中的 08:50 capture 未停用、未重啟服務。
- **仍待真實驗收**：這是 09:35 後的程式修正，不會改變今天 08:20／08:35／08:45 原始失敗；下一適用交易日仍須讀真實 LaunchAgent receipt、session、baseline、KBar 與 results 才能判定 7.4–7.7。年度日曆只證明預排交易日，遇未預告臨時停市仍須保留實際交易活動為 unknown，不能以日曆單獨宣稱已開市。
- **安全與未知**：`pnpm local-runtime status` 為 simulation、business session／2330 Snapshot／8080／5173／5174 可用、production stopped、smart-order write master disabled、watchdog restart count 0。本輪沒有第二次 broker login、第二條 broker subscription、下單或服務啟停；provider physical ownership／other usage／release／headroom 繼續標示未知。既有瀏覽器監控頁保留 lease，未關閉。
- **回歸與結論**：focused unit 5 檔 59/59、成交面板 browser 2 檔 27/27 通過；三個 change 的 OpenSpec strict validation 與 `git diff --check` 通過，未追蹤驗證文件另以 `git diff --no-index --check` 核對無空白警告。09:24 再查 current／running／data active 160／freshness true，安全 Gate 不變。未 archive、commit、push；**人工恢復的今日功能運作不能替代跨日自動驗收**。
- **證據界線補註**：上述「沒有第二條 broker subscription」僅指本輪未手動呼叫 broker 訂閱或登入；成交明細獨立視窗的 SharedWorker 實際 request／refcount 因缺逐 request trace，仍列為 unknown，不用 runtime aggregate 反推零額外 demand。
