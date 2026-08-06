## 1. 可視範圍生命週期

- [x] 1.1 使用者開始 wheel 或 pointer 操作時取消尚未執行的自動 time-scale refit
- [x] 1.2 panel resize 與副圖 layout 更新時保存並恢復目前可視邏輯範圍
- [x] 1.3 同一商品資料或指標重繪時保留使用者範圍，且新 chart 仍採預設完整範圍
- [x] 1.4 保持主圖、技術副圖、籌碼副圖及歷史補載的範圍同步

## 2. 驗證

- [x] 2.1 新增自動化回歸測試並更新前端 cache-busting 版本
- [x] 2.2 執行完整測試、lint、OpenSpec strict validation 與真實滑鼠滾輪／左鍵拖曳驗證
