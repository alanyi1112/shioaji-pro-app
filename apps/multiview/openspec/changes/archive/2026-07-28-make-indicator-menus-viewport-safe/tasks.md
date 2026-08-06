## 1. Viewport-safe 定位與生命週期

- [x] 1.1 在 `public/static/app.js` 建立可單元測試的功能表定位計算，涵蓋下方足夠、改向上、兩側不足與安全邊距下的方向及 `max-height`。
- [x] 1.2 擴充 `wireIndicatorMenus`，在 toggle、viewport resize 與 scroll 時重新定位開啟中的主圖／副圖功能表，並在收合及 cleanup 移除暫態 class、style 與所有新增 listener。
- [x] 1.3 在 `public/static/styles.css` 加入向上展開、動態高度、垂直捲動、水平裁切防護與 `overscroll-behavior`，同時保留 open panel 的覆蓋層級與副圖既有寬度規則。

## 2. 主圖功能表緊湊重排

- [x] 2.1 在 `public/static/index.html` 將七個主圖 checkbox 放入專屬兩欄 grid，讓短標籤依 DOM 順序排列、長標籤跨欄，並保留所有 class、value、checked 狀態與 label 點擊區。
- [x] 2.2 將主圖選項文字設為至少 12 CSS px、數值顯示維持全寬，並把四個繪圖工具排成兩欄兩列；保留按鈕至少 26 CSS px 高度、完整文字及既有 hover／focus／鍵盤順序。
- [x] 2.3 更新 `styles.css`／`app.js` 的靜態資產 cache key 與 HTML／CSS 契約測試，確認主圖、副圖 selector、checkbox value、偏好保存及繪圖事件入口未改變。

## 3. 驗證與發布

- [x] 3.1 執行定位單元測試、功能表互動測試、完整 `npm test`、`npm run lint`、`openspec validate --all --strict` 與 `git diff --check`，修正所有迴歸。
- [x] 3.2 以實際瀏覽器驗收 1／4／6／8 圖的上排、下排、首欄與末欄，並在較矮 viewport 確認向上／向下翻轉、內部捲動、所有文字完整、checkbox／select／button 操作、外部點擊與 Escape 收合。
- [x] 3.3 同步完整 runtime HEAD 至 GitHub 與 Sites source，發布 owner-only Sites version，並在正式站重驗多圖功能表邊界、最後一個繪圖按鈕可操作與 Console 0 errors。
