# 驗證紀錄

## 2026-09-22 自動化驗證

- `pnpm exec vitest run src/lib/tick-tape-money-flow.test.ts src/lib/tick-tape-session.test.ts`
  - 2 個測試檔、28 個測試全部通過。
  - 包含 100,000 與 500,000 筆 fixture；逐點與獨立整數 oracle 核對整體、大單、非大單、未知方向筆數／金額及 `整體 = 大單 + 非大單`。
- `pnpm exec vitest run --config vitest.browser.config.ts src/lib/use-tick-tape-session.browser.test.ts src/components/tick-tape-session.browser.test.ts`
  - 2 個測試檔、25 個測試全部通過。
  - 驗證檢視切換不新增 history request、SSE listener、cache write 或其他 Shioaji request；亦涵蓋 248px、320px 短面板、DOM 有界、捲動位置、空／部分／失敗、設定重播及 500,000 筆 replay／IndexedDB。
- `pnpm test:browser`
  - 14 個測試檔、150 個 browser tests 全部通過。
- `pnpm build`
  - TypeScript project build 與 Vite production build 通過；只有既有 chunk size 警告。
- `pnpm test`
  - 248 個測試檔通過、2 個測試檔失敗；2,536 個測試通過、3 個測試失敗。
  - 失敗皆非本 change：`src/lib/fibonacci-overlay.test.ts` 仍預期 8 條拓展線而目前 change 已產生 9 條，另有 `scripts/maintenance-run-receipt.test.mjs` 空測試檔。
- `pnpm lint`
  - 專案沒有根目錄 `lint` script，pnpm 回報 `Command "lint" not found`；未以臨時安裝或改動工具鏈掩蓋此缺口。
- scoped `git diff --check` 通過。
- `openspec validate add-tick-tape-realtime-money-flow --strict` 通過。

## 2026-09-22 本機 UI 驗證

- 16:52（Asia/Taipei）於既有 `127.0.0.1:5173` simulation 環境檢查 3055。
- 主面板與 `?popout=tape&code=3055` 獨立視窗皆可切換「資金流向」；沒有「即時／月」切換。
- 畫面載入來源日期 2026-09-22、2,424 筆成交、185 個成交分鐘；顯示整體／大單／非大單三線、零軸、四欄最新在前分鐘表及未知方向摘要。
- 實測發現並修正 Vite HMR 保留舊 classifier instance 時的新 getter 錯誤；完整重載後無 startup error。
- 實測發現並修正超寬獨立視窗 SVG 僅使用固定 360px 繪圖區的問題；修正後座標系會依實際 SVG 寬高重算。
- 測試用獨立視窗已關閉；沒有啟停服務、沒有新增行情 subscription、沒有交易寫入。

## 尚未完成的盤中驗收

檢查時間已在台股正常交易時段之外；目前 coverage 顯示「部分資料：行情已重連，等待下一筆成交核對」。因此尚未取得本 change 所需的真實 SSE 新成交、斷線／重連 gap repair 與 shared refcount 證據。`tasks.md` 5.1–5.6 保持未勾選，不能據此評估歸檔。

## 2026-09-23 真實盤中部分驗收（Asia/Taipei）

### 已取得的即時淨額證據

- 上櫃普通股 8299 在 09:13:07.317246–09:13:14.703659 的 10 秒觀察窗內，由 881 筆增至 886 筆；09:13 整體淨額由 1,046.22 增至 1,050.76 百萬元，大單淨額維持 1,255.23，非大單淨額由 -209.01 增至 -204.47 百萬元。
- 該窗實際新增 5 筆為：2,265 元×2 張買、2,265 元×1 張賣、2,265 元×1 張買、2,270 元×1 張買、2,265 元×1 張賣；整數新台幣淨增為 4,535,000 元，顯示差額四捨五入為 +4.54 百萬元。各筆均未達 10 張且設定為 AND，因此大單不變、非大單增加相同金額，符合公式。
- 上市普通股 2330 在 09:16:31.624225–09:16:39.747894 由 1,321 筆增至 1,355 筆；09:16 整體／大單／非大單由 12,851.21／10,948.44／1,902.77 變為 12,668.73／10,935.94／1,732.79 百萬元。前後兩個 snapshot 均逐項滿足 `整體 = 大單 + 非大單`。
- 2330 與 8299 coverage 均曾達 `verified`，時間範圍與最新成交同步推進；兩個 popout console 均無 error／warning。

### 未通過與來源限制

- 本次沒有遇到未知方向成交；未知方向仍為 0 筆／0.00 百萬元，因此只能確認零值不影響淨額，不能以真實盤中證據完成未知方向路徑。
- 主頁與 2449 獨立視窗未能持續接收同商品新成交：主頁停在 1,751 筆／09:07:14.898636，popout 停在 2,008 筆／09:09:45.666699，而 09:12:07 Snapshot 已到累計量 8,500 張。這表示 shared session／refcount live acceptance 尚未通過。
- 瀏覽器驗收介面無法直接輸出 `/api/v1/data/ticks` 與 `/api/v1/stream/data` 的逐 request path/count；本次保留的是 AllDay／RangeTime coverage、live row/minute 增量、socket 與 console 證據，不能冒充完整 network trace。
- 未進行 SSE 斷線與恢復，因目前不能保證只隔離驗收頁而不影響共用服務；因此 gap repair、partial → verified、無漏單與無重複仍無真實證據。
- 關閉全部驗收 popout 後，瀏覽器只剩原本主頁，Vite 到 8080 的 established socket 數回到原本 8；但 `/api/v1/stream/status.active_connections` 先維持 41，09:23 再讀為 48。此 connection churn 無法歸因到單一頁面，故 shared refcount／cleanup 明確不能判定通過。

### 結論

- 單一 TSE／OTC popout 的真實即時分鐘增量與金額分解公式通過；跨視窗共享、直接 network trace、未知方向、斷線／補洞與 cleanup 尚未通過。
- tasks 5.1–5.6 保持未勾選，不得進入 archive 評估。

### 本次自動化回歸

- `pnpm exec vitest run src/lib/tick-tape-price-volume.test.ts src/lib/tick-tape-money-flow.test.ts src/lib/tick-tape-session.test.ts`：3 個檔案、38 項全數通過。
- `pnpm exec vitest run --config vitest.browser.config.ts src/lib/use-tick-tape-session.browser.test.ts src/components/tick-tape-session.browser.test.ts`：2 個檔案、26 項全數通過。
- `openspec validate add-tick-tape-realtime-money-flow --strict` 與 `git diff --check`：通過。

## 2026-09-23 11:40–11:56 盤中接續驗收（Asia/Taipei）

- 使用既有 simulation business session、8080／5173／5174 及共用行情串流；production stopped、write master disabled，沒有服務 lifecycle mutation 或交易寫入。
- 上市普通股 2330 獨立成交明細視窗顯示 AllDay／RangeTime `verified`。11:50:19.020952 時已載入 3,842 筆、171 個成交分鐘；11:50 分鐘整體／大單／非大單淨額分別為 12,226.21／11,393.56／832.65 百萬元，未知方向 0 筆。
- 11:50:31.658332 時已載入 3,844 筆，仍為 171 個分鐘；11:50 的三個淨額依序為 12,231.19／11,393.56／837.63 百萬元。對應新增逐筆為 11:50:30.377993 與 11:50:31.658332，各 2,490 元、1 張、買方；整體及非大單各增加 4.98 百萬元，大單不變，沒有重複分鐘或重複累計。隨後切換檢視與修正獨立視窗重複訂閱後，11:54:58.537291 仍為 `verified`、3,879 筆、175 個成交分鐘，最新分鐘持續推進。
- Chrome Network 曾直接顯示 2330 popout 首次重載時的 `/api/v1/data/ticks` POST 與三筆 `/api/v1/stream/subscribe` POST。程式核對確定後者包含 `PopoutView` 在 `ensureContract` 的 Tick／BidAsk 之外額外送出的 Tick 訂閱，已移除額外呼叫並保留原有 `ensureStream`。修正後 live rows、分價量表及資金流向仍更新；但 DevTools 後續沒有可靠的完整新 request list，不把修正後 request count 視為驗證通過。
- 2449 的唯讀共用 SSE 觀察窗在 Snapshot 累計量增加期間沒有 Tick event（30 秒內 2449 Tick 0、BidAsk 93；2330 Tick 5）；11:59 的 `LastCount=10` 歷史 API 則有 11:59:31.106358 的真實成交。故 2449 的主／獨立視窗停滯不可歸因為資金流向圖表計算錯誤，也不能宣稱跨視窗正常。
- 本次未遇到真實未知方向成交；未安全隔離 SharedWorker 進行 SSE 斷線／重連；未證明 SharedWorker refcount、關閉 cleanup、partial → verified gap repair、修正後的直接 `/api/v1/stream/data` 頁面網路 trace。上述均保留未通過。
- 相關 5 個成交／stream unit test files 共 50 tests、3 個 browser test files 共 34 tests 通過；今早線圖相關 `node --test` 36 tests，以及 screener chart／Fibonacci 16 tests 通過。

結論：2330 真實即時分鐘與金額分解的前後值通過；tasks 5.1–5.6 仍有來源、網路與斷線證據缺口，維持未勾選，不得歸檔。

## 2026-09-23 12:15–12:23 盤中停滯與共用 session 修正（Asia/Taipei）

- 2330 驗收頁停在 12:15:26.449836／4,163 筆，12:16:24–12:16:38 原始 `/api/v1/stream/data` 的唯讀觀察卻有 4 筆 2330 Tick；頁面當時標示行情斷線、partial，主頁也停在 12:15:33，故不能用原始 SSE 有資料代替資金流向 UI 的新分鐘驗收。
- 12:23 `/api/v1/stream/status` 為 `healthy`、114 條 active connections；本機 5174 process 同時有 108 條到 8080 的 established 連線。只記為資源壓力線索，不冒充已定位的斷線根因，亦未更動共用服務生命週期。
- 共用 session 原先每筆 live 成交都重新排序、掃描全日輸入以判斷 coverage；在 2409 約 82,192 筆的高密度盤中情境會放大為逐筆 O(n log n)。已改為對正常連續成交以累計量 O(1) 更新；歷史 merge 或亂序仍全量核對，缺口不會自行變成 `verified`。此修正同時服務分價量表與資金流向，沒有新增 history request 或行情 subscription。
- 相關 unit 6 檔／53 tests、browser 3 檔／35 tests、TypeScript／Vite build、兩個 change 的 OpenSpec strict validation 及 `git diff --check` 通過；100,000 筆增量、亂序補缺口與訂閱部分成功的回歸測試通過。今早線圖相關 MultiView 36 tests、chart／Fibonacci 37 tests 亦通過。已停滯的 Chrome renderer 尚未取得修正後的真實 UI live 增量，所以資金流向 5.1–5.6 仍不勾選。原先未見真實未知方向成交及無法安全隔離 SSE 斷線的限制也仍在。
- `contracts-cache` 原先把 Tick／BidAsk 任一成功視為整個商品成功，可能讓資金流向只見 BidAsk 而收不到成交。現已逐類型追蹤，後續只重試失敗類型；新增部分成功與指數 Quote 2 項測試，加上 stream／source 相關共 15 tests 通過。這是確定的快取狀態缺陷，並非已證實的 2449 唯一根因；本輪未主動對 2449 發送訂閱 API，實際網路請求數待驗證。
- 12:35 另以 2449 做來源反證：`LastCount` 先後到 12:35:06.896958 與 12:35:42.654986，但中間 12 秒共用 SSE 觀察窗沒有任何 2449 Tick，2330 卻有 3 筆；主頁 2449 資料停在 12:29:41.394940。故該商品資金流向不能標記為即時完整，仍須驗證實際 Tick 訂閱與來源事件傳遞。

## 2026-09-23 12:38–12:45 主頁重載後盤中驗收（Asia/Taipei）

- 經使用者允許只重載停滯的 5173 主頁，時鐘由 12:32:09 恢復到 12:39:38。既有 simulation API／business session、watchdog、Web、MultiView 保持運作；沒有切換 production 或執行交易寫入。主頁驗收後還原 2449／1D 與原成交明細檢視。
- 2449 重載後歷史雖補到 8,342 筆／12:39:22.660707，資金流向仍明示 `partial: snapshot_ahead_of_history`；12 秒唯讀共用 SSE 取樣有 176 筆股票 Tick，但 2449 為 0、2330 為 2。12:45:15 回到 2449 時歷史再補到 8,435 筆／12:44:31.355709；五檔與歷史有更新不等於即時 Tick 有送達，故 2449 尚未通過即時驗收。
- 主頁清單內 2308 於 12:41:35.285955 呈 `verified`，AllDay／RangeTime 2,548 筆一致、6,900 張。12:42:04.053778 唯讀 SSE 收到 1,910 元、1 張、`tick_type=2`、`total_volume=6901` 的真實成交；UI 由 2,548→2,549 筆、6,900→6,901 張，新增 12:42 分鐘後共有 223 個成交分鐘。12:42 的整體／大單／非大單依序為 1,325.82／593.18／732.65 百萬元，相對 12:41 的 1,327.73／593.18／734.56，整體及非大單各減少 1.91 百萬元，大單不變，符合賣方 1 張與 `整體 = 大單 + 非大單`。顯示值有 0.01 百萬元四捨五入差；判定以原始成交金額 1,910,000 元為準。
- 2308 主面板與獨立視窗在 12:43:10.334107 同時顯示 2,563 筆、224 個成交分鐘及相同最新分鐘三種淨額（1,304.84／593.18／711.67 百萬元）。獨立視窗捲到 12:17 附近後，12:44:06.512378 新成交使總筆數 2,565→2,566、成交分鐘 224→225，閱讀位置仍停於 12:17；手動按「回到最新」才顯示 12:44 的 1,310.59／593.18／717.41。視窗關閉後主面板於 12:44:29.525689 繼續推進至 2,571 筆／225 分鐘，且 popout 分頁已關閉。
- 對 `/api/v1/stream/data` 的取樣是短暫唯讀直連，不能冒充頁面 SharedWorker 的完整 SSE network path／refcount 證據；也無法由同時存在的 114 條 API active connections 歸因關閉 cleanup。未觀察到真實未知方向成交，亦未安全隔離 SSE 進行斷線／重連與有界 gap repair；本輪沒有上櫃商品的等價完整 network trace。因此 tasks 5.1–5.6 繼續未勾選，不得歸檔。

## 2026-09-29 09:08–09:11 盤中既有主頁／獨立視窗接續（Asia/Taipei）

- 既有 Chrome 主頁 2449 上市普通股於 09:08:32.647598 顯示 2026-09-29 09:00:03.239202 起的 `verified` coverage、1,885 筆、9 個成交分鐘；09:08 分鐘整體／大單／非大單淨額依序為 −596.00／−826.91／+230.91 百萬元。09:11:00.287745 已前進到 2,130 筆、12 分鐘；09:11 分鐘為 −616.51／−894.12／+277.61 百萬元。畫面四捨五入到 0.01 百萬元，與 `整體 = 大單 + 非大單` 的差 0.01 屬顯示精度，不拿來代替原始整數金額 oracle。
- 2449 獨立視窗 09:10:55.105075 為 `verified`、2,120 筆／11 分鐘；09:11:04.731844 為 2,141 筆／12 分鐘，且已完成的 09:10 分鐘值 −600.36／−879.17／+278.81 與主頁 09:11:00 所見相同。關閉 popout 後主頁 09:11:08.711390 仍進到 2,145 筆／12 分鐘，09:11 分鐘三種淨額繼續變動；主頁最後還原成交明細檢視。此證明兩個畫面均有新資料與分鐘前進，不能單憑畫面推論 SharedWorker 的精確 refcount 或同一 SSE event 的去重。
- 這段真實成交均顯示未知方向 0 筆，不能驗收未知方向的實盤路徑；本輪也未安全隔離 SSE 斷線。既有瀏覽器能力未提供可歸因的 `/api/v1/data/ticks`、`/api/v1/stream/data` 逐 request path/count，未驗上櫃商品、gap repair 與精確 cleanup。沿用既有 simulation business session，沒有第二次 login、主動增加行情訂閱、服務啟停、production 或交易寫入。tasks 5.1–5.6 保持未勾選，不得歸檔。
- 本輪 focused unit tests 38/38、browser tests 27/27 通過；此 change `openspec validate --strict` 與 `git diff --check` 通過。09:13 後再次核對 simulation、安全 Gate 與既有服務均維持原狀；未 archive、commit、push。

## 2026-09-30 09:11–09:15 真實盤中接續（Asia/Taipei）

- **成功／部分證據**：既有清單內上市普通股 2308 在主面板先顯示 `partial`、317 筆／10 個成交分鐘與「行情已重連，等待下一筆成交核對」，隨後 AllDay／RangeTime 334 筆一致且成交量與 Snapshot 守恆，轉為 `verified`、335 筆／12 分鐘。09:11 分鐘整體／大單／非大單顯示 865.77／809.70／56.07 百萬元；09:11:35 資料前進至 338 筆，同分鐘顯示 863.89／809.70／54.20 百萬元。顯示層四捨五入各自可有 0.01 百萬元差異，不用於取代內部整數金額核對。
- 09:14 獨立視窗從開啟後的 385 筆推進至 389 筆、15 個成交分鐘；09:14 分鐘整體／大單／非大單為 803.80／822.82／−19.02 百萬元。主面板與獨立視窗的已完成 09:13 分鐘皆為 792.52／822.82／−30.30 百萬元；最新分鐘依各自擷取時刻繼續變動。兩邊均顯示未知方向 0 筆，**未遇到**可驗收未知方向不改淨額的真實成交。關閉獨立視窗後主面板仍更新，沒有發現表格重複分鐘；但未量測精確 refcount／cleanup 或閱讀位置。
- **未通過／unknown**：本輪另有唯讀 `/api/v1/stream/data` 取樣兩筆 2308 賣方成交，但沒有頁面 SharedWorker 的逐 request path/count、事件抵達與渲染前後同一筆的可歸因 trace；首次 `/api/v1/data/ticks` request count 亦未知。未驗上櫃股、真實未知方向，以及只隔離驗收頁的斷線／重連與有界補洞，不能用本次自然發生的 `partial → verified` 冒充注入斷線驗收。5.1–5.6 保持未勾選，不能評估歸檔。
- **回歸／安全**：focused unit 5 檔 59/59、browser 2 檔 27/27 通過；三個 change strict validation 與 `git diff --check` 通過。09:24 仍為 simulation、production stopped、write master disabled、watchdog restart count 0；無交易寫入、服務啟停、archive、commit 或 push。

## 2026-09-30 12:07–12:15 盤中追加驗收（Asia/Taipei）

- **來源／分鐘正向證據**：既有 Chrome 主頁 Network 記錄到上櫃 `7714`、`5347` 與上市 `2449` 各兩筆 `POST /api/v1/data/ticks`；前四筆可見 HTTP 200，Payload 抽查確認 `7714` 的 `AllDay`／`RangeTime` 及 `5347`、`2449` 各一筆 `AllDay`，來源日皆 `2026-09-30`。其餘 Payload／status 未逐筆讀取，不冒充已核實。`2449` 12:07 顯示 `verified`、已載入 5,018 筆、188 個成交分鐘，12:07 整體／大單／非大單為 −306.92／−194.47／−112.46 百萬元；主頁與獨立視窗稍後同為 5,028 筆、189 分鐘，12:08 值為 −316.69／−203.35／−113.34。`5347` 12:11:29 顯示 `verified`、AllDay／RangeTime 5,221 筆一致、已載入 5,224 筆、192 分鐘，12:11 三值為 +443.35／−119.04／+562.39；12:11:36 前進至 5,227 筆，整體與非大單分別 +0.73 百萬元，大單不變。
- **單筆成交與跨視窗**：`5347` 主面板逐筆列表由 5,286→5,287 筆，最新事件鍵 `STK:OTC:5347|2026-09-30|12:14:34.498540|182.5|1|1#1`，即 182.5 元、1 張買方。同期獨立視窗 12:14 整體／大單／非大單淨額由 +452.12／−119.04／+571.17 變為 +452.31／−119.04／+571.35 百萬元；整體／非大單的顯示增量約 +0.19／+0.18，差 0.01 為各欄獨立四捨五入，原始成交金額為 0.1825 百萬元。獨立視窗 2449 的分鐘表曾捲至 11:56；新分鐘出現後仍保留該閱讀位置。關閉 popout 後主頁仍有新成交，所有驗收 popout 已關閉。
- **未通過／unknown**：本次 Network 可歸因歷史雙查詢，仍無法看到 SharedWorker 所屬的 `/api/v1/stream/data` 逐 request/event 及精確 refcount／最後 listener cleanup。真實資料均顯示未知方向 0 筆，未遇到可實盤驗收的未知方向成交；沒有可安全只隔離驗收頁的 SSE 斷線方式，故未注入斷線、未驗證有界補洞與 partial → verified。沒有將畫面持續更新或 source inspection 冒充完整 SSE network 證明。前後 runtime 均為 simulation、production stopped、write master disabled、watchdog restart count 0；未交易寫入或啟停服務。tasks 5.1–5.6 暫不勾選，不得歸檔。
- **回歸**：本輪 focused Node tests 5 檔 51/51 通過；Browser tests 依 `vitest.browser.config.ts` 執行 3 檔 35/35 通過；兩個 change 的 OpenSpec strict validation 與 `git diff --check` 通過。直接以 Node 環境執行 `.browser.test.ts` 曾因沒有 DOM 而報 `document is not defined`，使用專案指定 Browser config 後全數通過，並非產品缺陷。

## 2026-09-30 12:24–12:39 上市／上櫃 SSE 與頁面隔離斷線接續（Asia/Taipei）

- **已成立的 5.1 證據**：沿用同一 simulation business session，先前 11:58–12:15 Chrome Network 已記錄 `2449` 上市及 `5347` 上櫃各兩筆 `/api/v1/data/ticks` POST。12:35–12:37 另對既有 `/api/v1/stream/data` 作短暫唯讀 HTTP 觀察，取得 `2449` 四筆、`5347` 四筆真正 `tick_stk`；兩個獨立成交列表中，每筆精確時間、成交價與張數都各出現一次，沒有重複列。`2449` 12:36:06.718387 為 `verified`、AllDay／RangeTime 5,287 筆一致，已載入 5,313 筆／217 個成交分鐘；12:36 分鐘整體／大單／非大單為 −352.08／−230.51／−121.57 百萬元。`5347` 12:37:07.353688 為 `verified`、AllDay／RangeTime 5,640 筆一致，已載入 5,655 筆／18,706 張、218 個成交分鐘；12:37 分鐘三值為 +459.89／−142.33／+602.22 百萬元。來源日均為 2026-09-30。5.1 所需來源、時間、row／volume、分鐘點、三種淨額及 SSE 對照已成立，故勾選；唯讀 SSE 連線不是頁面 SharedWorker 的直接 trace，不能據此勾 5.2／5.4。
- **斷線、補洞與既有點位**：主頁 2449 僅透過 Chrome DevTools Network 離線隔離；第一次 12:24:27–12:27:01 約 2 分 34 秒，第二次 12:27:28–12:27:32。隔離時 `LOST`、`partial`，原成交 5,195 筆／16,853 張及既有分價統計未清空；恢復後經等待下一筆、歷史補齊及暫時 `snapshot_ahead_of_history`，12:28:32 再達 AllDay／RangeTime 與 Snapshot 守恆的 `verified`。切到資金流向時，既有 12:24 分鐘仍在，12:25／12:26／12:27／12:28 依序存在，12:28 分鐘三值 −324.23／−212.72／−111.51 百萬元，209 個成交分鐘；12:29 進到 210 分鐘。這證明斷線並未清掉既有點位且補齊後持續更新；未知方向始終顯示 0 筆，沒有真實未知方向事件可供此輪驗收。
- **獨立視窗閱讀位置與連線限制**：2449 主面板／獨立視窗在 12:30:17.317019 同時為 5,237 筆／16,914 張；獨立資金流向捲離最新至可見 10:38 後，新分鐘使分鐘數 211→212，`scrollTop` 3,252→3,280（新增一列 28px），可見的 10:38 仍不變。關閉 popout 後主頁繼續由 5,241 筆前進到 5,245 筆。另一次開窗前／中／後 API `active_connections` 均為 23，只能證明未見可歸因的連線增加，不能量測 SharedWorker port refcount 或最後 listener cleanup。所有驗收 popout 已關閉；未切換 production、未下單或啟停服務。
- **尚未通過**：5.2 需頁面自身 SharedWorker SSE request/event 與同一 session 的可歸因證據；5.3 尚缺真實未知方向（斷線／補洞的部分已實測）；5.4 尚缺精確 refcount／cleanup；5.5 尚缺修正後完整 broker 訂閱 request count；5.6 需前述任務全過後才可勾。DevTools Offline 的預設已以 `Go online` 恢復 `No throttling`，`Disable cache` 已取消，主頁恢復 `LIVE`。本輪來源 SSE 取樣有一度因觀察指令錯誤地期待 `event:`／`data:` 後有空白而沒有輸出；修正解析後取得上述事件，不將那段空結果誤判為行情缺失。

## 2026-09-30 12:42–12:47 方向來源及訂閱數追加核對（Asia/Taipei）

- 唯讀查詢當日 `2449` AllDay 5,545 筆（截至 12:44:03）及 `5347` AllDay 5,751 筆（截至 12:44:03）：前者 `tick_type=1/2` 分別 2,670／2,875，後者 4,166／1,585，均無其他方向。另以既有共用 SSE 唯讀取樣 20 秒，190 筆 `tick_stk` 為買 111、賣 79，仍無未知方向；不能製造事件或將零筆稱為真實未知方向行為驗收。純 domain／browser 測試已涵蓋未知方向不改淨額，但不冒充今日實盤事件。
- 原主頁保持 `LIVE`；另開 `2449` 成交明細獨立分頁並只重載該頁，Chrome Network 記錄到恰好兩筆 `/api/v1/stream/subscribe` `POST 200`，Payload 為 `Tick`、`BidAsk` 各一筆。切換「分價量表／資金流向／成交明細」後仍是兩筆，且沒有新增 `/api/v1/data/ticks` 請求；未見第三筆重複 Tick 訂閱。驗收分頁已關閉，瀏覽器只留使用者原主頁。這補上該商品局部的修正後 request count，但不是頁面 SharedWorker EventSource trace、精確 port refcount 或最後 listener cleanup，故 5.2–5.6 仍未全數通過。

## 2026-09-30 收盤後：次日驗收準備

- 沿用分價量表 change 的既有 SharedWorker port 唯讀診斷與指定商品有界 tick trace；未新增 REST／SSE、broker subscription、第二次登入、持久化逐筆紀錄或交易行為。共用來源／port 的單元測試證明兩頁共享一條來源、關閉其中一頁仍保留來源、最後 port 關閉時呼叫 source.close；這是**離線回歸**，不是次日真實盤中驗收。
- 明日將以同一筆來源成交的日期／時間／價／量／`tick_type`，對照 Debug 診斷 trace、歷史／UI row、分鐘淨額和大單／非大單變化，並在主頁、獨立視窗、關窗後各擷取 portCount 與事件計數。若 source 實際仍沒有未知方向成交，記錄觀測母體與 `tick_type` 分布，5.3 的未知方向實盤分支仍標示未觀察；不得造資料、不得以離線測試冒充真實成交，也不在未取得使用者確認前擅自放寬驗收條件。
- 收盤後 focused Node tests 7 檔 56/56、相關 Browser tests 3 檔 35/35、`pnpm build` 及兩個 change 的 strict validation 均通過；首次 build 的 CSS selector 錯誤已修復後重跑。5.2–5.6 保持未勾選，沒有 archive／commit／push。
