## Why

MultiView 的多層籌碼副圖為控制瀏覽器 Canvas 資源，會卸載距離 viewport 超過 240px 的 Lightweight Charts；但完整商品 panel PNG 匯出直接擷取整個長 panel，導致匯出瞬間未掛載的副圖只剩標題與讀值，線條、柱狀圖及價格軸從圖片中消失。這項回歸會讓畫面上曾確認存在的線圖無法可靠保存，且現有測試未涵蓋虛擬化與匯出的整合生命週期。

## What Changes

- 為單一商品 panel 建立有界的匯出準備與清理生命週期：匯出前暫時掛載該 panel 所有已選取且應顯示的籌碼副圖，完成後還原原本的掛載集合。
- 匯出準備期間保留既有虛擬化資源政策，不永久停用 `IntersectionObserver`，也不影響其他商品 panel。
- 讓匯出用副圖在擷取前套用目前主圖 viewport、共用游標日期、讀值與價格軸配置，並等待有效 Canvas 完成繪製。
- 若任一應繪製副圖未能建立可擷取的 Canvas，匯出必須失敗並顯示可理解訊息，不得下載缺圖 PNG。
- 補上可執行的整合測試與實際瀏覽器驗收，涵蓋離屏融資券／持股副圖、不同觸發位置、成功、取消與錯誤清理。

## Capabilities

### New Capabilities

- `multiview-panel-image-export-stability`: 定義 MultiView 在籌碼副圖採 viewport-near 掛載／離屏卸載時，完整商品 panel PNG 的準備、繪製就緒、完整性檢查、資源還原與驗收契約。

### Modified Capabilities

- 無。

## Impact

- 主要影響 `apps/multiview/public/static/chip-panes.js`、`apps/multiview/public/static/app.js`、`apps/multiview/public/static/panel-image-export.js` 及其測試。
- 不變更行情、籌碼 API、資料來源、D1 schema、盤中或盤後資料流程，也不新增任何影像上傳或第三方截圖服務。
- 匯出時會短暫增加目標 panel 的 Canvas 數量；實作與驗收必須證明數量有界，並在成功、失敗、取消或 panel 銷毀後恢復原狀。
