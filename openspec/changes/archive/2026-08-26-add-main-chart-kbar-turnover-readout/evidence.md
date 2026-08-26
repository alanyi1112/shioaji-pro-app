# 驗收證據

## 實作範圍

- 主交易畫面 canonical `Candle` 已加入 `turnoverTwd: number | null`，歷史資料只接受同列 Shioaji `KBars.Amount` 的非負 safe integer 元值。
- 1／5／15／60 分與日 K 只在 bucket 子集合完整時加總成交值；缺漏、非法或溢位皆為 `null`，沒有以 OHLC、均價或成交量估算。
- STK live cursor 已在既有 identity、simulation generation、台北交易日、source time 與 sequence 邊界內共同處理 `total_volume`、`amount` 與 `total_amount`。重放、倒退、跨 session、矛盾或非法成交值會讓成交值 chain 維持 unavailable，但不阻擋合法 OHLCV／volume。
- 主交易畫面 target-date 不可變 snapshot 與 atomic commit 已攜帶 `turnoverTwd` availability；MultiView payload、cache 與 runtime 檔案沒有修改。
- readout 對台股整股顯示 `量 …張　值 …萬`，tooltip／accessible name 使用 `成交值 …萬元`。既有欄位邊界換行與單欄 `white-space: nowrap` 契約沿用，沒有新增 axis、series、設定或 API request。

## Focused、integration 與 fault injection

執行：

```text
pnpm exec vitest run src/lib/kbar-turnover.test.ts src/lib/kbar-turnover-residual.test.ts src/lib/kbar-readout.test.ts src/lib/chart-volume-contract.test.ts src/lib/daily-minute-drilldown-contract.test.ts src/lib/main-chart-daily-drilldown.test.ts src/lib/chart-volume-parity.integration.test.ts
```

結果：7 個 test files、114 個 tests 全部通過。涵蓋 strict parser、萬元 formatter、Amount 長度不符、bucket 不完整、safe integer 溢位、history prepend／same-bucket live replacement、cursor bootstrap／重放／倒退／缺漏／矛盾欄位、zero-volume／simtrade snapshot 不得推進成交值 cursor、target-date Amount 缺漏與偽造小數元、MultiView residual boundary。

`pnpm test:browser` 在允許本機測試 listener 的隔離環境執行，5 個 test files、65 個 tests 全部通過。

另執行完整 `pnpm test`；目前 working tree 同時包含暫停中的 `add-durable-smart-order-panel-and-protective-exits`，輸出所見失敗均位於其 `scripts/smart-order-runtime/*`、`scripts/smart-order-task*` 與 `scripts/realtimestock-runtime.test.mjs`，受私有 lease／managed Runtime／evidence precondition 影響。本 change 沒有修改該 change 的 tasks、manifest、智慧下單 evidence，也沒有以其當下 runtime 狀態取代本 change 的 focused acceptance。

## `127.0.0.1:5173` 實際頁面

2026-08-25 收盤後，以既有 listener 與 simulation 行情完成唯讀可見驗收；沒有啟停服務或執行交易操作：

- 3441 的 1 分 K：`量 1,176張`、`值 13,406萬`，title／accessible name 為 `成交值 13,406萬元`。
- 5 分 K：`量 1,176張`、`值 13,406萬`。
- 15 分 K：`量 1,176張`、`值 13,406萬`。
- 60 分 K：`量 4,324張`、`值 49,524萬`。
- 日 K：`量 26,865張`、`值 304,009萬`。
- 滑鼠命中歷史 1 分 K（12:48）：`量 16張`、`值 182萬`。
- 雙擊 2026-08-04 日 K 後，主畫面進入該日 1 分 K；12:51 readout 顯示 `量 96張`、`值 839萬`，並顯示「2026-08-04 的 simulation 1 分 K 已載入」。
- 1 分 K 尚未完成資料 commit 的 unavailable 狀態顯示 `量 —`、`值 —`，title／accessible name 為 `成交值 —`，沒有誤顯示 `0萬`。
- 760×900 viewport 下，成交值欄位 `white-space: nowrap`，完整位於 viewport 與 readout 容器內，沒有拆分或裁切。
- 驗收期間 browser console error 為 0。

2026-08-26 台股現貨 session 內，以相同既有 listener 完成形成中 K 棒驗收；沒有啟停服務或執行交易操作：

- 2330 形成中 1 分 K 在多筆 live ticks 後由 `量 3張`／`值 715萬`更新為`量 24張`／`值 5,719萬`，accessible name 為`成交值 5,719萬元`；完整重載後 09:37 K 棒顯示`量 3張`／`值 717萬`與`成交值 717萬元`。
- 形成中 5 分 K：`量 17張`、`值 4,040萬`；15 分 K：`量 594張`、`值 141,328萬`；60 分 K：`量 3,403張`、`值 809,303萬`；日 K：`量 3,493張`、`值 830,686萬`。各欄位 accessible name 均使用相同萬元值。
- 實際 SSE 對帳確認 Shioaji trade tick 的`amount`與`total_amount`為合法精確元值，且相鄰 cumulative delta 等於單筆`amount`。驗收另發現 zero-volume non-trade snapshot 不會推進`flashSeq`；production 現已在 strict cursor 前排除 zero-volume／simtrade／非法 volume snapshot，避免同一 UI snapshot 被誤判為 sequence replay。
- 修補後以乾淨頁面重載、跨多筆成交與跨時框切換重驗；成交值未再轉成`—`，browser console error 為 0。

## TypeScript、build、OpenSpec 與 diff

- `pnpm exec tsc -b --pretty false`：通過。
- `pnpm build`：通過；只有既有 dynamic import 與 chunk size warning。
- `openspec validate add-main-chart-kbar-turnover-readout --strict`：通過。
- `git diff --check`：通過。
- production residual scan：主圖仍只有既有 4 個 `fetchKbars()` call；沒有 turnover series、left price scale、axis 或 MultiView `turnoverTwd` consumer。

## 獨立 P0／P1 closure

- P0：0。
- P1：0。開盤期間曾發現 zero-volume snapshot 會誤傷 strict turnover chain，已修正並加入 focused regression test及實際頁面重驗。
- simulation、production、CA、broker write、部署、commit、push與服務生命週期邊界均未改變。
