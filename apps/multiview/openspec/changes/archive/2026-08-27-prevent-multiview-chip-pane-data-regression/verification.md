# 驗證紀錄

日期：2026-08-27

## 實作證據

- 前端以 `symbol + interval + dataset` 建立有界 verified-slice store；每次 response 先逐 dataset 驗證、裁切及 reconcile，再交給 request cache、前景載入、背景 revalidation、相鄰頁預載及共用 in-flight。
- HTTP 200 空白、較舊或覆蓋較差的回應不再清除已驗證 series；合法的同日修正仍可依日期覆寫。
- reconcile 前會同時驗證 top-level payload、日資料 row 與 TDCC row 的 `symbol`／`interval`；identity 不一致時直接拒絕，且不得污染 request cache 或 verified-slice store。
- 同日 daily candidate 會比較逐 dataset 欄位完整度；較稀疏資料不再覆寫完整舊值，完整且合法的同日修正仍可更新。
- `shareholder-distribution` 必須具備不重複的 1 至 15 級、調整列與合計列，並通過 holders／shares／ratio 對帳後才可提交。
- 對外 `rows`、`coverage` 與 `sources` 會依目前 request range 重新投影，顯示資料的 provider 取自實際保留 row provenance，不再沿用範圍外日期或未採用候選的 metadata。
- 保留舊資料時會標示 `retained_stale`、實際資料日期及來源狀態；游標停在尚未發布的日期仍顯示「當日無資料」，沒有 forward-fill 或補零。
- 大戶／散戶等持股 pane 停用右側價格軸 pressed-move，但保留時間軸手勢；mount、render 與 candle 通知都會恢復持股相關 price scale 的 autoscale，避免縱軸拖曳或同日新價位使持股比 series 移出可視範圍。
- Yahoo 與 Shioaji 日 K timestamp 統一以 `Asia/Taipei` 交易日對齊 TDCC；相同日期範圍的新價位仍會通知 controller 做輕量 autoscale 修復，但不會重新 fetch、load 或重建籌碼 series。
- Worker 最終以 D1 重新讀取結果為準，並依 cache／deferred／accepted／empty／failed 的本次 refresh outcome 判定 availability；只有 empty／failed 且使用 D1 舊列時才標示 `stale_cache`，成功取得官方最新 tail 時維持 truthful `available`。
- KD、RSI、MACD、ATR 的新 K 棒與同 K 修正壓力測試均保持可繪製，未重現獨立的技術副圖清空缺陷，因此未修改其 production lifecycle。

## Deterministic 驗證

- 精準差異聚焦測試 `node --test tests/chip-pane-status.test.mjs tests/taiwan-stock-chip-service.test.mjs`：57/57 通過；涵蓋 identity 拒絕、同日稀疏保留／完整修正、TDCC 完整性、range metadata 與 Worker 成功 latest tail availability。
- 持股穩定性聚焦測試 `node --test tests/chip-pane-status.test.mjs tests/subchart-interaction.test.mjs tests/rendered-html.test.mjs tests/cloudflare-runtime.test.mjs`：146/146 通過；涵蓋持股價格軸保護、autoscale 恢復、同日期新價位的 controller 通知、Yahoo／Shioaji 台北交易日對齊及靜態資產版本。
- `npm run lint`：通過，0 warnings。
- `npm test`：build 通過；565/565 測試通過，0 failed；其中 staging migration 套用 23 個 migration 且無 schema drift。
- `git diff --check`：通過。
- `openspec validate --all --strict --no-interactive`：通過。

Build 僅出現既有的 Node `module.register()` deprecation 與 Vite native config future-warning；不影響 build 或測試結果。

## 本機瀏覽器驗收

- 使用既有 `127.0.0.1:5174` MultiView，僅在臨時瀏覽器 session 切換為 Yahoo 延遲行情；未啟動、重啟或操作交易 runtime。
- 驗收不是只跑四圖：逐一切換所有支援多層副圖的 1／2／3／4 圖版型，並逐段捲動觸發虛擬化掛載。每個可見 panel 都啟用並驗證 KD、RSI、MACD、ATR，以及法人 4 個、融資券 5 個、持股比 3 個，共 12 個籌碼副圖；每一個 pane 都曾進入 viewport、建立 7 個 canvas，重掃後 loading count 均為 0。
- 1 圖驗收 `00919.TW`；2 圖驗收 `00919.TW`、`00878.TW`；3 圖驗收 `00919.TW`、`00878.TW`、`00929.TW`；4 圖第 1 頁驗收 `00919.TW`、`00878.TW`、`00929.TW`、`00981A.TW`。每個版型都在持股比副圖保持掛載時等待 20 秒，所有大戶、散戶與集保戶數的文字、日期及 7 個 canvas 在背景更新前後完全一致。
- 4 圖第 2 頁驗收 `00982A.TW`、`009816.TW`、`009819.TW`、`3231.TW`，同時涵蓋 ETF 與股票；12 個籌碼副圖與 4 個技術指標均完成掛載，20 秒後三個持股比副圖仍逐字一致且 loading count 為 0。
- 6 圖與 8 圖均確認多層選項為 disabled，實際 presentation 強制為 `single`；分別建立 6／8 個技術指標圖且不建立 `.chip-pane`，沒有殘留錯誤的多層副圖狀態。
- `009819.TW` 游標日期顯示「2026-04-20 當日無資料」，證明沒有用前一期 TDCC 值補齊；`3231.TW` 顯示 2026-08-21 的大戶／散戶實際讀值。
- 頁面 acceptance metrics 最終顯示 `panelCount=4`、`requestCount=15`、`realtimeRetryCount=0`、`realtimeRecoveryCount=0`、`reasonCode=yahoo_forced`；所有 pane 最終都有資料或 truthful 部分資料狀態，沒有未結束的 loading。
- Browser console error：0。
- 驗收後已將版型、頁碼與副圖勾選恢復為原先的四圖第 1 頁、`multi`、KD／ATR 與原有 11 個籌碼選項，沒有把臨時驗收設定留給使用者。

### 持股縱軸與新價位專項驗收

- 修正前在 `00919.TW` 大戶持股 pane 對右側縱軸重複拖曳，可重現持股比藍線消失但 direction bar、資料與 canvas 仍存在；證實問題是 price scale 被手動移出可視範圍，而不是資料遭清空。
- 修正前切換為 `auto` 的 Shioaji 日 K 時，可重現大戶／散戶線圖消失且 readout 顯示「當日無資料」；該來源的 `1787760000` 是 `2026-08-26T16:00:00Z`，實際為台北 `2026-08-27 00:00`，原先 UTC 截日會錯映為前一交易日。
- 修正後逐一驗收所有支援多層副圖的 1／2／3／4 圖版型，分別涵蓋 2／4／6／8 個大戶與散戶 pane；每個 pane 的右側縱軸各重複拖曳 3 次，持股線、讀值與 7 個 canvas 均保持可見，沒有只驗四圖。
- 最後驗收時市場已轉為 closing，無法再等待下一筆真實盤中新價；但修正前的 live 路徑已精準重現，且 deterministic 測試以相同 Shioaji timestamp 與同日期 candle 更新驗證不重新 fetch／load、controller 仍收到通知並恢復 autoscale。`auto` closing 狀態下四圖 8 個持股 pane 亦均正常顯示 2026-08-21 資料。
- 專項驗收的 Browser console error：0；結束前已把行情來源由臨時 `auto` 恢復為原先的 `Yahoo 延遲`，四圖第 1 頁仍有 8 個大戶／散戶 pane。

## 邊界

- 本次沒有部署、push、啟停行情或交易服務，也沒有執行任何下單操作。
- 5174 listener 經唯讀確認為 2026-08-27 09:05 已啟動的既有 MultiView 程序，因此保持運作、不予停止。
