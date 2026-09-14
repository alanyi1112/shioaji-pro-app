## 1. 建立專用版面啟動政策

- [x] 1.1 建立 `layout=stock-screener` 的 metadata-only watchlist 啟動政策，並確認一般 workspace 的完整 hydrate／subscribe 基線。
- [x] 1.2 補上政策單元測試，涵蓋 stock screener、盤中選股、一般及未知 layout。

## 2. 解除選股版面啟動阻塞

- [x] 2.1 讓 `useWatchlist` 支援預設相容的 `hydrateActiveList`／`subscribeQuotes` 選項，metadata-only 模式不得解析或訂閱作用中清單商品。
- [x] 2.2 在 `TradingApp` 將 stock screener 套用 metadata-only 模式，並讓 grid 不等待 `initialLoading` 即呈現。
- [x] 2.3 補上 pending watchlist 與無額外 `/api/v1/stream/subscribe` 的回歸測試，確認點選結果仍能載入單一圖表商品。

## 3. 驗證與交付

- [x] 3.1 執行受影響單元、browser 測試與 build，修正所有回歸。
- [x] 3.2 從實際 Chrome 的「版面 → 選股篩選」開啟新頁，核對 URL、載入完成、左右面板、console 與來源頁不變。
- [x] 3.3 執行 OpenSpec strict validation 與 `git diff --check`，記錄未改動 production、broker write、runtime 與 160 檔驗證邏輯。

## 4. 修復盤中選股相同啟動阻塞

- [x] 4.1 將現場證據推翻的 intraday 舊政策改為專用 workspace 共用 metadata-only、不阻塞且不訂閱作用中清單行情；一般 workspace 維持完整模式。
- [x] 4.2 更新政策與 browser 回歸測試，涵蓋 stock screener、盤中選股、一般 workspace、metadata-only 零合約解析／零行情訂閱。
- [x] 4.3 執行 focused、完整測試、build、OpenSpec strict、`git diff --check` 與實際 Chrome 驗收，確認盤中監控／SSE／160 檔邏輯未被更動。
