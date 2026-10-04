# 驗證紀錄

## 自動化驗證（2026-09-22）

- `pnpm exec vitest run src/lib/tick-tape-price-volume.test.ts src/lib/tick-tape-session.test.ts src/lib/tick-tape-large-trade.test.ts src/lib/tick-tape-source-verification.test.ts`
  - 結果：4 個檔案、33 項測試全數通過。
  - 涵蓋：bucket 增量彙總、買／賣／未知方向、均價與佔比、開／現／高／低重疊標記、零分母、無大單、不合格事件 fail closed、重播取消、來源連續性。
- `pnpm exec vitest run --config vitest.browser.config.ts src/components/tick-tape-session.browser.test.ts src/components/watchlist-tick-tape.browser.test.ts src/lib/use-tick-tape-session.browser.test.ts`
  - 結果：3 個檔案、31 項 Chromium browser tests 全數通過。
  - 涵蓋：成交明細／分價量表切換不增加 history request 或 tick listener、unmount cleanup、摘要公式、方向可及性文字、百分比、多標記、目前價定位、手動捲動保留、partial／verified／confirmed_empty／failed、設定重算、不支援商品與有界 DOM。
- `pnpm build`
  - 結果：`tsc -b` 與 Vite production build 通過。
  - 僅有既有的大於 500 kB chunk 警告，沒有 build error。
- scoped `git diff --check`
  - 結果：通過。
- `openspec validate add-tick-tape-price-volume-distribution --strict`
  - 結果：通過。

### Lint 邊界

專案根目錄沒有 `lint` script，也未安裝 `eslint`；執行 scoped `pnpm exec eslint ...` 得到 `Command "eslint" not found`。本 change 已以 `tsc -b`、production build、Vitest/browser tests 與 `git diff --check` 取代可執行的靜態驗證；未把缺少 lint 工具描述成 lint 通過。

## 大量資料與資源證據

在 Chromium 對相同 oracle 同時核對 100,000 與 500,000 筆 fixture；每筆皆為 100 元、10 張、買方、大單，預期只有一個 bucket，總量／大單量、均價及佔比皆逐欄核對。測試期間 event-loop timer 持續跳動，證明 replay 會讓出主執行緒；另有 AbortController 測試證明重播可取消。

| 筆數 | replay | IndexedDB 寫入 | IndexedDB 讀取 | fixture JSON bytes | event-loop pulses |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100,000 | 719.2 ms | 25.2 ms | 34.6 ms | 21,700,001 | 44 |
| 500,000 | 3,762.8 ms | 110.4 ms | 155.3 ms | 108,500,001 | 235 |

UI 僅 render viewport 前後緩衝列；browser test 對 101 個價位仍驗證 DOM 少於 40 列。live append 只呼叫 accumulator 的單一 bucket 更新；不重掃完整成交 rows，只有在 snapshot revision 改變時依「價位 bucket 數」排序產生 view model。

## Simulation 真實盤中驗收狀態

2026-09-22 13:40:43（Asia/Taipei）檢查時已超過正常盤中成交時段，無法取得「至少一筆新的真實 SSE 成交」及其斷線／重連證據，因此 tasks 5.1–5.4 保持未完成，task 5.5 亦不得勾選或進入 archive 評估。

13:41 後以臨時本機瀏覽器分頁進行唯讀 UI QA，2449 京元電子成功顯示：

- AllDay／RangeTime 18,907 筆一致，並與 Snapshot 成交量守恆
- 已載入範圍：09:00:01.239210–13:30:00.000000
- 37 個成交價位、69,441 張
- 總成交均價 320.7、大單成交均價 320.9
- 窄面板顯示 compact coverage badge、欄頭、目前價列與方向堆疊量圖；切入後可回到目前價
- HMR 造成 stream reconnect 時，coverage 正確降為 `partial`，完整日高／低標記隨即隱藏

以上只證明 REST 歷史／Snapshot、來源守恆與畫面呈現；收盤後沒有新的真實 SSE tick，所以不計入 tasks 5.1–5.3。臨時分頁已關閉，沒有留下額外 browser listener。

當下唯讀 runtime 證據：

- `runtime_mode=simulation`
- `production_readonly_job=stopped`
- `smart_order_write_master=disabled`
- `api_simulation=true`
- `api_business_session=available`
- `market_snapshot_2330=available`
- `web_listener=up`

本輪沒有啟停服務、沒有切換 production、沒有交易寫入，也沒有為分價量表建立第二套 history request 或 SSE listener。下次正常交易時段仍須以實際 `/api/v1/data/ticks` 與 `/api/v1/stream/data` network events，逐項完成首次歷史載入、單次 live append、gap repair、獨立視窗共享 refcount 與 cleanup 驗收。

## 2026-09-23 真實盤中部分驗收（Asia/Taipei）

### 已取得的上市／上櫃 live 證據

- 09:15:50–09:15:59，上市普通股 2330 在獨立成交明細視窗由 1,255 筆增加為 1,267 筆；最新成交由 09:15:50.328404 推進至 09:15:59.856784。切到分價量表後顯示 7 個成交價位、6,838 張、已載入 1,292 筆，coverage 為 `verified`，並顯示「歷史與即時累計成交量連續」。
- 09:11:46–09:11:57，上櫃普通股 8299 由 823 筆增加為 837 筆，大單由 41 筆增加為 42 筆；最新成交推進至 09:11:57.518564。
- 8299 分價量表在 09:12:38–09:12:48 的 10 秒觀察窗內，已載入筆數由 859 增至 866，總量由 2,491 增至 2,499 張。價位 2,270 的買方量由 13 增至 16 張，價位 2,265 的賣方量由 13 增至 18 張；合計正好為新增 8 張，其他價位 bucket 未增加，未觀察到同一成交重複累計。
- 兩個驗收視窗的 console 均無 error／warning；切換「成交明細／分價量表／資金流向」期間資料持續增量，沒有額外清空或重算整日 rows 的可見現象。

### 未通過與不能宣稱的項目

- 同商品跨視窗共享仍未通過：主頁 2449 停在 1,751 筆、最新 09:07:14.898636；另開 2449 獨立視窗後另行載入 2,008 筆、最新 09:09:45.666699，但之後沒有收到新成交。同期 09:12:07 Snapshot 已到累計量 8,500 張，兩個 UI session 均未追上；獨立視窗顯示 `partial` 與「行情已重連，等待下一筆成交核對」。
- 本次瀏覽器介面不能直接保存 `/api/v1/data/ticks` 與 `/api/v1/stream/data` 的逐 request path/count；只能保存 UI 的 AllDay／RangeTime coverage、live row/bucket 增量、`/api/v1/stream/status` 的 41 connections，以及 Vite 到 API 的 socket 數。這不足以取代規格要求的完整 network evidence。
- 關閉所有驗收 popout 後，瀏覽器只剩原本主頁，Vite 到 8080 的 established socket 數由暫時 12 回到原本 8；但 `/api/v1/stream/status.active_connections` 先維持 41，09:23 再讀為 48。此變化無法歸因到單一驗收頁，反而表示 connection churn／cleanup 仍不能證實，必須保留為未通過。
- 未進行 SSE 斷線：目前無法只隔離本驗收頁而保證不影響共用行情服務，因此沒有 gap repair、partial → verified 恢復、無漏單／重複的斷線證據。

### 結論

- 真實盤中 history 與 live 增量的正向證據已取得，但 2449 跨視窗問題、直接 network path/count、共享 refcount、cleanup 與安全斷線／補洞仍未完成。
- tasks 5.1–5.5 保持未勾選；不得只憑 2330／8299 的成功片段進入 archive 評估。

### 本次自動化回歸

- `pnpm exec vitest run src/lib/tick-tape-price-volume.test.ts src/lib/tick-tape-money-flow.test.ts src/lib/tick-tape-session.test.ts`：3 個檔案、38 項全數通過。
- `pnpm exec vitest run --config vitest.browser.config.ts src/lib/use-tick-tape-session.browser.test.ts src/components/tick-tape-session.browser.test.ts`：2 個檔案、26 項全數通過。
- `openspec validate add-tick-tape-price-volume-distribution --strict` 與 `git diff --check`：通過。

## 2026-09-23 11:40–11:56 盤中接續驗收與訂閱修正（Asia/Taipei）

- 既有 simulation API／business session、8080／5173／5174 均維持運作；production stopped、write master disabled。使用既有瀏覽器與共用行情服務，沒有啟停服務、切換交易模式或送出交易寫入。
- 2330 上市普通股獨立成交明細視窗的 AllDay／RangeTime coverage 為 `verified`。11:49:42 時已載入 3,834 筆、7 個成交價位、13,157 張；11:50:13.582305 時為 3,839 筆、13,165 張。新增 5 筆共 8 張：2,485 元賣 1 張，以及 2,490 元買 2、3、1、1 張。對應 2,485 元賣方 bucket 643→644、2,490 元買方 bucket 991→998；其餘 bucket 未增加，與增量完全相等。
- 修正後 11:54:58.537291 畫面仍為 `verified`，已載入 3,879 筆、7 個價位、13,216 張；逐筆成交時間仍持續前進，沒有因移除重複訂閱而停止。
- 11:52:44 在 2330 popout 的 Chrome Network 首次重載實測到三筆成功的 `/api/v1/stream/subscribe` POST，以及 `/api/v1/data/ticks` POST；對照程式路徑，`ensureContract()` 已呼叫 `subscribeContractQuotes()`（Tick、BidAsk），`PopoutView` 又額外呼叫一次 `subscribeQuote(contract, 'Tick')`。這違反「無額外行情訂閱」要求。已只移除 `PopoutView` 的第二次 Tick 請求，保留 `ensureContract` 訂閱與 `ensureStream` 共用 SSE；本輪沒有改動 K 線或 MultiView 程式。修正後的頁面 live rows／分價量表仍正常，惟 DevTools 後續未能可靠輸出完整新的 request list，因此**不能把訂閱 request count 的修正後網路比較宣稱已完成**。
- 2449 京元電子為反例：11:47 前後同一共用 SSE 的唯讀 30 秒觀察窗收到 2330 Tick 5 筆、2449 BidAsk 93 筆，但 2449 Tick 0 筆；同期 2449 Snapshot 累計量 26,839→26,851 張且價格變動，2449 popout 仍停在先前成交。11:59 唯讀 `LastCount=10` 歷史 API 另證實最後一筆已到 11:59:31.106358、306.0 元、1 張，故不是該商品完全沒有成交。這是上游 Tick 可見性／訂閱狀態缺口，不能以 2330 的成功推論 2449 或跨視窗全部通過；本輪沒有新增行情訂閱或額外 polling 去掩蓋缺口。
- 這次 Chrome Network 可直接確認 `/api/v1/data/ticks` 與重複 `/api/v1/stream/subscribe`，但 SharedWorker 的 `/api/v1/stream/data` 實際 EventSource 不在該頁 Network 清單內；SSE 的唯讀觀察使用既有端點另開短暫 HTTP 讀取，不是瀏覽器同一 SharedWorker 的完整 refcount 證據。未做會影響共用 worker／服務的斷線注入，也未完成可歸因的關閉 cleanup 比較。
- 自動化回歸：5 個成交／stream unit test files 共 50 tests、3 個相關 browser test files 共 34 tests 通過。另以 `node --test` 執行今早 MultiView 線圖／viewport 36 tests 全通過；`src/lib/screener-chart-selection.test.ts`、兩個 Fibonacci 測試檔共 16 tests 通過。曾誤用 Vitest 執行兩個 `node:test` `.mjs` 檔，得到「No test suite found」，改用正確 runner 後 36/36 通過，非產品失敗。

結論：單一商品真實 SSE 增量與 bucket 守恆通過，且修掉一筆明確重複訂閱；跨視窗 SharedWorker refcount、修正後完整網路 request count、2449 Tick 缺口、安全斷線／有界補洞與 cleanup 仍未通過。tasks 5.1–5.5 保持未勾選，不得歸檔。

## 2026-09-23 12:15–12:23 盤中停滯與效能修正（Asia/Taipei）

- 2330 獨立視窗在 12:15:26.449836 停於 4,163 筆／14,039 張；分價量表顯示 `partial`、行情斷線及已載入範圍 09:00:08.354337–12:15:26.449836。12:16:24–12:16:38 唯讀直連 `/api/v1/stream/data` 卻收到 2330 的 4 筆 Tick（12:16:34.060052、12:16:36.018699、12:16:37.712608、12:16:38.520585，共 4 張），沒有進入該 UI。這是原始 SSE 有成交、頁面未更新的反例，不能記為通過。
- 12:17 後 Chrome 主頁時鐘停在 12:15:33，驗收分頁一度為灰畫面；主頁 tab 顯示高記憶體用量約 933 MB，同時系統有一個 Chrome renderer 約 100% CPU、1.1–1.3 GB RSS，但尚未取得該 PID 與特定分頁的一對一映射。`127.0.0.1:5173/api/v1/stream/data` 的 8 秒唯讀取樣仍持續有 `tick_stk`、`bidask_stk` 與 heartbeat，故目前不能把斷點歸因於 API／Vite 代理中斷。這些現象只支持頁面端負載或中斷，尚不能單獨證明唯一根因。
- 12:23 唯讀 `/api/v1/stream/status` 顯示 `status=healthy`、`active_connections=114`；同時 5174 的本機 Node process 有 108 條到 8080 的 established TCP 連線。這是額外資源壓力線索，不等於已證實 2330 斷線原因；本輪未關閉或重啟任何共用服務／連線。
- 程式檢查發現共用 `useTickTapeSession` 在每筆 live tick 的 coverage 發布中呼叫 `inspectTapeContinuity(inputs)`，會對整日已載入成交重新 filter、排序、掃描；主頁的 2409 已有約 82,192 筆，因此這是明確的每筆 O(n log n) 效能缺陷。已改為歷史載入／亂序時完整核對、正常連續成交用累計量 O(1) 增量核對；缺口一旦出現仍保持 partial，直到歷史補齊重新證實。
- 修正後相關 unit 6 檔／53 tests、browser 3 檔／35 tests、`pnpm build`、兩個 change 的 OpenSpec strict validation 及 `git diff --check` 均通過；新增 100,000 筆增量連續性、亂序補缺口與訂閱部分成功回歸。另重跑今早線圖相關 MultiView 36 tests 與 chart／Fibonacci 37 tests，均通過。尚未能使已停滯的 Chrome renderer 在盤中重新顯示新碼後持續成交，因此**不能宣稱效能修正已通過真實瀏覽器盤中驗收**。沒有重啟 API／watchdog／Web／MultiView 或執行交易寫入。
- 2449 的歷史有新成交、共用 SSE 先前取樣卻沒有其 Tick 的來源缺口仍在；SharedWorker refcount、關閉 cleanup、安全隔離斷線／補洞、TSE／OTC 同輪完整 network count 尚未完成。tasks 5.1–5.5 維持未勾選。
- 額外檢查發現 `contracts-cache` 原先在 Tick／BidAsk 任一 POST 成功時便將整個商品標記為已訂閱；若 Tick 失敗、BidAsk 成功，後續 `ensureContract` 不會補 Tick。已改為逐 quote type 記錄成功，後續只對缺少的類型重試，新增 2 個回歸測試（包含指數 Quote）。此為明確的狀態追蹤缺陷，但**尚未證實即為 2449 當下缺 Tick 的唯一原因**；本輪未主動對 2449 發送訂閱 API，修正後的實際瀏覽器網路請求數仍待驗證。
- 12:35 的 2449 `LastCount=3` 顯示最新成交至 12:35:06.896958；其後一個 12 秒的 5173 代理 `/api/v1/stream/data` 唯讀觀察窗，2449 `tick_stk=0`、2330 `tick_stk=3`。再讀 `LastCount=1` 已前進至 12:35:42.654986、305.5 元／6 張。主頁 2449 同時停在 8,177 筆、最新 12:29:41.394940，時鐘停於 12:32:09。這是「歷史成交繼續、既有共享 SSE 未見 2449 Tick、UI 停住」的反例；不能把沒有新成交當作原因，也不能宣稱修正後已恢復。

## 2026-09-23 12:38–12:45 主頁重載後盤中驗收（Asia/Taipei）

- 使用者明確允許重載 `127.0.0.1:5173/` 主頁。重載前主頁時鐘停於 12:32:09、2449 成交停於 8,177 筆／12:29:41.394940；重載後時鐘恢復至 12:39:38，畫面可操作。未重啟 8080 API、watchdog、5173 Web 或 5174 MultiView。重載會失去當時未完成的費波那契回撤畫線；驗收後已將主頁商品與日 K 時框還原為 2449／1D。
- 2449 透過重載後的歷史補到 12:39:22.660707／8,342 筆、36 個成交價位、29,656 張，但 coverage 正確標示 `partial: snapshot_ahead_of_history`，沒有冒稱全日完整。12:40 左右另以短暫、唯讀的 `/api/v1/stream/data` 觀察 12 秒：共 176 筆 `tick_stk`，2449 為 0 筆、2330 為 2 筆；2449 的 BidAsk 仍有更新。回到 2449 後，12:45:15 畫面為 8,435 筆、末筆 12:44:31.355709，證明歷史可補進但仍無法據此認定即時 Tick 正常。這個 2449 缺 Tick 反例尚未修復，不能以重載成功代替來源問題驗收。
- 改用主頁既有清單內的上市普通股 2308，12:41:35.285955 首次歷史載入呈 `verified`：AllDay／RangeTime 2,548 筆一致、與 Snapshot 成交量守恆；7 個成交價位、6,900 張，1,910 元 bucket 買 1,646／賣 992／未知 0，共 2,638 張。沒有為驗收新增清單外商品行情訂閱。
- 另一段 15 秒唯讀 `/api/v1/stream/data` 觀察收到 269 筆 `tick_stk`，其中 2308 一筆：12:42:04.053778、1,910 元、1 張、`tick_type=2`（賣方）、`total_volume=6901`。主頁隨後顯示 2,549 筆／6,901 張；1,910 元 bucket 僅賣方量 992→993、bucket 總量 2,638→2,639，其餘方向不變。這筆成交只增加一次。此 SSE 是對既有端點另開的短暫讀取，**不是**主頁 SharedWorker 的完整網路 trace。
- 從主面板開啟 `?popout=tape&code=2308` 後，主面板與獨立視窗在 12:43:03.021020 同時顯示 2,561 筆、6,920 張及相同的最新時間／bucket。關閉驗收視窗後，主面板於 12:44:29.525689 仍推進至 2,571 筆；popout 分頁已確認關閉。這支持跨視窗 UI 值一致與關閉後主面板不中斷，但 `active_connections=114` 同期有大量共用連線，無法將差值歸因為精確 SharedWorker refcount／subscription cleanup。
- 仍未取得主頁及 popout 各自的 `/api/v1/data/ticks`、`/api/v1/stream/subscribe`、SharedWorker EventSource 完整 request count；也未在不影響共用服務的條件下安全隔離 SSE 做斷線／有界 gap repair，未補齊本輪上櫃商品的同等 network 證據。因此 tasks 5.1–5.5 保持未勾選，不得歸檔。

## 2026-09-29 09:08–09:11 盤中既有主頁／獨立視窗接續（Asia/Taipei）

- 既有 Chrome 主頁的 2449 上市普通股成交明細在 09:08:10 顯示 1,839 筆，未新建 login 或行情 session。切至分價量表後，09:08:19.879817 顯示 `verified`、2026-09-29 09:00:03.239202 起、1,867 筆／21 個價位／6,166 張；09:09:49.750145 前進到 2,047 筆／6,555 張。09:10:16.120668 為 2,081 筆／6,710 張，與同時的 2449 Snapshot 量一致。此為畫面已載入及 live 前進的正向證據，不能單憑 UI 前進反推 SharedWorker 的實際 network request count。
- 從主面板開啟 2449 成交明細獨立視窗，09:10:09.635671 的分價量表為 `verified`、2,075 筆／6,703 張、21 個價位；主面板 09:10:16.120668 為 2,081 筆／6,710 張，兩者依各自時間水位向前，沒有看見計數倒退。獨立視窗的 298.5 元買／賣／未知為 223／361／0 張，稍後主面板為 223／365／0 張；該價位增加 4 張賣方、總量亦增加 4 張，方向分解符合增量。這不是同一 SSE event 的逐筆識別證據，故不宣稱完成「同一成交只計一次」的整體驗收。
- 關閉此次開啟的 popout 後，主頁 09:11:08.711390 持續更新至 2,145 筆，09:11:15 又到 2,158 筆；主頁已還原原本的成交明細檢視。未停止或重啟 8080／5173／5174、watchdog，未切 production、未送交易寫入。沒有安全隔離本頁 SharedWorker 的方式，故未注入 SSE 斷線。
- 本輪瀏覽器驗收介面沒有取得可歸因的 `/api/v1/data/ticks` 與 `/api/v1/stream/data` 逐 request path/count，也無法從同時大量共用連線中精確讀出主／獨立視窗 refcount。未對上櫃普通股取得同等證據；斷線、partial → verified 有界補洞、無漏單／重複及 cleanup 尚未通過。tasks 5.1–5.5 保持未勾選，不能歸檔。
- 本輪 focused unit tests 38/38、browser tests 27/27 通過；此 change `openspec validate --strict` 與 `git diff --check` 通過。09:13 後再次核對 simulation、安全 Gate 與既有服務均維持原狀；未 archive、commit、push。

## 2026-09-30 09:09–09:15 真實盤中接續（Asia/Taipei）

- **成功／部分證據**：既有 Chrome 主頁從清單切入上市普通股 3481，09:10:46 分價量表顯示 `verified`、來源日 9/30、09:00:00.785284–09:10:46.188860 已載入 9,990 筆、27 價位／111,290 張，52.8 元 bucket 為買 1,436／賣 462／未知 0，總量 1,898 張。另以既有清單內的 2308 驗收：09:11 資料曾如實呈 `partial: 行情已重連，等待下一筆成交核對`，後續 AllDay／RangeTime 334 筆一致並轉 `verified`。09:11:57 主頁 2308 為 342 筆、7 價位／1,147 張，1,880 元買 119／賣 95／未知 0；09:12:25 前進至 361 筆／1,168 張、同價位買 119／賣 116。期間尚有其他成交，**不能將 +21 張全歸因於兩筆取樣事件**。
- 對既有 `/api/v1/stream/data` 另開短暫**唯讀 HTTP 觀察**（沒有 broker 訂閱）捕捉到 2308 於 09:12:13.288145、09:12:13.678939 的兩筆 1,880 元／各 1 張／`tick_type=2` 真實成交，累積量分別 1,158、1,159 張；獨立視窗後續成交列表可見兩筆精確時間。來源 SSE 事件存在並進入可見資料，但觀察連線不是頁面 SharedWorker 的逐 request network trace，亦不足以單獨證明主／獨立視窗各只計一次。
- 09:14:01 主面板與剛開啟的 `?popout=tape&code=2308` 獨立視窗同時顯示 `verified`、388 筆／1,234 張，1,880 元價位買 125／賣 127；獨立視窗開啟後資料由 385→388 筆。關閉驗收視窗後主面板仍由 399→400 筆前進，popout 已關閉；只證實可見資料同步與主頁未中斷，不以此推定精確 SharedWorker refcount 或 cleanup。主面板已還原「成交明細」檢視。
- **未通過／unknown**：瀏覽器驗收介面未取得主頁與 popout 各自首次 `/api/v1/data/ticks`、SharedWorker `/api/v1/stream/data` 及 subscribe 的可歸因 request count；未做上櫃股同等驗收、閱讀位置及精確 refcount／cleanup。不能只隔離本頁 SSE 而不影響共用服務，故沒有注入斷線，也沒有驗證有界 gap repair／無漏單。5.1–5.5 保持未勾選；本節為部分實盤證據，不得歸檔。
- **回歸／安全**：focused unit 5 檔 59/59、browser 2 檔 27/27 通過；三個 change strict validation 與 `git diff --check` 通過。09:24 仍為 simulation、production stopped、write master disabled、watchdog restart count 0；無交易寫入、服務啟停、archive、commit 或 push。

## 2026-09-30 11:58–12:15 盤中追加驗收（Asia/Taipei）

- **首次歷史請求的瀏覽器證據**：既有 Chrome 主頁的 Network 記錄在切換商品後顯示上櫃 `7714`、上櫃 `5347`、上市 `2449` 各有兩筆 `POST /api/v1/data/ticks`。前四筆在 Network 表格可見 HTTP 200；Payload 實際抽查確認 `7714` 的來源日 `2026-09-30`、`AllDay` 與 `RangeTime` 各一筆，以及 `5347`、`2449` 各一筆 `AllDay`。後兩個商品的第二筆 Payload 與 2449 兩筆 HTTP status 未逐項讀出，不冒充已核實；依現有程式契約應是 `RangeTime`，仍需直接網路證據。Network 記錄從開啟 DevTools 後才開始，不能冒稱包含主頁最初載入時全部請求，也未取得 SharedWorker 的 `/api/v1/stream/data` 同頁 request/event trace。
- **上市與上櫃真實畫面**：`2449` 12:07 時顯示 `verified`、AllDay／RangeTime 共同前綴 4,993 筆一致，已載入 5,015 筆、21 價位／16,192 張；稍後主頁與 `?popout=tape&code=2449` 在同一擷取時刻均為 5,022 筆／16,201 張，再同步前進至 5,028 筆／16,236 張。`5347` 12:12:52 顯示 `verified`、AllDay／RangeTime 5,221 筆一致，已載入 5,257 筆、13 價位／18,013 張；12:13:03 前進至 5,261 筆／18,027 張。另 `7714` 12:01 左右曾呈 `verified`，由 178→179 筆、318→319 張，這是較低流動性的補充觀察，不取代 `5347`。
- **可識別成交與閱讀位置**：`5347` 主面板分價量表 182.5 元價位買／賣／未知由 1,100／393／0 張、總量 1,493 張，對照獨立視窗兩筆不同事件鍵（12:13:47.177791、12:13:49.446247，皆 182.5 元、1 張買方）後，變為 1,102／393／0 張、總量 1,495 張；當日總量 18,050→18,052 張，未見重複累計。`2449` 獨立視窗的資金流向分鐘表手動捲至 11:56 後，新成交與新分鐘出現時仍停在 11:56、`scrollTop=406.5`；關閉獨立視窗後，主面板由 5,043→5,044 筆繼續更新。驗收視窗均已關閉，主頁恢復原本 `2449`／成交明細。
- **安全／限制**：前後 `pnpm local-runtime status` 均為 simulation、production stopped、write master disabled、watchdog healthy 且 restart count 0，8080／5173／5174 可用；本輪沒有送出委託、登入第二個 business session、啟停服務或主動呼叫 broker subscribe。現有瀏覽器證據仍不能歸因 SharedWorker 實際 SSE request/event、精確跨視窗 refcount 與最後一個 listener cleanup；亦不能只隔離驗收頁而不影響共享行情，因此未注入 SSE 斷線或宣稱完成有界 gap repair。正向 UI／REST 證據不等於全部必要證據，tasks 5.1–5.5 暫不勾選，不能歸檔。
- **回歸**：本輪 focused Node tests 5 檔 51/51 通過；Browser tests 依專案 `vitest.browser.config.ts` 執行 3 檔 35/35 通過。兩個 change 的 OpenSpec strict validation 與 `git diff --check` 通過。首次直接以 Node 環境執行 `.browser.test.ts` 出現 `document is not defined`，改用專案指定 Browser config 後全數通過；那不是功能回歸。

## 2026-09-30 12:24–12:39 頁面隔離斷線與上市／上櫃 SSE 逐筆對照（Asia/Taipei）

- **隔離方式與安全邊界**：經使用者明確授權，只把既有 Chrome 主頁的 DevTools Network 設為 `Offline`；未停止、重啟或切換 API、watchdog、5173、5174、business session，也未切 production 或下單。12:24:27–12:27:01 的第一次隔離長約 2 分 34 秒，長於原先預期的短暫觀察窗，依實際時間記錄，不美化。關閉 DevTools 後頁面恢復 `LIVE`；12:27:28 意外重開 DevTools 時原離線預設再次生效，12:27:32 關閉後再恢復。12:38:52 透過 DevTools 命令 `Go online` 將預設改回 `No throttling`，並把 `Disable cache` 復原為未勾選；12:39:16 關閉 DevTools 後主頁仍持續更新。
- **斷線與補齊**：上市普通股 `2449` 在 12:24:17.179071 已載入 5,195 筆、21 價位／16,853 張。隔離期間頁面顯示 `LOST`、`partial` 與「行情斷線，已載入紀錄仍可查閱」，原有 5,195 筆與 16,853 張未消失。恢復時先顯示「等待下一筆成交核對」及「正在補齊歷史成交」，12:27:15.511039 到 5,203 筆／16,865 張並短暫回到 `verified`；第二次短隔離後曾如實顯示 `snapshot_ahead_of_history`，12:28:32.809988 再達 `verified`，AllDay／RangeTime 5,213 筆一致且與 Snapshot 量守恆。12:29:20.696568 為 5,233 筆／16,908 張，與斷線前差 55 張：296.5 元賣方 655→685（+30）、297.0 元買方 358→383（+25），其他價位方向量未變；未見因重播加倍。這是全段前後值，不把每次中間載入都稱為單一 SSE 增量。
- **來源 SSE 的真實逐筆證據**：以既有本機 `/api/v1/stream/data` 另開短暫唯讀 HTTP 觀察，不送 broker subscribe。`2449` 12:35:46.915539、12:35:49.157389、12:35:51.130102、12:35:51.234992 四筆依序為 296.5 元、1／1／30／1 張，`tick_type=2`，累積量 17,047／17,048／17,078／17,079。獨立成交列表四個精確時間各出現一次，價格與張數逐筆相符。`5347` 上櫃普通股 12:36:38.347170、12:36:45.616772、12:36:48.351250、12:36:50.583308 四筆依序為 182 元買 1、181.5 元賣 1、182 元買 1、181.5 元賣 1 張，累積量 18,695–18,698；獨立列表各時間也只出現一次。`5347` 12:37:07.353688 顯示 `verified`、AllDay／RangeTime 5,640 筆一致，已載入 5,655 筆、13 價位／18,706 張。先前 11:58–12:15 同日瀏覽器 Network 已記錄兩商品各兩筆 `/api/v1/data/ticks` POST；這次新增的 source SSE 觀察連線**不是**頁面 SharedWorker 自身的 request trace。最初兩次原始 SSE 過濾器誤以為 `event:`／`data:` 後有空白，因而無輸出；確認實際格式無空白後才得到上述事件，先前空輸出不代表來源沒有 Tick。
- **跨視窗與資源**：主面板及 2449 獨立分價量表在同一觀察點均為 12:30:17.317019、5,237 筆、21 價位／16,914 張；popout 關閉後主面板由 5,241 筆／16,918 張繼續至 5,245 筆／16,929 張。第二次開窗前、開窗中、關窗後的 `/api/v1/stream/status.active_connections` 都是 23；這只支持沒有可見的額外連線，不是精確的 SharedWorker port refcount／最後一個 listener cleanup 證明。所有本輪驗收 popout 已關閉，使用者主頁後來自行切至 2409，未再改回 2449。
- **通過與保留**：5.1 的 TSE／OTC 真實歷史、來源日期、coverage、row／volume、來源 SSE 逐筆與 UI 對照已足夠，故勾選。5.2–5.5 暫不勾：仍缺頁面 SharedWorker 所屬 `/api/v1/stream/data` 的可歸因 request/event count、精確跨視窗 refcount／cleanup，以及修正後 broker 訂閱請求數；外加唯讀 source SSE 不能冒充同頁 trace。安全 Gate 前後皆為 simulation、production stopped、write master disabled、watchdog restart count 0；無交易寫入與服務啟停。

## 2026-09-30 12:45–12:47 訂閱數追加核對（Asia/Taipei）

- 在原主頁仍保持 `LIVE` 的前提下，另開 `2449` 成交明細獨立分頁，只重載該驗收分頁。Chrome DevTools Network 自重載前即開始錄製；篩選 `/api/v1/stream/subscribe` 顯示**恰好兩筆** `POST 200`，Payload 分別為 `STK/TSE/2449` 的 `quote_type=Tick` 與 `quote_type=BidAsk`，沒有先前發現的第三筆重複 Tick 訂閱。依序切換「分價量表／資金流向／成交明細」後仍是兩筆；同一錄製窗篩選 `/api/v1/data/ticks` 為零筆新增請求。這是修正後該獨立視窗／該商品的實際請求計數，不推論所有既有視窗或所有商品的 broker 訂閱狀態。
- DevTools 顯示 `No throttling` 且 `Disable cache` 未勾選；驗收分頁與 DevTools 已關閉，瀏覽器僅留下使用者原主頁，仍顯示 `LIVE`。此證據補上先前「修正後訂閱 request count」的局部缺口，但仍沒有 SharedWorker 自身的逐 request/event 與 port refcount／最後 listener cleanup 證據，故 5.2–5.5 繼續未勾選。

## 2026-09-30 收盤後：次日驗收的唯讀診斷補強

- 在既有 `診斷 Debug` 面板加入手動「擷取狀態」、「複製快照」及指定商品 5 分鐘觀察。由原本的 SharedWorker port 讀出允許路徑、portCount、EventSource readyState、來源建立／關閉計數、open／error 時間及事件計數；只在指定商品觀察期間解析成交，記憶體最多保留最近 32 筆的日期、時間、價、量、方向，不記錄原始 payload 或自動寫入磁碟。EventSource fallback 明示「無法量測 refcount」，不得把它當成 0。此處的 sourceCreated 是 Worker 內來源實例數，**不是**瀏覽器 HTTP 重連 request count。
- `shared-event-source-worker` 與頁面端新增的 focused tests 共 5/5 通過；成交 session／分價／資金流向等 focused Node tests 共 7 檔 56/56 通過；相關 Browser tests 3 檔 35/35 通過；`pnpm build` 通過。首次 build 因新增 CSS 不符 vanilla-extract selector 規則失敗，已修正並重跑成功，不隱藏這段失敗。
- 次日盤中須在同一觀察窗記錄：主頁單獨、開啟獨立視窗、關閉獨立視窗後三次 worker snapshot；核對 `/api/v1/stream/data` portCount、sourceCreated／sourceClosed、指定商品 tick trace、兩頁同一成交的列與 bucket 增量、Network 的兩筆 broker 訂閱及首次歷史請求。關閉最後 listener 的單元測試不能替代真實頁面 cleanup；若 Worker 被瀏覽器回收，生命週期累積計數也會重設，應明示無法歸因而非推定通過。真實 5.2–5.5 仍未勾選，沒有 archive／commit／push。
