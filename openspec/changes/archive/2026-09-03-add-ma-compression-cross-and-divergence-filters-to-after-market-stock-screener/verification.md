# 驗證紀錄

驗證日期：2026-09-02（Asia/Taipei）

## 官方來源與資料契約

- 已實際核對 TWSE `MI_INDEX` 與 TPEx `dailyQuotes` 歷史全市場日報；requested date、OHLC、`成交股數`、股數單位及逐列 invalid／missing 守恆結論記錄於 `source-review.md`。
- v4 canonical 資料只接受 `volume_unit=shares`、`volume_mapping_version=official-daily-ohlcv-v2` 與 `validation=canonical-complete-v2`；不以成交值、盤中 Snapshot 或張數顯示值推算成交量。
- 官方來源暫時回 520 時會保存 cursor 與 `nextEligibleAt`；冷卻期間再次呼叫實測以 `requested=0`、`reason=source_cooldown` 返回，不建立假 failed receipt。
- 2026-07-10 經兩市場來源分別以 `invalid_report_date`／`empty_report` 證明為非共同交易日；planner 排除後向前補足另一個正式 session。

## 本機 D1 與全市場 v4 發布

- 使用中的本機 D1 `PRAGMA integrity_check=ok`；additive `volume_shares`、`volume_unit`、`volume_field`、`volume_mapping_version` 欄位及 `screener_daily_ohlcv_v4_coverage_idx` 均存在，既有 v2／v3 published snapshots 保留。
- 130 個共同交易日為 `2026-02-25` 至 `2026-09-02`。canonical OHLCV 共 252,203 列：TWSE 139,387 列、TPEx 112,816 列；逐日筆數範圍分別為 1,061–1,082 與 847–881。
- 目前 260 個 receipts 全為 `collected`；`universeEligible=254,651`、`valid=252,203`、`invalid=2,087`、`missing=361`，每一 receipt 的 `eligible=valid+invalid+missing`，破壞守恆筆數為 0。
- 上市日前 canonical row 為 0；canonical `volume_shares=0` row 為 0。來源對停牌或無有效 OHLCV 的 `--` 列保留為 invalid／missing，未捏造零量或零價 K 棒。
- v4 progress 為 `target=260`、`processed=260`、`remaining=0`、`failed=0`、`overdue=0`，兩市場各 130／130；已原子發布 snapshot `bcbf9e24-07a4-44c7-ad64-42214f16d5fc`。
- 發布快照母體為 1,974 檔（TWSE 1,084、TPEx 890），`effectiveSessionDate=2026-09-02`、technical through `2026-09-02`，formula 為 `after-market-v4-ma-divergence-multichart-ecae7ca-v1`，mapping 為 `official-daily-ohlcv-v2`。
- 代表案例包含上市／上櫃、新商品 8103、非原排行代表 2926、停牌／來源缺值、以及 2237、6236、7855 的 `insufficient_history`；pass／fail／unknown 均由全市場集合驗證，不以單一 fixture 代替。

## 獨立重算與 API 對帳

- `node scripts/verify-stock-screener-v4.mjs --database=...` 從 252,203 列 canonical OHLCV 獨立重算 1,974 檔、核對 1,974 個 evidence hash，再逐頁比對 API pass／fail／unknown 集合，結果 `state=verified`。
- 六種均線模式 live pass／unknown：多頭準備 17／3、黃金交叉 13／3、空頭準備 45／3、死亡交叉 51／3、任一多頭 30／3、任一空頭 96／3。
- 背離 live pass（底／頂）：OBV 79／57、RSI5 146／83、RSI10 133／44、KD-K 153／104、MACD line 137／19、MACD histogram 38／79；MACD histogram 啟用零軸重置後為 14／10。
- API 的均線任一多頭＋OBV 底背離 `AND` 為 4 檔，`OR` 為 105 檔；所有結果頁、計數與穩定排序皆與獨立重算集合一致。
- `maMode=not-a-mode` 實際回 `400 invalid_query`；v4 尚未發布時實際回 `v4_preparation_pending`、`rows=[]` 並顯示 durable progress，沒有沿用 v3 rows。

## 本機實際 UI／DOM／canvas 驗收

- 在完整交易終端 `?layout=stock-screener` 逐項操作六種均線模式、六種背離來源、兩方向、MACD histogram zero-reset、AND／OR、排序、三頁分頁、unknown 與 inline validation；live counts 與上節獨立 verifier 一致。
- `maxSpreadPct=5.1` 時「開始篩選」停用並顯示合法範圍 `0.1–5.0%`；unknown 頁實際只列 2237、6236、7855，均顯示「上市日數或有效歷史不足」。
- MACD histogram 底背離＋零軸重置實際列 14 檔；展開 1210 證據可見 A／B pivot、各自確認日、價位、指標與「零軸重置：符合」，未用文字結論取代證據。
- 點選均線結果 4938 與背離結果 1593 後，指定圖表均一次切換至 `1D`、商品標題正確，日 K 日期與 OHLCV 可見；新增 `dailySelectionGeneration` 防止既有 5m 圖沿用分鐘週期。chart-local latest-wins／Snapshot race 另由 focused tests 覆蓋。
- 1024×600 CSS px 實測 document 高度 600、垂直外溢 0；選股 pane 高 425、內容以 pane 內捲動，canvas 最大底緣 592.5。320×550、root font 24px 的最小寬度／特大字級鍵盤情境由 browser test 實際掛載驗證。
- 「加入清單」按鈕實測 hover 後文字、邊框與背景均轉為 highlight；以鍵盤 Enter 明確加入 2926 後顯示「已加入」，本機 server 再讀確認「選股」清單包含 2926。單純點選 1593 只更換圖表，清單沒有 1593。
- 本輪 browser console `warn`／`error` 均為空，頁面無載入失敗；未觸發下單、智慧下單或交易操作。

## 自動化回歸（最終）

- `pnpm test`：174 個 test files、2,090 tests 全數通過。
- `pnpm test:multiview`：714 tests 全數通過，且 MultiView build 成功。
- `pnpm test:browser`：7 個 test files、86 tests 全數通過；包含 320px 寬、24px 字級、內部捲動、hover／focus、pending／stale、watchlist 與 chart side-effect。
- `pnpm exec tsc --noEmit --pretty false`、`pnpm typecheck:multiview`、`pnpm lint:multiview`：通過。
- `pnpm build`：root production build 通過；僅有既有 chunk-size warning。
- `openspec validate --all --strict` 與 `git diff --check`：通過。

## 無副作用與完成邊界

- v4 GET route tests 證明不呼叫 provider、DDL、背景 dispatch、Shioaji 或交易；新條件未 ready 時 rows 固定為空。
- 實際資料準備與 UI 驗收期間未啟停 simulation API、business-session watchdog、5173、5174、盤後 pipeline 或行情連線。
- Cloudflare 正式站與遠端 D1 不在本 change 的本機實作／驗收範圍內；本 change 不以 Cloudflare 驗收作為完成條件。
- 工作樹含其他已存在且未提交的 archive／deferred changes；本 change 未執行廣泛 stage、commit、push、部署或清理。
