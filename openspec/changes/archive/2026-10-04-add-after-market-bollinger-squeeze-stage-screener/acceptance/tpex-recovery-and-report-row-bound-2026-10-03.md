# 2026-10-03 TPEx 日期入口恢復與原始日報列數修正

時間使用 Asia/Taipei；以下 UTC 時間另標台北時間。本輪是人工有界唯讀探測及程式回歸，不是 watcher 自動 run、正式 source review、160 日完整性或發布驗收。先前 ECONNRESET、瀏覽器查詢錯誤與 failed／partial 紀錄原樣保留；恢復只表示本次指定日期請求成功。

## 真實來源探測：兩次請求，無重試

使用既有 `createBollingerSourceFetcher`，每市場一次公開 GET，系統 TLS 憑證驗證維持開啟；TPEx 使用既有 TLS1.2 設定。未跟轉址、使用代理或建立 broker 連線，完整 body 未匯入產品資料庫。

### TPEx：10/2 指定日期日報

- 取得時間：`2026-10-03T09:06:27.614Z`（17:06:27）。
- URL：`https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=2026%2F10%2F02&id=&response=json`。
- HTTP 200、`stat=ok`、`date=20261002`；1,796,554 bytes。
- payload SHA-256：`1694fade3a2f98a433376b7a0410e5114aed2a4bf891bbc1036b142ba89888c1`。
- 兩個代碼表：`上櫃股票行情` 11,928 列、`管理股票` 0 列。第一表包含非普通股，11,928 不是策略母體筆數。
- 19 欄：代號、名稱、收盤、漲跌、開盤、最高、最低、均價、成交股數、成交金額(元)、成交筆數、最後買價、最後買量(張數)、最後賣價、最後賣量(張數)、發行股數、次日參考價、次日漲停價、次日跌停價（後三欄原標題含空白）。
- 6488 環球晶：開 1,090、最高 1,190、最低 1,075、收 1,190；成交股數 16,255,922、實際成交金額 18,622,066,280 元、成交筆數 30,486。
- 已確認此入口不再只得到零 bytes／連線重設；尚未核對整份資料的代碼唯一性、逐普通股 readiness 或 160 個指定日期，因此不能稱為完整契約或全窗口 ready。

### TWSE：同一資料日

- 取得時間：`2026-10-03T09:06:27.804Z`（17:06:27）。
- URL：`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=20261002&type=ALLBUT0999&response=json`。
- HTTP 200、`stat=OK`、`date=20261002`；247,435 bytes。
- payload SHA-256：`cecf0d4e4ad34cf1c6068177ba5219afe88ec685e1c236f81ca5f56ea5d7a6ab`，與先前探測一致。
- 每日收盤行情表 1,380 列；2449 京元電子開 295.50、最高 298、最低 292、收 295.50，成交股數 13,902,351、實際成交金額 4,107,551,351 元。

## 程式修正

原 `parseBollingerOfficialReport` 將原始日報與普通股母體都限制為 10,000 列。TPEx 真實日報已超過該值，即使連線恢復，也會被 `invalid_report_universe` 拒絕。

- 新增原始日報獨立的 `MAX_BOLLINGER_REPORT_ROWS=20_000`；在轉換逐列資料前合計兩張表並拒絕超限，避免先建立過大的 points。
- 保留原 8 MiB 回應上限、日期／欄位契約、代碼唯一性與普通股母體 10,000 檔上限；不截斷前一萬列、不去重、不依代碼猜普通股、不把權證混入策略母體。
- source receipt 的原始列數與投影列數仍分開記錄；manifest rowCount 仍是已驗證普通股投影筆數，不放寬 UI／manifest 母體上限。
- 新增三項隔離回歸：11,928 列日報持久化並只投影普通股；兩表合計達 20,000 可解析／20,001 拒絕；超過一萬列仍拒絕跨表重複代碼。fixture 只測契約，不冒充官方完整 payload。

## 尚待確認的來源使用範圍

本輪重新讀取第一方文件，不以第三方爬蟲範例作授權依據：

- [TWSE 網站使用條款](https://www.twse.com.tw/zh/terms/use.html)第 6、8 項：自動下載須採同意方式，政府資料開放平臺已授權資料另有例外。
- [TPEx 網站使用條款](https://www.tpex.org.tw/zh-tw/gtsm_disclaimer.html?l=zh-tw)第 5、7 項有相同的自動下載方式及開放資料例外邊界。
- [上市個股日成交資訊 11549](https://data.gov.tw/dataset/11549)、[上櫃股票行情 11370](https://data.gov.tw/dataset/11370)都列政府資料開放授權條款第 1 版、免費及每日更新，但資源連結／OAS 是開放資料 CSV／OpenAPI，不是本次使用的兩個指定日期 JSON URL。

這些文件不足以確認指定日期歷史入口的自動擷取方式已受同一例外涵蓋；也不代表所有本機個人使用一律禁止。本輪維持 review pending，沒有寫入 verified 假紀錄、啟用每日 profile 或啟動 320 個市場／日期下載。需要涵蓋實際採用歷史入口的適用依據，或另行選擇有明確契約的來源，才能正式通過 task 1.1。Shioaji 契約及預算仍獨立，不因 TPEx 恢復而略過 8.1／8.4／8.8。

## 真實本機狀態與畫面

- 17:13:50 唯讀 DB：`screener-period-evidence` verified、243 sessions、3 source hashes，validThrough `2026-10-05T06:00:00.000Z`；未為本策略改寫日曆或日期。
- 17:15:56 唯讀核對唯一 DB：0035／0036 表存在；0037–0039 表不存在。每日 profiles、publications、batches、daily 均為 0；尚未啟用或發布。
- 17:14:36 實際隔離 Chromium 頁面：daily profile=null；結果 HTTP 200、`pending/v8_preparation_pending`、0 列；顯示「等待完整資料／尚未發布布林三階段報告」。5 次 GET、0 非 GET、0 被阻擋 request、console error／page error 都為空；未發 broker／SSE 請求。
- 畫面 pending 驗證不是正式報告、指定圖表與兩套清單操作的 task 7.4 驗收。

## 回歸與限制

- Node 24.19.0：10 個 focused files **132／132** 通過；其中原始日報準備器 19／19，新增 3 項。
- Vitest 8 files **78／78** 通過；型別檢查與 build 通過，原 bundle >500 kB 提示保留。
- 首次新測試有一項誤讀 batch wrapper（應為 `report.points`）；修正測試斷言後重跑 132／132，沒有放寬產品 Gate。
- 首次面板測試使用一般 Vitest pool，兩個 suite 在收集階段因 Browser Mode 未啟用而失敗；不是產品測試通過，後續以 `vitest.browser.config.ts` 重跑另記結果。
- 17:17:42 使用 `pnpm exec vitest run --config vitest.browser.config.ts` 正確重跑兩個 Chromium 面板檔案，**32／32** 通過；連同 Node／純函式測試，本輪合計 **242 項**不重複測試通過。這些面板 fixture 不算正式發布驗收。
- 此 change 的 OpenSpec strict validation、tracked `git diff --check`，以及本輪 7 份新增／修改文字檔的 whitespace／terminal newline 檢查通過；未宣稱整份 repo 所有 untracked 檔都無空白問題。

task 仍為 **34／41**。本輪解除指定日期傳輸與原始列數阻礙，但尚缺正式來源 review、備援預算與契約、160 日真實逐商品覆蓋、watcher 自動發布及正式結果端到端；不具備歸檔條件。沒有 production、交易、額外 login／subscription、服務重啟、收據覆寫、archive、commit 或 push。
