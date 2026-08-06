## 驗證摘要

本變更將主圖價格折線、技術副圖折線與籌碼副圖折線的 Lightweight Charts crosshair marker 從預設半徑 4 px／邊框 2 px，顯式縮為半徑 2 CSS px／邊框 1 CSS px；折線顏色、顯示條件、費波那契選點隱藏與跨 pane 同步均維持不變。

## 自動化驗證

- `npm test`：264 passed、0 failed，包含 production build。
- `npm run lint`：0 warnings。
- `openspec validate --all --strict`：29 passed、0 failed。
- `git diff --check`：通過。
- 新增契約測試同時覆蓋 `app.js` 主圖 `addLine`、技術副圖 `addIndicatorLine` 與 `chip-panes.js` 籌碼 `addLine`，並驗證費波那契 marker 隱藏規則未被改寫。
- `index.html` 已讓 `app.js` 與 `chip-panes.js` 共用 `20260728-crosshair-marker-v1` cache-busting key。

## 本機畫面驗收

- 以 in-app Browser 在 `820 × 1470` viewport 重現使用者截圖的窄版比例，載入 `2454.TW` 日 K、多層副圖。
- 共用垂直十字準線穿過主圖多條價格線、技術副圖與第一個籌碼副圖時，各交點均呈現約 4 px 直徑的小圓點，只略大於 1–2 px 折線；多點靠近時未再形成遮蔽 K 棒與折線的大型圓點列。
- marker 保留所屬 series 顏色，共用日期線與主副圖 X 座標同步不變；Console 0 errors。

## 正式站

- GitHub `main` 與 Sites source 均已同步 runtime commit `351a4d858cd81705549116b7299c18492e1c1a80`。
- owner-only Sites version 148 發布成功，正式站為 `https://quote-chart-multiview.alanyi1112.chatgpt.site`。
- 正式站實際載入 `app.js?v=20260728-crosshair-marker-v1` 與 `chip-panes.js?v=20260728-crosshair-marker-v1`。
- 在已登入正式站分別以 `2301.TW` 驗收主圖／技術副圖、以 `2308.TW` 驗收籌碼副圖；垂直十字準線上的彩色交點均呈現約 4 px 直徑，只略大於折線且未遮蔽 K 棒或相鄰線條。
- 圖表資料、series 顏色、主副圖日期同步均維持正常；正式站 Console 0 errors。
