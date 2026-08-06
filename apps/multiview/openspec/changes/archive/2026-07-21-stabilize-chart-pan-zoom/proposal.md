## Why

使用者在 K 線圖以滾輪縮放或按住滑鼠左鍵平移後，稍晚發生的 resize、籌碼副圖版面更新或延遲 refit 仍可能把時間軸重設成顯示全部 K 棒，造成縮放方向突然反轉般的跳動。這會破壞圖表操作的可預期性，也讓使用者無法穩定檢視特定區間。

## What Changes

- 使用者開始在主 K 線圖縮放或平移後，取消尚未執行的自動 time-scale refit。
- panel resize、價格軸寬度與副圖版面更新時，保存並恢復使用者目前的可視邏輯範圍，不再改成顯示全部資料。
- 同一份資料因指標或版面重繪時保留使用者範圍；只有新商品／週期初次載入才套用預設完整範圍。
- 保留向左瀏覽時的歷史 K 棒補載，並在新增舊資料後依增加根數平移既有範圍。
- 補上自動化測試與真實滑鼠滾輪、左鍵拖曳驗證。

## Capabilities

### New Capabilities

- `chart-time-scale-interaction`: 規範 K 線圖縮放、平移、resize、非同步重繪與歷史補載之間的可視範圍穩定性。

### Modified Capabilities

無。

## Impact

- 圖表 panel 的 time scale、layout refresh 與使用者互動狀態：`public/static/app.js`
- 前端資源 cache-busting：`public/static/index.html`
- 圖表互動回歸測試：`tests/rendered-html.test.mjs`
- 不變更市場資料 API、K 棒資料內容、資料庫或 Sites runtime 綁定。
