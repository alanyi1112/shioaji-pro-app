# 驗證紀錄

## 自動化驗證

- `pnpm test`：228 個測試檔、2,395 個測試通過。
- `pnpm test:browser`：14 個測試檔、126 個測試通過。
- `pnpm build`：通過；僅保留既有的 chunk size 提示。
- `pnpm exec tsc -b --pretty false`：通過。

新增的 browser 回歸測試直接掛載 `useWatchlist`，確認專用選股版面只載入清單 metadata，不解析作用中清單商品、不建立 Tick／BidAsk／Quote 訂閱，也不要求 Snapshot；一般 workspace 仍維持原本的 hydrate 與 subscribe 行為。政策單元測試另確認 `stock-screener` 與 `intraday-stock-selection` 均採用相同的非阻塞政策。

## 實際介面驗證

2026-09-14 於本機 `127.0.0.1:5173` 驗證：

- 從主交易終端展開「版面」，可看到「選股篩選」入口並開啟獨立分頁。
- Chrome 目標分頁 URL 為 `http://127.0.0.1:5173/?layout=stock-screener`，來源分頁仍為 `http://127.0.0.1:5173/`。
- 同一路徑的完整 DOM 驗證可直接看到左側「選股」、全市場收盤後選股說明、目標 K 線圖「K 線圖 1 · 等待商品」，以及右側「K 線圖／等待商品」。
- 開啟後未再出現「載入交易終端…」阻塞訊息，console 的 error／warning 均為 0。
- 在修正前，Chrome 直接開啟 `http://127.0.0.1:5173/?layout=intraday-stock-selection` 時，文件已完成載入且 console 無錯誤，但畫面超過四分鐘仍停在「載入交易終端…」。現場追查確認啟動流程仍等待作用中 watchlist 的合約解析與全清單行情訂閱。
- 修正後，以實際 Chrome 重新檢查相同盤中選股 URL，已直接呈現「盤中監控」容量摘要、通知設定、「即時量比結果／監控名單」頁籤與右側 K 線圖，不再顯示全頁載入阻塞。
- 另以全新隔離瀏覽器分頁開啟相同 URL，首個可用畫面即呈現完整盤中選股 workspace；SSE 狀態可繼續由面板自身流程啟動，不依賴 watchlist bootstrap。

## 範圍確認

本 change 只調整 workspace 啟動政策與 watchlist 初始化選項。未修改盤中監控的 KBar／SSE transport、cohort、bounded Gate、160 檔驗證邏輯、production 模式、broker write、下單流程或 runtime 啟停。
