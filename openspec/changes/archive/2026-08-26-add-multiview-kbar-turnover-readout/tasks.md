## 1. 精確成交值資料契約

- [x] 1.1 建立 `turnoverTwd` strict parser、萬元 formatter 與 canonical candle／chart payload schema revision；完成零值、小額、千分位、缺漏、負值、小數元、非有限值、指數字串、overflow及舊schema拒絕的 focused tests。
- [x] 1.2 將同列 Shioaji `KBars.Amount` 接入本機 simulation coordinator與page-scoped range cache，依source identity及schema revision輪替舊entry；完成同商品多panel single-flight、缺欄／長度不符、歷史prepend及safe-integer fault injection。
- [x] 1.3 將1分K的精確成交值接入5／15／60分與日K聚合；只有bucket內實際candle全部可用且加總不溢位時產生總值，並完成跨日、partial bucket、資料缺口及完整重算一致性測試。

## 2. Forming K與generation安全

- [x] 2.1 升版本機SSE snapshot validator，將Shioaji Tick `amount／total_amount`接到與volume共用identity、台北交易日、source time、sequence、connection及generation的獨立turnover cursor；完成累計差額、合法fallback與sequence-gap路徑。
- [x] 2.2 完成forming turnover的重送、倒序、矛盾、累計倒退、zero-volume、simtrade、舊session／connection／generation及UI重複觀察fault injection，證明成交值fail unavailable時合法price／volume仍持續且不自動重試或輪詢猜補。
- [x] 2.3 完成bootstrap尾端與forming 1分K合併，再由同一canonical尾端重聚合目前5／15／60分及日K；以integration tests驗證同分鐘、新分鐘、跨日與高頻snapshot皆不重複計量。

## 3. MultiView readout垂直接線

- [x] 3.1 在fixed／floating K棒readout的「量」後接入同一canonical candle的`值`欄位，實作crosshair、latest fallback、forming與unavailable狀態；可見文字使用`值 …萬`，tooltip／accessible name使用`成交值 …萬元`。
- [x] 3.2 將turnover納入既有per-panel latest-wins與DOM signature gate，完成1／2／4／8 panel、字級放大與窄版欄位邊界換行測試；證明高頻crosshair不重建chart、overlay、技術副圖或籌碼readout。
- [x] 3.3 將成交值接入完整panel PNG匯出，並以production residual tests證明未新增turnover axis、series、price scale、指標、設定checkbox、Cloudflare／D1 payload或任何交易路徑。

## 4. 指定日期1分K與文件

- [x] 4.1 將`Amount` validation與`turnoverTwd` availability納入MultiView單圖target-date不可變response、staged projection及atomic commit；完成快速換商品／日期／interval／generation時整份舊snapshot丟棄的integration tests。
- [x] 4.2 完成指定日期Amount完整、缺漏但OHLCV合法、不得跨日期／realtime補值及返回一般日K重新依provider載入的測試，證明單日simulation Amount不污染Yahoo、Cloudflare或D1資料。
- [x] 4.3 更新README、`apps/multiview/docs/local-runtime.md`與OpenSpec evidence，清楚區分本機simulation Shioaji精確來源、其他provider的`值 —`及不含production／CA／broker authority／遠端migration的邊界。

## 5. 可見驗收與closure

- [x] 5.1 在既有`127.0.0.1:5174`實際頁面完成歷史、forming、crosshair／latest、1／5／15／60分、日K、指定日期、1／2／4／8 panel、窄版、字級放大、accessible name及完整panel PNG的browser-visible驗收；只使用simulation market-data且不啟停服務、不送broker write。
- [x] 5.2 執行相關focused tests、integration tests、fault injection、TypeScript、lint與MultiView production build，記錄指令、結果與source fingerprint；不得以fixture或估算值冒充正式Shioaji可見證據。
- [x] 5.3 完成一次獨立P0／P1 closure、OpenSpec strict validation與`git diff --check`；確認沒有新P0／P1且所有completion contract通過後，才勾選全部任務並更新正式evidence。
