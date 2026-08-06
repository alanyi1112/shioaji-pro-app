# 驗證紀錄

## 自動化驗證

- `npm test`：267 項通過、0 項失敗。
- `npm run lint`：0 errors、0 warnings。
- `node --test tests/subchart-interaction.test.mjs`：22 項通過、0 項失敗。
- `openspec validate --all --strict`：29 項通過、0 項失敗。
- `git diff --check`：通過。

## 本機瀏覽器驗收

- 以實際頁面切換 1／4／6／8 圖，驗證上排、下排、首欄與末欄主圖功能表皆會依可用空間向上或向下展開；靠近右側時會改為靠右對齊，不超出 viewport。
- 在 `1280 × 520` 的 8 圖下排末欄，主圖功能表為向上、靠右展開，邊界完整位於 viewport 內，最後一個「清除繪圖」按鈕完整顯示且可操作。
- 在 `1280 × 300` 的限制高度，主圖功能表 `clientHeight=180`、`scrollHeight=249`，可在功能表內捲動至最後一個繪圖按鈕；副圖功能表 `clientHeight=180`、`scrollHeight=357`，同樣保持在 viewport 內並可捲動。
- checkbox 點擊後功能表維持開啟，狀態切換正常；`Escape` 可收合功能表。
- 本機頁面 Console errors：0。

## 正式站驗收

- runtime commit `9db3584f393d671e05a1b229898da56a04cbebec` 已同步至 GitHub `main` 與 Sites source，並發布 owner-only Sites version 149。
- 正式站載入 `app.js?v=20260728-indicator-menu-v1` 與 `styles.css?v=20260728-indicator-menu-v1`，頁面建立 8 個 chart panel。
- 在 `1280 × 520` 的下排末欄，主圖功能表向上且靠右展開，邊界為 `top=62`、`right=1101`、`bottom=304`、`left=841`，完整位於 viewport 內；七個指標文字皆完整。
- 在 `1280 × 300`，功能表邊界為 `top=12`、`bottom=194`，`clientHeight=180`、`scrollHeight=249`；功能表內捲動至 `scrollTop=69` 後，「清除繪圖」完整位於選單內且保持 enabled。
- `Escape` 可收合功能表；正式站 Console errors：0。
