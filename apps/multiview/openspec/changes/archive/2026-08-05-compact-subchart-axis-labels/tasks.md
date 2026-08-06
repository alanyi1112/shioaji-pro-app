## 1. 共用刻度格式

- [x] 1.1 建立可測試的副圖數值軸 formatter，支援 `K張`、百分比去尾零與技術值去尾零
- [x] 1.2 將共用 formatter 依正確順序載入頁面並更新靜態資源版本

## 2. 圖表接線

- [x] 2.1 將籌碼副圖右側張數與百分比 price formatter 改用精簡軸格式
- [x] 2.2 將 RSI、KD、MACD、ATR 的數值軸改用精簡技術格式，維持 header readout 原格式

## 3. 驗證

- [x] 3.1 新增 formatter 輸入輸出與 source contract 自動測試
- [x] 3.2 執行 lint、build、完整測試與 OpenSpec strict validation
- [x] 3.3 在本機實際圖表驗收籌碼與技術指標右側刻度寬度及顯示文字
