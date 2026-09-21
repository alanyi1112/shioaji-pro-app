## 1. 建立來源完整性契約

- [x] 1.1 以 fixture 鎖定 Shioaji end-labelled 1 分 K 的 canonical 時間、原始 `sourceTime` 與 5／15／60 分 bucket 邊界
- [x] 1.2 為台股 Yahoo/canonical 分鐘 payload 加入交易時段邊界、涵蓋起訖與 partial reason code，不補造缺少的 OHLCV
- [x] 1.3 核對日 K 官方交易日 continuity，以及週／月由同一 daily base 聚合的 coverage 與尚未完成期間語意

## 2. 修正來源與切換流程

- [x] 2.1 正規化 Shioaji Kbars 分鐘時間並提升快取時間語意 revision，避免沿用舊時間標籤資料
- [x] 2.2 讓 `自動`、`Shioaji 即時`、`Yahoo 延遲`傳遞實際來源與 continuity；自動模式僅原子採用通過完整性契約的 Shioaji candle set
- [x] 2.3 新增可重跑的來源／週期完整性檢查，區分來源缺列、合法無成交、休市／停牌／上市前、聚合錯位與前端漏畫

## 3. 實際資料與介面驗收

- [x] 3.1 使用 `.TW`、`.TWO`、ETF與普通股實際資料，逐一核對三種來源模式及 1m／5m／15m／60m／日／週／月的 row、起訖與 continuity
- [x] 3.2 在真實 5174 頁面切換來源與週期，確認 K 棒不消失、不混接、不重複，狀態與 console 正確
- [x] 3.3 執行相關單元測試、型別檢查、建置、OpenSpec strict validation與 `git diff --check`，並確認 8080、5173、5174、watchdog及行情連線持續運作
