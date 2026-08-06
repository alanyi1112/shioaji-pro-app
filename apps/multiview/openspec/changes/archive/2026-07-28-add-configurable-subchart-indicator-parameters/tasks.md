## 1. 指標參數與 Worker 計算

- [x] 1.1 建立副圖參數型別、參考預設、範圍正規化與穩定簽章
- [x] 1.2 將 RSI 改為可設定的 5／10 Wilder 雙序列，並補齊平盤及暖機邊界
- [x] 1.3 將 KD 改為可設定的 9／3／3 遞迴平滑與固定初始值 50
- [x] 1.4 讓 MACD、ATR 使用同一份參數物件並在 payload 回傳正規化設定
- [x] 1.5 讓 candles、歷史補載與 stream 解析相同 query 參數，將簽章納入 Worker cache key，並由日 K 依交易所時區聚合週線與月線

## 2. 全域設定介面與資料生命週期

- [x] 2.1 在技術指標 legend 加入可存取的小齒輪，建立 viewport-safe 設定 dialog 與有效欄位
- [x] 2.2 建立版本化 localStorage 讀寫、前端 query 與 cache identity
- [x] 2.3 實作驗證、取消、還原預設及套用至所有 panel 的重載流程
- [x] 2.4 將 RSI readout／series 改為雙線，加入 RSI 30／50／70 與 KD 20／80 細虛線
- [x] 2.5 讓 SSE candle 同步更新完整 indicators、技術 series 與最新 readout

## 3. 驗證

- [x] 3.1 增加 RSI／KD 固定 fixture 數值、暖機、平盤與參數正規化測試
- [x] 3.2 增加 candles／stream 參數與 cache identity 契約測試
- [x] 3.3 增加齒輪、dialog、全域套用、雙 RSI 與參考橫線的前端契約測試
- [x] 3.4 執行相關測試、完整 `npm test`、`openspec validate --all --strict` 與 `git diff --check`
- [x] 3.5 以瀏覽器驗證 1 圖與 8 圖的設定、重載、日／週／月 RSI／KD 顯示與 viewport 操作
