## 1. 共用價位方向契約

- [x] 1.1 盤點 QuoteBoard、KbarReadout 與 candlestick price line 的現有資料來源及紅綠樣式，確認不改動非價位語意色
- [x] 1.2 新增 `priceDirection` 純函式，處理 up、down、flat、缺值與無效 reference
- [x] 1.3 新增價位方向單元測試，涵蓋大於、小於、相等、NaN、Infinity、零與缺值 reference

## 2. 行情摘要資料與判色

- [x] 2.1 將非指數行情摘要改為三列 metric 結構，保持指定欄位順序及 `—` placeholder
- [x] 2.2 讓開、高、低、漲停、跌停、委買與委賣逐欄使用 reference 判色，數量、時間與 reference 保持中性
- [x] 2.3 讓指數開、高、低使用 index reference，並保留市場家數統計的 category 語意色
- [x] 2.4 讓主要最新價、漲跌與漲跌幅共用價位方向規則
- [x] 2.5 新增 QuoteBoard 結構與判色測試，涵蓋一般商品、指數、缺值及平盤

## 3. 行情摘要響應排版

- [x] 3.1 重構 QuoteBoard 為外層 query container、內層 hero 與 summary 區域
- [x] 3.2 實作寬版四欄三列、中版上下排列及窄版兩欄多列的 container query
- [x] 3.3 套用 atomic label/value、tabular numbers 與不裁切數值規則
- [x] 3.4 調整 hero 的代碼、名稱、最新價、漲跌與漲跌幅尺寸，使 0.85、1、1.15、1.3 字體倍率皆可讀

## 4. K 棒回報與最新價標籤

- [x] 4.1 擴充 KbarReadoutField 的欄位識別與原始數值，保留既有格式、順序及 accessible text
- [x] 4.2 實作目前交易日／交易時段 reference resolver，歷史或不可靠 reference 降級為 flat
- [x] 4.3 將 K 棒回報的開、高、低、收／最新套用 reference 判色，時間與量保持中性
- [x] 4.4 讓 candlestick price line 與右側最新價標籤使用 reference 方向色，但不改變 candle 與 volume series 顏色
- [x] 4.5 擴充 KbarReadout 測試，涵蓋當日、歷史、forming candle、無 reference 與跨日降級

## 5. 整合驗證

- [x] 5.1 執行相關單元／元件測試並修正 regression
- [x] 5.2 執行 TypeScript 檢查、production build 與 `git diff --check`
- [x] 5.3 在本機 simulation 驗收主視窗與 popout 的寬、中、窄容器排版及完整顯示
- [x] 5.4 以 0.85、1、1.15、1.3 字體倍率及多圖配置驗收無重疊、裁切或錯誤換行
- [x] 5.5 以具體 reference 範例驗收黃框、綠框、紅框與右側最新價標籤方向一致，且非價位語意色未被改寫

## 6. 特大字級標準看盤回歸修正

- [x] 6.1 依 1499×821 CSS viewport 與約 926px K 線面板的實際截圖條件，補充特大字級完整顯示規格與設計決策
- [x] 6.2 調整 QuoteBoard 的 hero 軌道、摘要最小欄寬、間距及字級感知 breakpoint，回收閒置空間但不縮小文字
- [x] 6.3 在本機 simulation 驗收特大字級下最新價／漲跌不重疊、四欄三列摘要不裁切，並重跑測試、build 與 `git diff --check`
