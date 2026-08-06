## 1. 匯出框線實作

- [x] 1.1 建立匯出 clone 專用 frame，複製 panel 四側 computed border 與圓角
- [x] 1.2 將 frame 固定於完整擷取尺寸最上層，且不影響 live DOM、layout 或互動
- [x] 1.3 更新圖片匯出前端 cache-busting 版本

## 2. 驗證

- [x] 2.1 新增匯出 frame、四側框線、圓角與安全生命週期的自動化回歸測試
- [x] 2.2 執行完整測試、lint、OpenSpec strict validation 與差異檢查
- [x] 2.3 以實際瀏覽器匯出 PNG，驗證四邊框線與四個圓角完整
