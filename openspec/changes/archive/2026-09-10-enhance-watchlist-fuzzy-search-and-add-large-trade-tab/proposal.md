## Why

目前自選清單新增商品主要依賴代號與有限的本機名稱資料，台股名稱缺漏時無法以股名可靠搜尋；成交明細也只有全部逐筆成交，缺少可重現、可解釋的大單篩選。這使使用者必須記住股票代號，且無法在同一面板快速聚焦高金額成交，因此需要補齊搜尋與大單觀察能力。

## What Changes

- 強化自選清單的台股搜尋，支援股名模糊比對、代號搜尋、正規化、候選排序、鍵盤操作，以及明確的載入、錯誤、離線與無結果狀態。
- 以 MultiView 既有台灣商品目錄搜尋作為優先名稱來源，並保留現有商品搜尋作為降級路徑；候選只用於顯示與選擇，實際加入自選清單前仍由既有 Shioaji contract API 驗證商品。
- 在成交明細面板新增「大單」頁籤，沿用成交明細的欄位與列格式，顯示目前符合條件的大單筆數與可理解的門檻文字。
- 重新定義透明且可測試的大單規則：單筆成交金額須達固定最低金額、5 張價值與近期成交金額分布門檻三者取高；動態樣本不足時採固定門檻暖機。
- 排除零量、盤中零股、模擬成交及開收盤集合競價時段，並以穩定鍵避免歷史回放與即時串流重複計入；同一筆成交的分類結果與偵測時門檻不可因後續成交回溯改寫。
- 「大單」只代表成交條件篩選，不推論交易者身分；依使用者要求，介面不顯示額外的身分免責句。

## Capabilities

### New Capabilities

- `watchlist-instrument-fuzzy-search`: 定義自選清單以台股股名或代號搜尋、選擇及驗證商品的行為與降級處理。
- `tick-tape-large-trade-tab`: 定義成交明細「大單」頁籤、門檻算法、成交資格、去重、生命週期與顯示行為。

### Modified Capabilities

無。

## Impact

- 前端元件：`src/components/watchlist.tsx`、`src/components/tick-tape.tsx` 及其樣式。
- 搜尋與資料存取：`src/lib/intraday-monitor-instrument-search.ts`、`src/lib/product-search.ts`、`src/lib/stock-index.ts`，可能抽出共用台灣商品搜尋 client 與候選合併／排序工具。
- 行情資料：沿用既有 history ticks 與 SSE tick，不新增 subscription、不改變交易狀態，也不執行 broker write。
- 測試：新增搜尋、候選選取、大單分類、動態門檻、去重、重設與面板互動測試；驗證一般面板與 popout 行為一致。
- 執行環境：MultiView 搜尋服務不可用時須安全降級；production 與真實下單不在本 change 範圍。
