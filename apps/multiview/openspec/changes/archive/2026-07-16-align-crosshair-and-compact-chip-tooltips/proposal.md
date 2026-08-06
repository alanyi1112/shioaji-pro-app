## Why

目前主圖、技術副圖與各籌碼 pane 由不同 chart instance 繪製，相同日期的 crosshair 仍可能因價格軸寬度不同而左右錯位；同時，籌碼 pane 將最新值與日期永久放在標題／說明列，壓縮了圖表可用高度，也無法清楚表達游標所在日期的逐日資料與 TDCC 週資料缺值。

## What Changes

- 在同一 panel 的主圖、技術副圖與所有作用中籌碼 pane 之間建立單一共用垂直 crosshair 視覺線，並統一可繪圖區幾何，使同一日期的 X 座標誤差不超過 1px。
- 將主圖、技術副圖與籌碼 pane 的游標日期資料集中為逐日浮動 tooltip；tooltip 依游標日期更新、靠近邊界時自動換側，且不得遮住游標主要觀察區。
- 明確修改舊規格：籌碼 pane 標題不再永久顯示最新值與實際資料日期，只保留名稱、必要狀態、級距控制與移除控制；最新值／逐日值改由浮動 tooltip 顯示。
- 縮減方式 B 的技術副圖與籌碼 pane 固定高度及標題空間，移除永久讀值說明列，使同一 viewport 可同時看到更多副圖，並維持瀏覽器 document 為唯一垂直捲動容器。
- 為所有籌碼 dataset 補齊游標日期讀值 contract；`null`、未發布與部分資料不得顯示為 0。
- TDCC 大戶／散戶資料只在實際 `dataDate` 顯示該週值，不做 forward-fill；游標停在其他交易日時，tooltip 必須明示「當日無發布資料」，並可另列最近一筆實際發布日期作為參考。
- 加入桌面、窄螢幕、A／B 模式與 1／2／3 圖的 crosshair、tooltip、緊湊高度與 1px 對齊驗收；4／6／8 圖仍維持方式 A 政策。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `taiwan-stock-chip-subcharts`: 修改副圖標題讀值、垂直 crosshair、逐日 tooltip、TDCC 缺值語意、多層副圖高度與可視驗收要求。

## Impact

- 前端圖表同步與 panel lifecycle：`public/static/app.js`、`public/static/chip-panes.js`。
- 版面、共用 crosshair overlay、浮動 tooltip 與緊湊副圖樣式：`public/static/styles.css` 與對應 HTML 結構。
- Lightweight Charts 的價格軸寬度、crosshair 顯示、pointer／hover event 與 resize 行為。
- 現有籌碼資料 response 與 TDCC `dataDate` 語意不變，不新增上游 API、D1 migration 或秘密值。
- 測試與驗收：rendered HTML／JS contract、自動化測試、OpenSpec strict validation，以及已登入正式站的可見互動驗證。
