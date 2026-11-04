## Why

本機多分頁的 SSE 會與 K 線 REST 爭用瀏覽器連線，造成載入逾時；日 K 的近期資料不足以顯示年線。使用者也要求移除圖表左上角三行 reference／比較基準資訊，保留真正的線條、百分比與操作。

## What Changes

- 核驗已完成的本機 K 線請求分流與原有 20 秒有界逾時，成功時正常顯示圖表，真實失敗仍可見。
- 參考均線組增加 SMA240（年線），使用經重疊價格驗證的本機日線前綴暖機。
- 暖機僅供圖表顯示，不混入原始分鐘資料、盤中量比或盤後基準，不增加暖機專用券商下載備援。
- 隱藏左上角壓撐 reference／壓撐比較基準／費波比較基準三行；固定歷史的回到最新保留於壓撐選單。
- 本 change 補記已完成實作及既有實際頁面證據，不新增功能、行情請求或服務操作。

## Capabilities

### New Capabilities
- `main-chart-daily-history-display`: 日 K 展示專用歷史暖機、來源驗真及資源隔離。

### Modified Capabilities
- `chart-technical-indicators`: 參考均線組加入年線，允許驗真的展示專用日線前綴。
- `main-chart-support-resistance-tools`: 取消左上角狀態資訊列，保留原有計算、右側標籤與選單控制。

## Impact

實作涉及 CandleChart、indicator-defs／dialog、chart-daily-history helper 與固定本機日線 gateway、kbar-request-base。既有 `watchlist-loading-resilience` 的 loopback K 線分流規格已涵蓋該路由邊界，本次只核驗，不複寫。結案僅寫本 change 及明列正式規格；四個未完成監控／恢復大案、既有原件、預算、服務及 Git index 保持。未宣稱全部歷史交易日無缺口，也未將整個終端券商用量宣稱為零。
