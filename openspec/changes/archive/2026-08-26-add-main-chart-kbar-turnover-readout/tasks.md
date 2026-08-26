## 1. 精確成交值domain與格式

- [x] 1.1 建立Shioaji `Amount／amount／total_amount`嚴格parser與`turnoverTwd` availability contract；只接受非負safe integer，缺漏、非法或溢位一律unavailable，禁止由OHLCV估算
- [x] 1.2 建立萬元formatter與readout field contract：可見文字使用`值 …萬`、tooltip／accessible name使用`成交值 …萬元`，涵蓋一般值、小額、零值、不可用與千分位

## 2. 歷史、聚合與形成中production資料流

- [x] 2.1 將合法`KBars.Amount`接入主交易畫面canonical candle，讓1／5／15／60分與日K完整加總；歷史prepend、same-bucket replacement與live tail reattach必須保持OHLCV／量／值同source及generation
- [x] 2.2 將STK累計cursor擴充為共用identity／交易日／source time／sequence邊界的volume與turnover lifecycle；驗證bootstrap delta、`amount／total_amount`一致性、重放、倒退、跨session、舊generation及成交值單獨unavailable
- [x] 2.3 將成交值接入主交易畫面指定日期1分K的response驗證、不可變snapshot及atomic commit；Amount缺漏時保留合法OHLCV並顯示`值 —`，返回一般時框後不得污染cache或forming cursor

## 3. 主交易畫面readout垂直切片

- [x] 3.1 在K棒價量readout的「量」後接入`值`，台股整股顯示`量 <張數>張　值 <萬元>萬`；selected history、latest fallback與forming candle都必須使用同一canonical candle
- [x] 3.2 完成窄版、字級放大、鍵盤、tooltip及accessible name行為；單一量／值欄位不得拆開、裁切、重疊或新增assertive live region
- [x] 3.3 加入production residual guard，證明本change沒有建立left price scale、turnover series／axis／設定、額外API request，也沒有修改MultiView、gateway／Worker、cache fingerprint、技術指標、交易或智慧單資料流

## 4. 驗收與收尾

- [x] 4.1 完成parser／formatter／aggregation／cursor／history paging／target-date的focused tests、跨模組integration tests與重放／倒退／generation fault injection
- [x] 4.2 在`127.0.0.1:5173`完成實際browser-visible驗收：歷史與形成中1／5／15／60分及日K、指定日期1分K、`量 910張　值 9,355萬`、`成交值 9,355萬元`、不可用狀態及窄版換行均符合規格
- [x] 4.3 執行TypeScript、production build、OpenSpec strict、`git diff --check`與一次獨立P0／P1 closure；P0／P1全關閉後更新tasks／evidence，且不得commit、push、部署、啟停服務或取得broker authority
