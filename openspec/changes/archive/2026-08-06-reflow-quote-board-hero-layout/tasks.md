## 1. QuoteBoard 結構

- [x] 1.1 將 `QuoteBoard` hero 改為商品代碼、最新價區塊、商品名稱、漲跌區塊四個可獨立排列的 cells
- [x] 1.2 保留既有行情資料計算、`priceDirection` 判色、漲停／跌停 badge、缺值格式與 metrics 摘要順序
- [x] 1.3 為 hero 與主要 cells 補上可供結構驗收的穩定 class／data attribute，不改變交易或行情 API

## 2. 響應式尺寸與排列

- [x] 2.1 將 hero 改為 `minmax(0, 1fr) auto` 兩欄兩列，讓代碼／名稱與最新價／漲跌上下對齊
- [x] 2.2 讓漲跌與漲跌幅同列右對齊，並以 tabular numbers、nowrap 與內容型間距處理長數字
- [x] 2.3 以既有 container query 在中窄寬度安全切換 hero／摘要上下排列、摘要多列及 hero 單欄，不得裁切或覆蓋
- [x] 2.4 調整商品名稱、最新價、漲跌、badge 與摘要共享的最小寬度、字級上限及 gap，完成 `2330` 與 `IX0001` 的視覺平衡

## 3. 驗證

- [x] 3.1 執行完整 `pnpm test`，確認既有行情摘要、判色與格式測試通過
- [x] 3.2 執行 `pnpm build`、`openspec validate reflow-quote-board-hero-layout --strict`、`openspec validate --all --strict` 與 `git diff --check`
- [x] 3.3 在本機 simulation 以 `2330` 與 `IX0001` 驗證標準版、1.3 倍特大字級、窄圖表、同 viewport 多個不同寬度圖表及 popout
- [x] 3.4 確認長價格、漲跌、漲跌幅、摘要最右欄均無重疊、裁切、省略、水平溢位或 console error，且未啟用 production／未觸發交易端點

## 4. 摘要密度與區塊間距微調

- [x] 4.1 回收寬版 `statMetric` 的內部伸展空白，讓標題與數值以小 gap 緊接，並保留窄版的分散對齊
- [x] 4.2 微調 hero／摘要的 grid 比例與固定 column gap，讓 hero 右緣與摘要第一欄之間有可辨識距離
- [x] 4.3 在使用者提供的長指數版面、1499×821、大字級與窄版重新驗證 hero、摘要最右欄及數字完整性
- [x] 4.4 重新執行 `pnpm test`、`pnpm build`、OpenSpec strict validation 與 `git diff --check`

## 5. 摘要標題與數值對齊

- [x] 5.1 將每個摘要 metric 改為標題左欄、數值右欄的 grid，維持四欄三列順序
- [x] 5.2 在 `2330`、`IX0001`、1499×821 與窄版驗證標題／數值垂直對齊、完整顯示且無溢位
- [x] 5.3 重新執行 `pnpm test`、`pnpm build`、OpenSpec strict validation 與 `git diff --check`
