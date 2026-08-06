## 1. 市場狀態正規化

- [x] 1.1 新增美股市場時區、一般交易時段與來源新鮮度的保守推論函式
- [x] 1.2 讓日 K 的 quote kind 依正規化 market phase 決定，unknown 不再冒充收盤
- [x] 1.3 讓所有市場的盤中 quote 停止收盤核對並回傳 not_applicable

## 2. 前端盤中顯示

- [x] 2.1 讓前端優先採用正規化 marketPhase，盤中顯示來源報價時間與現價
- [x] 2.2 提升 candle response cache contract，避免正式站沿用舊狀態 payload

## 3. 驗證

- [x] 3.1 新增美股盤中、盤後、來源過舊與休市證據不足的回歸測試
- [x] 3.2 執行 build、測試、lint 與 OpenSpec strict validation
- [x] 3.3 發布 Sites 正式站並驗證美股指數盤中顯示最新報價時間
