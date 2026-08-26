# 驗收證據

## 範圍與安全邊界

- Change：`add-multiview-kbar-turnover-readout`
- 基準 Git HEAD：`b669ff23e4119a1c9f39de6820c76eed5242520b`
- 驗收範圍僅為本機 MultiView simulation market-data readout；沒有 broker write、production、CA、部署、commit、push或服務啟停。
- 精確成交值只接受 Shioaji `KBars.Amount` 與可信 Tick `amount／total_amount`。Yahoo、國外商品、指數及缺漏資料顯示 `值 —`，沒有估算或跨來源補值。

## 已完成垂直切片

### Task 1.1–1.3：精確資料契約

- `turnoverTwd` 僅接受非負 safe integer 元值；格式涵蓋零、小額、萬元、千分位與 unavailable。
- Kbars cache 綁定 `local-shioaji-simulation` 與 `multiview-kbar-turnover/1`；5／15／60 分及日 K 只加總完整合法子集合。
- focused integration 已驗證 coordinator → aggregation → chart payload 保持同一 current schema。

### Task 2.1–2.3：forming與generation安全

- Tick amount／total_amount 與 volume 共用 identity、台北交易日、source time、sequence、connection及generation事件邊界，但使用獨立 fail-unavailable cursor。
- 已覆蓋重送、倒序、sequence gap、矛盾、累計倒退、zero-volume、simtrade及舊 connection／generation；成交值失效不阻擋合法 price／volume。

### Task 3.1–3.3：MultiView readout

- fixed／floating readout 在成交量後顯示 `值 …萬`；title／accessible name 為 `成交值 …萬元`。
- crosshair與latest fallback只更新既有 readout field，沿用 per-panel animation-frame latest-wins及payload signature。
- 完整panel PNG保留目前可見欄位；residual scan沒有成交值axis、series、price scale、指標、checkbox、D1或交易路徑。

### Task 4.1–4.3：指定日期與文件

- `daily-minute-target-request/2`／`response/2` 把每根 candle 的精確值、schema、source identity及整份 `available／partial／unavailable` 納入不可變驗證。
- MultiView staged payload 綁定 request identity、target date及當次panel generation；商品、日期、interval、load token或generation漂移時整份舊結果不得提交。
- Amount缺漏但OHLCV合法時，candle保留且成交值為 unavailable；單日資料不寫入Yahoo、Cloudflare、Sites或D1。
- README與本機runtime文件已記錄來源、格式、provider差異與simulation-only安全邊界。

## Focused與integration結果

- `pnpm exec vitest run src/lib/daily-minute-drilldown-contract.test.ts src/lib/main-chart-daily-drilldown.test.ts src/lib/kbar-turnover-residual.test.ts`
  - 結果：3個test files、68項測試全部通過。
- `node --test apps/multiview/tests/realtime-coordinator.test.mjs apps/multiview/tests/chart-payload.test.mjs apps/multiview/tests/kbar-turnover-readout.test.mjs apps/multiview/tests/rendered-html.test.mjs apps/multiview/tests/cloudflare-runtime.test.mjs`
  - 結果：109項測試全部通過。
- Task 3完整focused／integration／匯出／鄰接回歸：139項全部通過。
- `git diff --check`：通過。

### Task 5.2：Node 24驗證與production build

- 受管Node：`v24.19.0`；pnpm：`11.19.0`。
- `pnpm test:multiview`：production build成功；最終closure補入跨交易日turnover chain regression後為538／538通過。
- `pnpm exec tsc -p tsconfig.app.json --noEmit --pretty false`：通過。
- `pnpm typecheck:multiview`：通過。
- `pnpm lint:multiview`：通過；修正加總邊界後再次執行仍通過。
- `openspec validate add-multiview-kbar-turnover-readout --strict`：通過。
- `git diff --check`：通過。
- 獨立P0／P1差異審查先後發現並修正`addTurnoverTwd`對canonical數字字串可能執行字串串接、匯出元件未載入時可能靜默返回、跨交易日第一筆事件未重建turnover chain，以及合法字串`0.0`格式未先正規化的邊界；均以focused、完整測試與實際頁面重新驗證。

### Task 5.1：實際頁面browser-visible矩陣

- 沿用既有`127.0.0.1:5174` listener，未啟停服務；`/api/v1/info`確認`simulation=true`、`/api/v1/health`為healthy，2330 snapshot與Kbars的`Amount`皆由受管simulation market-data session唯讀取得，沒有broker write。
- 實際頁面固定readout依序驗收2330的1／5／15／60分與日K，分別顯示`值 11,569萬`、`值 12,052萬`、`值 158,108萬`、`值 569,053萬`與`值 1,931,708萬`；每筆accessible name皆為相同數值的`成交值 …萬元`。
- forming 1分K在12秒內由53張、`值 12,775萬`更新為54張、`值 13,017萬`，增量與新增一張2415元成交一致；沒有重建圖表或重複計量。
- 實際移動游標到歷史K棒時顯示`值 1,896萬`，移出圖區後回復latest `值 14,945萬`；切到floating模式後crosshair顯示`值 3,089萬`且accessible name一致，驗收後已恢復fixed模式。
- 在日K的2026-06-08有效K棒雙擊，頁面回報`2026-06-08 1 分 K 已載入`，指定日期1分K顯示`值 42,870萬`且accessible name一致。
- 1／2／4／8 panel均完成實際頁面驗收；800×700窄版下8個成交值欄位皆維持`white-space: nowrap`、只在欄位邊界換行且沒有越出panel。可用Shioaji panel顯示精確值，來源缺漏panel保守顯示`值 —`／`成交值 —`。
- Shioaji日K實際readout顯示`值 131,954萬`、accessible name為`成交值 131,954萬元`；完整panel PNG匯出成功，頁面回報`圖片已儲存：00919.TW_1d_2026-08-26T03-10-55-512Z.png`。先前Yahoo缺值路徑亦回報`圖片已儲存：00919.TW_1d_2026-08-26T03-09-53-935Z.png`，證明精確值與unavailable狀態均可匯出。
- PNG操作發現舊程式在匯出元件未載入時可能靜默返回；已改為明確fail closed並加入靜態資源版本輪替與focused regression。實際成功匯出後已恢復原本Shioaji來源與多層副圖顯示設定。

### Task 5.3：獨立P0／P1 closure

- 獨立差異審查逐項核對parser／formatter、Kbars Amount對齊、1／5／15／60分與日K聚合、forming cursor、session／sequence／connection／generation、target-date atomic commit、DOM hot path、PNG匯出與交易能力邊界。
- 新增跨交易日第一筆精確事件重建turnover chain regression，證明下一筆可繼續以相同累計鏈推進；來源缺漏、矛盾、倒退、overflow或舊schema仍永久fail unavailable，不影響合法OHLCV。
- `node --test tests/kbar-turnover.test.mjs tests/realtime-charts.test.mjs tests/kbar-turnover-readout.test.mjs tests/panel-image-export.test.mjs tests/rendered-html.test.mjs`：99／99通過。
- `pnpm exec vitest run src/lib/daily-minute-drilldown-contract.test.ts src/lib/main-chart-daily-drilldown.test.ts src/lib/kbar-turnover-residual.test.ts`：3個test files、68／68通過。
- `pnpm test:multiview`：Node `v24.19.0`完成production build，538／538通過。
- `pnpm exec tsc -p tsconfig.app.json --noEmit --pretty false`、`pnpm typecheck:multiview`、`pnpm lint:multiview`：全部通過。
- `openspec validate add-multiview-kbar-turnover-readout --strict`與`git diff --check`：全部通過。
- 最終重新載入實際`127.0.0.1:5174`頁面，Shioaji日K顯示`值 132,537萬`且accessible name為`成交值 132,537萬元`；沒有服務啟停或broker write。
- 最終closure沒有剩餘P0／P1；本change的15項completion contract全部通過。

## Source fingerprint

| 檔案 | SHA-256 |
|---|---|
| `apps/multiview/public/static/kbar-turnover.js` | `68318c834f001305ea429a43e0c2fa24f537c7e60169a35d7ff98eaf6f3efdc5` |
| `apps/multiview/public/static/realtime-coordinator.js` | `407bff24b08440de412ef00f757ad41677e4bb7f38274b69ea7e1ee17adb328b` |
| `apps/multiview/public/static/realtime-charts.js` | `f7b55f07cd389462b75fda0a3142d4ce944780ce4275a8b4be684716f4f305e3` |
| `apps/multiview/public/static/chart-payload.js` | `a4d584f288c8bfb65ad07cddf78b305fd6a9f3a4b017d745c22f2a37e01fe319` |
| `apps/multiview/public/static/daily-minute-drilldown-contract.js` | `dece9adc4ae7bcb38f4cf6a4ed5d9302692f9cd5ffb9056fc729c00f723809b7` |
| `apps/multiview/public/static/app.js` | `9287d697fe9494a2844b9a171657d67c2e5444eb5c14be4738852d816f611602` |
| `apps/multiview/public/static/index.html` | `e073111ccce61be1ca25a3dd1ee64a34db88fa91ec9c75c02527960c852626f1` |
| `src/lib/daily-minute-drilldown-contract.ts` | `9efab8226159f5d52611e3e789b53cd2226aacd7779c5f85d1e1023213c5f2c5` |
