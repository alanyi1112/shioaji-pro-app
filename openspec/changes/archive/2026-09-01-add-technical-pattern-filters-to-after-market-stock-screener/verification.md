# 驗證紀錄

## 2026-09-02 實作前基線

### 前置 v2 終態

- exact Git commit：`a63a342a1088e91183967b1e6577e2d57eaf51ac`（`feat(multiview): complete after-market stock screener v2`）。
- 前置 change 已歸檔於 `openspec/changes/archive/2026-09-01-extend-after-market-stock-screener-with-turnover-and-holder-reversal/`；41/41 tasks 完成，驗證紀錄未由本 change 改寫。
- 本機 D1：schema revision `0028`，`PRAGMA integrity_check=ok`。
- 最新 v2 snapshot：`90d3af39-ce96-4b8a-8f98-d6c1271f5ca9`，schema v2、metadata total 1,975、snapshot rows 1,975。
- 全市場母體：TWSE 1,085、TPEx 890；universe revision `b96e477b1d5aa1335e4c604382edd9c833bf887e745ccb01defa39f47edfe6d3`。
- 日底稿：`screener_daily_volume` 3,938 rows／1,969 symbols，日期 2026-08-31 至 2026-09-01。
- 週底稿：`screener_tdcc_weekly` 11,840 rows／1,975 symbols，日期 2026-07-24 至 2026-08-28。
- 六期 progress：target 11,843、processed 11,843、remaining 0、failed 0、overdue 0、cursor `null`。

### v3 additive 起點與隔離邊界

- `screener_daily_ohlcv` 尚不存在；本 change 必須用 additive migration 建立，不覆寫 v2 tables 或 snapshot。
- 既有 `candle_history` 為 57,063 rows／92 symbols，日期涵蓋 2001-08-10 至 2026-09-01；它是局部圖表快取，未涵蓋 1,975 檔母體，不得作為全市場選股 OHLC。
- 5173／5174 分別維持既有 PID 935／940，實作基線未啟停 simulation API、watchdog、pipeline、行情連線或任何交易服務。
- 實作前 dirty tree 中既有未提交內容包含 candle continuity、PE／TDCC 籌碼、smart-order tests、`exports/` 與產生物；本 change 保留並避開這些檔案，除非後續有可證明且必要的重疊 hunk。

## 2026-09-02 官方 OHLC source review

- 完整核對見 `source-review.md`；正式來源為 TWSE `STOCK_DAY_ALL`／`MI_INDEX` 與 TPEx `tpex_mainboard_daily_close_quotes`／`dailyQuotes`。
- TWSE 2026-08-31：普通股 latest/history 出現交集 1,081 檔；合法 OHLC 1,080 檔逐檔 0 差異，另有 4 檔缺列、1 檔四價空白。
- TPEx 2026-09-01：普通股 latest/history 出現交集 888 檔；合法 OHLC 865 檔逐檔 0 差異，另有 2 檔缺列、23 檔四價 `---`。
- 非交易日 2026-08-30：TWSE 回無資料，TPEx 回正確日期但兩張空表；兩者都不形成 collected receipt。
- 兩市場共同已發布錨點以較舊 latest date 2026-08-31 為準；官方 60-session baseline 為 2026-06-08 至 2026-08-31。
- `candle_history` 只有 92 symbols，且 `screener_daily_ohlcv` 尚不存在；因此 full-market OHLC coverage 為 0／1,975，v3 必須保持 bootstrap pending。
- 新上市代表：7855 和運租車（2026-08-11）、7814 海昌生技（2026-07-16）；無合法 OHLC 代表：1538 正峰、2073 雄順。

## 2026-09-02 v3 契約與技術純函式

- 新增 `src/lib/stock-screener-technical-patterns.ts`：v3 criteria／formula／row／metadata／API／cursor／preference／progress／unknown reason schema，canonical 十進位 OHLC、原始三 K、纏論包含關係、BOLL 首次穿越、三態組合、fingerprint、evidence SHA-256 與穩定排序。
- BOLL 直接共用 `src/lib/indicators.ts` 的 `bollinger(..., 20, 2)` 與 `REFERENCE_FORMULA_VERSION`，沒有複製另一套近似公式。
- `npx vitest run src/lib/stock-screener-technical-patterns.test.ts src/lib/indicators.reference.test.ts`：2 files、21 tests passed。
- `npx tsc --noEmit --project tsconfig.app.json --pretty false`：passed。

## 2026-09-02 60-session bootstrap 純邏輯與 operator 接線

- 新增 `scripts/stock-screener-ohlcv-bootstrap.mjs`：60 個 official common sessions、120 個 `market + session` targets、expected symbol-set hash、逐期 receipt／progress、較新完整列 upsert、重試、冷卻、checkpoint 與 retention。
- 新商品只讓上市日以後同市場 target 的 expected hash 改變；不在自選清單也屬全市場 universe，不會產生逐商品外部請求。
- `stock-screener-update.mjs` 在既有 18:00 gate、共用 operator lease 與 v2 工作之後呼叫 `prepareScreenerOhlcv`；CLI 新增有界 `--ohlcv-limit=1..120`。UI／GET、5173／5174 啟停、Shioaji、Yahoo、TDCC 長歷史與交易路徑不會呼叫它。
- `node --test apps/multiview/tests/stock-screener-ohlcv-bootstrap.test.mjs apps/multiview/tests/stock-screener-operator.test.mjs`：修正臨時休市及中斷 checkpoint 後 18 tests passed。
- 測試涵蓋 calendar 截止、120-target 守恆、新上市、完整兩段續跑、ignored date、schema drift、429、403/CAPTCHA、lease lost、舊/稀疏列、60 日＋兩版 v3 anchors retention，以及不改日量、個人 tab、`candle_history`。
- `npm exec tsc -- --noEmit --project tsconfig.screener.json --pretty false`（`apps/multiview`）：passed；focused `git diff --check`：passed。
- task 4.8 尚未完成：live D1 已安全套用 schema 0029，但 120-target full bootstrap 仍在 checkpoint 續跑，未達正式終態前不發布 v3。
- `git diff --check -- src/lib/stock-screener-technical-patterns.ts src/lib/stock-screener-technical-patterns.test.ts`：passed。
- root `npm test`：169 files、2,045 tests passed；`npm run test:multiview`：build passed、676 tests passed。
- `npm run build`、`npm run lint:multiview`、`npm run typecheck:multiview`、root `tsconfig.app.json` typecheck、`openspec validate --all --strict`（31/31）與 `git diff --check`：passed。

## 2026-09-02 OHLC adapters 與 migration 0029

- latest adapters 使用 TWSE `OpeningPrice/HighestPrice/LowestPrice/ClosingPrice` 與 TPEx `Open/High/Low/Close`；history adapters 依完整中文欄名 index，強制 requested/actual date、table schema 與 ordinary-universe 交集。
- live raw payload 經正式 adapter 重跑：TWSE 2026-08-31 有效 1,080、invalid 1、missing 4；TPEx 2026-09-01 有效 865、invalid 23、missing 2；兩市場 latest/history 合法交集均為 0 差異。mapping 與 hashes 與 `source-review.md` 一致。
- Drizzle migration：`0029_plain_strong_guy.sql`，新增 `screener_daily_ohlcv`、`market+date`／`symbol+date` indexes 與 snapshot schema/status index；`scripts/multiview-state` target revision 更新為 0029，且已在備份後的 live D1 套用。
- `node --test apps/multiview/tests/stock-screener-ohlcv.test.mjs apps/multiview/tests/stock-screener-sources.test.mjs`：9 tests passed，涵蓋 staging、migration ledger 重跑、transaction rollback、個人資料 hash、舊 v2 snapshot、sparse/older update 保護與兩市場 parser。
- `npm exec tsc -- --noEmit --project tsconfig.screener.json --pretty false`（`apps/multiview`）：passed。
- `npx tsc --noEmit --project tsconfig.app.json --pretty false`：passed。

## 2026-09-02 v3 snapshot、API 與面板

- 新增 `stock-screener-v3-repository.ts`／`stock-screener-v3-publisher.ts`：只有 120 個 `market + session` receipt 全部 collected 且 symbol-set hash、row 數、universe revision 守恆時，才在 staging 計算原始三 K、纏論、BOLL 與逐分支 evidence hash，最後以 CAS 原子發布；v2／v3 各自保留兩版。
- 新增 v3 GET allowlist、criteria fingerprint、snapshot-bound cursor、四分支三態 AND／OR、9 種排序與 evidence response；GET 測試前後 `total_changes()` 相同，沒有 provider、Yahoo、Shioaji、DDL、回補或交易呼叫。
- 選股面板使用 `sj-pro-stock-screener-v3`；合法 v2 偏好只遷移一次，分型與布林條件預設關閉。新增「K 棒分型」及「布林通道反轉 K」條件卡、preparation progress、缺漏摘要、日期 mapping、P／D OHLC／bands 與影線證據。
- `node --test ...stock-screener-v3-publisher.test.mjs ...stock-screener-route.test.mjs`：14 tests passed；另補 v3 live-like API fixture 後 focused v3 publisher 為 5 tests passed。
- `npm run test:browser -- src/components/stock-screener-panel.browser.test.ts`：Chromium 7 tests passed；涵蓋窄於 600 CSS px、24 px root font、鍵盤 focus、stale generation、localStorage 失敗、v1／v2 遷移、技術證據及指定圖表 click。
- `npm run lint:multiview`、`npm run typecheck:multiview` 與 root `tsconfig.app.json` typecheck：passed。

## 2026-09-02 本機 D1 分段 full bootstrap（完成）

- migration 前自動備份：`/Users/alanyi/Library/Application Support/RealTimeStock/MultiView/backups/multiview-20260901T163050Z.sqlite`；migration 0029 的 5 個命令皆成功，未停止 5173、5174、simulation API、watchdog、pipeline 或行情連線。
- 第一段先保存 13 個 receipt、12,757 筆合法 OHLC／7 日期／2 市場；TPEx 2026-08-27 曾遇 HTTP 520，沒有把無 body 的 transport failure 寫成合法資料。
- 2026-09-02 00:48（Asia/Taipei）只讀重查 TPEx 2026-08-27：HTTP 200、payload 1,606,707 bytes、actual date `20260827`、`stat=ok`、2 tables；續跑後該 target collected，valid 868、invalid 19、missing 3。
- 第二段以 `scripts/stock-screener-ohlcv-resume.mjs` 從 checkpoint 續跑；暫時性 HTTP 520 發生時所有成功 receipt 與 aggregate progress 都保留。經 8 分鐘零請求冷卻後，改以單線 10 秒間隔完成最後 26 個 target；沒有使用併發、替代入口或瀏覽器回應灌入 D1。
- transport 中斷時原實作只保留 per-target receipt、未更新 aggregate progress；已補成中斷前持久化 `target/processed/remaining/failed/overdue/cursor`，並新增 429／403／520 fail-closed fixture。focused bootstrap＋publisher：11 tests passed。
- 2026-07-10 在 planned calendar 內但兩市場正式報表共同證明無交易，且 TWSE 官方重大訊息確認受巴威颱風影響為非營業日。planner 已改為只有精確雙市場 no-trade receipt 才排除臨時休市並前補第 60 日；一側空值、schema/date drift 或 transport failure 仍 fail closed。修正後 progress 由 92/120 續跑至 94/120；TWSE／TPEx 各 47/60，remaining 26、failed 0、overdue 0、cursor `TPEx|2026-06-25`。
- 中途 HTTP 520 已明確保存為 `interruption=source_http_520`，沒有寫成 collected 或清除先前 receipt。完成前 5174 `status?version=3` 正確回 `v3_preparation_pending`；完成後進度為 target／processed 120／120，TWSE／TPEx 各 60／60，remaining／failed／overdue 皆 0、cursor `null`。
- 完整 root suite 為 169 files／2,045 tests passed；完整 MultiView build＋suite 為 676/676 tests passed。root build、MultiView lint、兩套 typecheck、31/31 strict OpenSpec validation 與 `git diff --check` 均通過。

## 2026-09-02 live D1 與 v3 原子發布

- `PRAGMA integrity_check=ok`；`screener_daily_ohlcv` schema、unique key 及 market/date、symbol/date indexes 均存在。120 個 current receipts 都是唯一 collected，逐筆 `valid + invalid + missing = universeEligible`，expected／payload hash 格式合法。
- 60 日正式 session 為 2026-06-08 至 2026-09-01，排除 2026-07-10 臨時休市。D1 保存 116,886 筆 `canonical-complete-v1` OHLC，全部為 TWD／`official-unadjusted-after-market-twd`／`official-daily-ohlcv-v1`；其中 TWSE 64,664 rows／1,084 symbols，TPEx 52,222 rows／889 symbols。
- 新上市 7814 海昌生技從正式上櫃日 2026-07-16 起有 34 筆；7855 和運租車從正式上市日 2026-08-11 起有 16 筆；兩者上市前 row 都是 0。個股合法無四價仍保存 row-level unknown，不造 K 棒。
- receipt gate 通過後原子發布 v3 snapshot `273e72b9-dc65-4320-8753-1d1520a61179`；metadata total／snapshot rows 都是 1,975，所有 1,975 筆 technical evidence hash 重算一致，staging snapshot 為 0。兩版 v2 snapshot 仍在，未被 v3 retention 誤刪。
- snapshot 預先統計 technical unknown reasons 為 `containment_direction_unknown` 778、`missing_ohlcv` 872、`insufficient_history` 4；同一商品可能在不同技術分支重疊，因此這不是互斥商品總數。

## 2026-09-02 live API 與實際 UI acceptance

- 5174 v3 status 為 `partial`（row-level 缺漏，不是 preparation 未完成），snapshot 與 technical through 均正確；預設成交量＋大戶條件的母體 1,975、符合 12、不符合 1,960、unknown 3，守恆成立。
- 技術條件實際結果：原始三 K 底／頂分別 482／52；纏論底／頂分別 530／317；纏論任一方向為 pass 847、fail 527、unknown 601，完整 9／6／7 頁合計 1,975 且 code 排序穩定。BOLL 下軌陽 K 下影為 2701 萬企 1 檔；上軌陰 K 上影為 1735、6153、6532 共 3 檔。
- 四條件 `all` 為 pass 0／fail 1,970／unknown 5；`any` 為 pass 1,185／fail 411／unknown 379，均守恆。invalid technical enum 回 HTTP 400／`invalid_query`。7814 的 BOLL any 為合法 fail；歷史尚不足 21 日的 7855 為 unknown／`insufficient_history`。
- API acceptance 前後 D1 digest 完全相同：runs 4,198、run checkpoint bytes 623,018、snapshots 3、snapshot rows 5,925、OHLC rows 116,886；證明 GET／分頁沒有補資料、DDL 或資料寫入副作用。
- 實際 5173 DOM 顯示兩張技術條件卡、120/120 progress、60 日錨點與全市場計數。原始三 K 底分型實際顯示 482 檔；點選不在自選清單的 1103 嘉泥後，只有指定圖表由 3711 切到 1103，另一張仍為 3711，自選清單逐列前後相同。指定圖表切至 1D 後載入完成，canvas CSS 732×256、bitmap 1464×512。
- BOLL 下軌結果 2701 的可見 evidence 為 P 2026-08-31 O/H/L/C 10.60／10.65／10.55／10.65、bands 10.738684／10.6325／10.526316；D 2026-09-01 O/H/L/C 10.40／10.45／10.30／10.45、bands 10.755855／10.6275／10.499145，下影／上影皆為是。result action 與 `<details>` 已拆成同層互動控制，展開內容出現在 accessibility tree。
- 600／768／900 CSS px 實測 panel、兩張條件卡與 evidence 都是 `scrollWidth=clientWidth`；console warn／error 為 0。Chromium 7/7 亦重跑通過。
