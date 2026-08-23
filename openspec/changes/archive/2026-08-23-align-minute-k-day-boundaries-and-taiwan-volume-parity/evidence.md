# 驗證證據

## 2026-08-23 契約核心（Tasks 1.1～1.3）

- 建立 `test-fixtures/chart-day-volume-parity.json`，只保存人工最小 OHLCV、日期、provider、unit、cursor 與期望值，不含帳戶、credential 或完整行情 payload。
- `chart-volume-contract/1` 固定 Shioaji lot identity、Yahoo／TWSE share-to-lot、小數張、current revision 與 provider／unit／market／security type fail-closed 契約。
- `selectDayBoundaries` 只接受 `1m`／`5m`／`15m`／`1h` 或數值 1／5／15／60；`intraday`、日／週／月及同日缺口不建立 boundary。
- focused tests：3 files／32 tests 通過；TypeScript、OpenSpec strict 與 diff／trailing-whitespace check 通過。

## 2026-08-23 主交易畫面垂直切片（Tasks 2.1～2.3）

- `ChartColors.dayBoundary` 與 `DayBoundaryPrimitive` production wiring 已改用獨立亮黃色：dark／midnight `#facc15`、light `#ca8a04`；不再沿用 grid color。
- 台股整股 Kbars 經 `kbarsToTaiwanStockCandles` 明確採 `common_lot` identity conversion；非法 volume 使載入 fail closed。
- live tail 以 `CommonLotVolumeCursor` 綁定 `symbol + timeframe + load generation`，由目前 session Kbars 累計量 seed，再依 source time、sequence 與 `total_volume` delta 推進。重送、倒序、累計量倒退、舊 session、identity mismatch、未 bootstrap 或新 session 未 bootstrap 均不改寫 candle。
- focused tests：3 files／35 tests 通過。
- Chromium browser harness：1 file／23 tests 通過；實際 canvas pixel 驗證亮黃色 primitive，涵蓋 1／2／4／8 chart、兩個 pane、resize、time-scale scroll 與 cleanup；console 無未處理錯誤。
- TypeScript 與 production build 通過。build 只有既有 dynamic-import 與 chunk-size warnings，沒有 error。
- 本驗收只使用一次性本機 loopback browser test server；未啟停現行行情服務，未進行 broker write、production、CA、真實下單、部署、commit 或 push。

## 2026-08-23 MultiView 分鐘 K 分日線垂直切片（Tasks 3.1～3.3）

- 新增固定 Lightweight Charts 5.0.9 實際可執行的 series primitive；以 `Asia/Taipei` 相鄰日期 selector、1.2 CSS px、`#facc15`、background z-order 與無 hit-test 契約繪製，不建立資料 series、不參與 autoscale 或 pointer。
- `DayBoundarySeriesManager` 對 Candlestick 與技術副圖 time anchor 各維持一個 primitive；volume 與 Candlestick 位於同一主 pane，因此同一 attachment 覆蓋兩者。payload、history prepend、分鐘 bootstrap／Tick、一般 live stream、即時指標重算、技術副圖 recovery、pane selection、時框／商品重建與 panel destroy 均已接入 production lifecycle。
- 共享 fixture／lifecycle focused tests：5 個相關 test files，共 123 tests 通過；包含同日缺口排除、支援時框、attach／detach、重建、pagination 與 subchart interaction regression。
- Chromium 直接載入專案固定的 Lightweight Charts 5.0.9 bundle 與 production primitive，通過 1／2／4／8 panels × `1m`／`5m`／`15m`／`1h`。每 panel 具有主圖＋成交量＋技術副圖；實際 canvas 驗證亮黃色含抗鋸齒像素，resize／scroll 後仍有 2,896 個可辨識像素，同日缺口為 0，8 panel destroy 前 16 個 attachments 全部 detach，console 無未處理錯誤。
- 完整 panel PNG：`evidence/multiview-day-boundary-8-panel.png`，3200×1056 RGB，SHA-256 `64007679faacfdcc2360f8dc432420ba02f770c196512f5564f19776f1872a9a`。
- MultiView production build 通過。只有既有 Vite native config-loader 相容性提示與 Node `module.register()` deprecation warning，沒有 build error。
- 獨立 P0／P1 closure 發現並修正「技術副圖 time-range recovery 重建後未重新 attach day-boundary primitive」；另補上一般 live stream 與即時指標重算路徑。修正後 focused 123／123、OpenSpec strict 與 `git diff --check` 全部通過，沒有未關閉的本切片 P0／P1。
- 瀏覽器驗收只使用一次性 `127.0.0.1` 隨機埠與人工 fixture；未呼叫行情或交易 API，未啟停現行行情服務，未進行 broker write、production、CA、真實下單、部署、commit 或 push。

## 2026-08-24 分日線 1.2 CSS px 視覺契約修訂

- 依產品決定，主交易畫面與 MultiView 的亮黃色分日線由 2 CSS px 調整為 1.2 CSS px。兩個 renderer 都以 `1.2 × horizontalPixelRatio` 直接計算 bitmap 寬度並以浮點座標置中；DPR 1 為 1.2 bitmap px，DPR 2 為 2.4 bitmap px，不四捨五入回整數 CSS px。
- 主畫面 focused primitive tests 6／6、MultiView primitive／lifecycle tests 48／48 通過，涵蓋 DPR 1、DPR 2、中點、pane 對齊、重繪與 cleanup。
- 主畫面 Chromium browser suite 65／65 通過；MultiView Chromium matrix 通過 1／2／4／8 panels × `1m`／`5m`／`15m`／`1h`，resize／scroll 後仍有 2,896 個黃色含抗鋸齒像素，同日缺口為 0，16 個 attachments 全部 detach。
- 初次 browser 重跑沿用舊的「像素必須完全等於 `#facc15`」判定，次像素抗鋸齒使計數為 0；驗收器改為辨識與背景混色後仍符合黃色通道關係的像素，精確寬度仍由 renderer 單元契約鎖定，沒有放寬資料、生命週期或可見性要求。
- 主畫面與 MultiView TypeScript、MultiView ESLint（0 warnings）、兩個 production build、OpenSpec strict 與 `git diff --check` 通過。build 只有既有 dynamic-import、chunk-size、Vite native config-loader 與 Node `module.register()` warnings。

## 2026-08-24 MultiView 台股日成交量 production 垂直切片（Tasks 4.1～4.3）

- Worker 在 candle 結構驗證後、任何 indicator 計算前，依可信 provider 將台股整股 Yahoo／TWSE shares 除以 1,000，Shioaji lots 採 identity；小數張保留至 candles、volume、Volume MA、Volume Profile 與 readout。非台股整股不套用本契約。
- payload 新增 `volumeContract`，包含 `market=TW`、`securityType=STK`、`provider`、`sourceVolumeUnit`、`canonicalVolumeUnit=common_lot`、`normalizationRevision=taiwan-stock-common-lot/1` 與不可跨 provider 重放的 `sourceFingerprint`。readout 明確顯示「張」，最多保留三位小數。
- Worker candle cache contract 先由 v17 升為 `quote-state-v18-taiwan-stock-common-lot-v1`，實機 closure 再因凌晨收盤階段語意升為 `quote-state-v19-taiwan-overnight-close-v1`；browser payload gate 拒絕缺少 metadata、舊 revision、偽造 unit、未知 provider、重放 fingerprint、負數或非有限成交量。舊 schema stale cache 在上游不可用時回 502 fail closed，不以舊數值污染新圖。
- 本機 Shioaji 日 K 使用現有 simulation-only adapter、SSE demand single-flight、range cache、100,000 rows guard 與 `loadToken` generation guard，載入有界 365 日的一分 Kbars，再依 `Asia/Taipei` 聚合完整日 OHLCV。display payload 與 client-side indicators 全部使用 Shioaji `common_lot`，只存在瀏覽器記憶體，不寫 D1 verified canonical history。
- 強制 `Shioaji 即時` 模式在 Kbars 尚未完成或來源失效時不短暫顯示 Yahoo，也不保留舊 candle／volume／indicator series；`自動`模式失效時以原始完整 `canonicalPayload` 一次 `applyPayload` 回退至已正規化的 Yahoo／TWSE payload，不拼接 OHLCV。
- 日 K `total_volume` cursor 綁定 `symbol + interval + load generation`。Kbars bootstrap 先以當日分鐘量合計 seed；同 session 只接受 source time／sequence／total 前進的 delta，拒絕重送、倒序、累計量倒退與舊 session。若新 session 尚無 Kbar，整日 Snapshot 可原子建立 provisional 日棒並 seed cursor，不會把當日累計量誤灌到前一交易日。
- focused／integration：6 個核心 test files 共 87 tests 通過；Worker API 的盤中 Yahoo share-to-lot、candles／indicators／fingerprint integration 通過；`rendered-html`＋`candle-history` 全套 83／83 通過。
- MultiView ESLint（0 warnings）、production build、OpenSpec strict 與 `git diff --check` 通過。build 僅有既有 Vite native config-loader 相容性提示與 Node `module.register()` deprecation warning。
- 獨立 P0／P1 closure 修正三項：強制 Shioaji 載入期間曾短暫顯示 Yahoo；新 session 尚無當日 Kbar時 cursor 可能永久無法建立日棒；日 K Snapshot OHLC 未在 accumulator 邊界再次 fail closed。修正後未留下本切片 P0／P1。
- 全部驗證使用人工 fixture、mock Worker upstream 與離線 production build；未呼叫現行行情或交易服務，未進行 broker write、production、CA、真實下單、部署、commit 或 push。

## 2026-08-24 MultiView 主圖 K 線 readout 欄位修訂

- 主圖 `main-readout` 的第一列已接成「日期、開、高、低、收、成交量、漲跌」，移除該列漲跌幅；右上角最新價摘要維持既有漲跌幅，不在本次範圍內。
- 新增的成交量使用獨立 `ohlcVolume` selector，直接讀取同一根 canonical candle 的 `volume` 並以目前 `volumeContract` 格式化為 `common_lot`（張）；不複製下方成交量指標列文字，也不與其 selector 衝突。分時摘要亦以相同 Shioaji volume contract 更新該欄位。
- focused／integration：`rendered-html`、`realtime-charts`、`taiwan-stock-volume` 共 81／81 tests 通過；source contract 同時拒絕 `changePercent` readout wiring 與已移除的 formatter。
- 既有 `127.0.0.1:5174` production UI 實際顯示「2026-08-21 開 30.30 高 30.83 低 30.23 收 30.80 成交量 66,725.489 張 漲跌 +0.49」；七個欄位依序可見、沒有漲跌幅，readout `clientWidth`／`scrollWidth` 同為 1,174 px，console error 為 0。
- MultiView ESLint（0 warnings）、TypeScript 與 production build 通過；build 只有既有 Vite native config-loader 與 Node `module.register()` warnings。最終 OpenSpec strict 與 `git diff --check` 通過；未啟停服務，未進行 broker write、production、CA、真實下單、部署、commit 或 push。

## 2026-08-24 跨畫面 integration parity 與文件（Tasks 4.4、5.1）

- `src/lib/chart-volume-parity.integration.test.ts` 將同一份去識別 Shioaji 1 分 K fixture 分別送入主交易畫面的 `kbarsToTaiwanStockCandles`＋日聚合，以及 MultiView production `realtime-charts.js`＋`realtime-indicators.js`。daily OHLCV、成交量柱值與 volume-derived input 完全相同，並再次對照 fixture 固定期望量。
- Yahoo／TWSE fallback 的單位契約由共享 fixture、normalizer 與 payload gate 驗證為 shares ÷ 1,000、保留小數張、provider 與 source fingerprint 不可跨來源重放；文件明確限制為「單位與單一 payload 內部一致」，不宣稱不同 provider 的來源值完全相同。
- README、MultiView README、兩份 local runtime 文件及驗收矩陣已同步：「分 K」為分鐘 K 線；亮黃色 1.2 CSS px 分日線只適用 1／5／15／60 分 K；台股整股 canonical volume 為 `common_lot`（張）；本機 Shioaji display 不取得 D1 verified canonical history 身分。
- focused integration 1／1、TypeScript、OpenSpec strict 與 `git diff --check` 通過。

## 2026-08-24 既有 5174 simulation capability 實機 evidence（Task 4.5）

- 先確認 managed API 為 `simulation=true`、write master disabled，且 5173／5174 仍在運行。為解除既有 `SessionNotEstablished`，只對 `com.alanyi.realtimestock.simulation-api` 執行一次 targeted `launchctl kickstart -k`；API generation 輪替後，business session 與 2330 snapshot 均為 available。沒有停止或重啟 5173、5174 或其他行情服務，也沒有 production、CA、broker write 或委託。
- 強制 Shioaji 正向：`2330.TW`、`2026-08-21`、provider `shioaji`、unit `common_lot`、source fingerprint `shioaji|common_lot|common_lot|taiwan-stock-common-lot/1`，242 根日 K display candles；OHLC `2375／2410／2365／2410`，成交量 `15,735 張`，Volume MA5／MA10／MA20 為 `16,104.8／17,277.8／26,574.4 張`。production UI 實際顯示同一摘要。
- 強制 Yahoo：同商品同日期，provider `yfinance`、unit `common_lot`、source fingerprint `yahoo-chart|share|common_lot|taiwan-stock-common-lot/1`；成交量 `15,768.427 張`，Volume MA5／MA10／MA20 為 `16,170.847／17,350.217／26,696.036 張`。數值差異保留 provider 邊界，不宣稱不同來源逐值相同。
- 自動模式斷線 fallback：reason state `fallback`，完整 Yahoo payload 保持 160 根 display candles，成交量與量能指標仍屬同一 `common_lot` payload；畫面顯示「即時行情中斷，已切換 Yahoo 延遲備援」。強制 Shioaji 失效則清空 candle、成交量、indicator series 與 readout，reason state `unavailable`，沒有殘留 Yahoo OHLCV。`auto → yahoo → shioaji → auto` source mode 都在 production UI 實際切換。
- 收盤 handoff：凌晨跨日 canonical API 回傳 `kind=session-close`、`marketPhase=closed`、session date `2026-08-21`，由 `twse` 以相同日期核對為 `verified`。本機 simulation coordinator 回傳 reason `market_closed` 後，production UI 原子切回 verified canonical payload，顯示 `13:30 收盤`、成交量 `15,768.427 張`；重複 closed notification 保持 idempotent，等待提示沒有 `is-visible`。
- 實機 closure 發現並修正四個 P1：強制 Shioaji 已載入但狀態仍顯示等待的 load/state race；平日凌晨上一交易日有效日 K 被判為 `unknown`；本機 coordinator 收盤後仍把舊 Snapshot 標成 live／degraded；成功 handoff 清除 Snapshot 後，重複 closed notification 又顯示等待。cache contract 升版，舊 market-phase payload 不會被沿用。
- 實機驗收後已還原為 `自動`、1 圖、第 1 頁。證據只保存商品、日期、provider、unit、摘要值及 allowlist reason，不含帳戶、credential 或完整行情 payload。
- 最終驗證：根目錄 focused／安全邊界 4 files／17 tests、MultiView 全套 503／503、獨立 P0／P1 closure 4 files／40 tests、MultiView ESLint 0 warnings、兩側 TypeScript、兩個 production build、OpenSpec strict 與 `git diff --check` 全部通過。build 只有既有 dynamic-import、chunk-size、Vite native config-loader 與 Node `module.register()` warnings。

## 2026-08-24 完整驗證與獨立 P0／P1 closure（Tasks 5.2～5.3）

- 主交易畫面 focused／共享 integration：3 files／15 tests 通過；實際 Chromium Lightweight Charts browser matrix：1 file／23 tests 通過。browser harness 首次在 sandbox 因 `listen EPERM ::1` 未啟動任何測試，改以一次性本機 loopback 埠重跑後 23／23 通過，未啟停現行 5173／5174。
- MultiView focused／integration：8 files／132 tests 通過，涵蓋 day boundary primitive、台股 volume contract、日／分鐘 accumulator、coordinator、indicators、payload gate、Worker candle history 與 production wiring。
- 獨立安全 closure：4 files／24 tests 通過；再次驗證舊 generation latest-wins 與 teardown、payload apply rollback、local adapter route allowlist、order／account／CA／server 路徑 403 且不轉送、非 simulation `simulation_required`、order-ticket bridge 只傳 contract identity 且不直接交易、遠端 realtime feature-off。
- P0／P1 code review 逐條核對：provider／unit／fingerprint 在 indicators 前驗證；日 K cursor 綁定 symbol／interval／load generation，Kbars bootstrap、Snapshot／Tick、重送／倒序／跨 session 均受 guard；source mode／panel destroy 會失效 token 並解除 coordinator 與 primitive；強制 Shioaji 清空混源 series，自動 fallback 只套用完整 canonical payload；Shioaji adapter 只允許 loopback simulation data routes。未發現新的未關閉 P0／P1。
- 主交易畫面與 MultiView TypeScript、MultiView ESLint（0 warnings）、兩個 production build、OpenSpec strict 與 `git diff --check` 通過。主 build 僅有既有 dynamic-import／chunk-size warnings；MultiView build 僅有既有 Vite native config-loader 與 Node `module.register()` warnings。
- closure 未執行 broker write、simulation 新委託、production、CA、真實下單、部署、commit、push或服務啟停／重啟。Task 4.5 的 `SessionNotEstablished` 正向實機缺口不由離線測試冒充完成。
