## Why

目前商品到達漲停或跌停時，主要報價與自選清單仍以一般深色背景搭配方向文字呈現，使用者必須再讀取百分比或小型狀態標籤才能判斷，辨識不夠直接。應讓承載「最新價＋漲跌資訊」的即時報價區塊在目前價格位於漲跌停時使用持續反白，建立與台股看盤習慣一致的高辨識狀態。

## What Changes

- 以 `ContractInfo.limit_up`、`ContractInfo.limit_down` 與目前顯示的最新價判定當下漲停、跌停或非漲跌停狀態，不以接近 `+10%`／`-10%` 的漲跌幅推測。
- 在主 QuoteBoard 的最新價、漲跌與漲跌幅區塊套用漲跌停實心背景與高對比文字；色塊已足以表達視覺狀態，因此不再顯示「漲停／跌停」徽章文字，但保留可存取文字語意。
- 在自選清單、排行榜、類股熱力圖、托盤迷你自選／排行、個股期／權證／選擇權報價表與持倉現價等「目前報價」欄位套用相同狀態語意，不反白商品代碼、名稱、走勢縮圖或整列容器。
- 排行榜、熱力圖或其他非自選面板被點擊時，將該列已有的 snapshot 一起交給全域選取；若來源沒有 snapshot，則以目前選取 generation 受控地補抓一次，讓 K 線 QuoteBoard 立即顯示所選商品當時報價，且舊商品資料不得回寫。
- 價格離開漲跌停後立即移除持續反白；缺少有效上下限價、最新價無效或商品為指數時維持一般樣式。
- 沿用目前 theme 的 `up`／`down` token；預設台股配色為漲停紅底、跌停綠底，使用者主動選擇國際配色時保留其既有慣例。
- 保持選取、hover、成交 flash、拖放、容器響應與字體倍率等既有互動及版面契約。
- 五檔價位、逐筆成交、歷史 K 棒讀值、行情摘要的開高低等獨立價位、下單價格、損益與市場訊號事件不納入本次持續反白範圍。

## Capabilities

### New Capabilities

- `limit-state-quote-highlighting`: 定義可靠的漲跌停狀態判定、主要即時報價區塊的持續反白範圍、theme 配色與互動／響應式相容要求。

### Modified Capabilities

無。

## Impact

- 主要影響 `src/App.tsx`、`src/components/quote-board.tsx`、`src/components/watchlist.tsx`、`src/components/scanner-panel.tsx`、`src/components/sector-heatmap.tsx`、`src/components/tray-panel.tsx`、衍生品報價表與持倉現價及其樣式檔。
- 預期新增共用的漲跌停狀態判定 primitive 與單元測試，避免不同報價元件各自推測或產生不一致結果。
- 不變更 Shioaji API、行情資料來源、交易流程、下單模式或 runtime；不新增外部依賴。
