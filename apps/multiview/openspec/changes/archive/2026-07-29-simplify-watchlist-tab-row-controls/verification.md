## 驗收紀錄

日期：2026-07-29

### 自動化驗證

- `node --test tests/subchart-interaction.test.mjs`：25／25 通過；包含混合來源頁籤的台股單圖可使用 B，以及非台股單圖固定 A 的雙向資格測試。
- `node --test tests/rendered-html.test.mjs`：59／59 通過；確認頁籤上下箭頭已移除、visibility SVG 與鍵盤排序契約存在，且 6／8 圖不再受圖數強制限制。
- `npm test`：297／297 通過（含 production build）。
- `npm run lint`：通過，0 warnings。
- `openspec validate --all --strict`：33／33 通過。
- `git diff --check`：通過。

### 本機瀏覽器驗收

- 台股 8 圖：模式選單維持可操作，`aria-disabled="false"`。
- 方式 A：頁面固定於 viewport，未套用 `is-mode-b-page-scroll`。
- 方式 B：套用 `is-mode-b-page-scroll`，8 個 panel 由 document 垂直捲動；實測 `scrollHeight` 大於 viewport。
- A／B 往返切換未覆寫保存偏好。

### 正式站 browser-visible 終驗

- version 157 引用 `20260729-watchlist-chip-mode-v1` 的 `app.js` 與 `styles.css`。
- `00919.TW` 單一商品頁只建立 1 個 panel，模式選單可操作且 `aria-disabled="false"`；A／B 往返切換成功，切回 B 時套用 `is-mode-b-page-scroll`。
- `^TWII` 單一商品頁只建立 1 個 panel，固定 A、選單 disabled，並顯示只有台股商品可使用多層副圖的 tooltip。
- 「我的清單」顯示中頁籤列沒有上移／下移頁籤按鈕；visibility SVG 為裝飾性，眼睛隱藏「美股」後已隱藏數量變為 1，取消隱藏後回復 0 並移到最後。
- 拖曳把手以 `ArrowDown`／`ArrowUp` 完成「台股」第 1↔2 位往返，最終保存順序已回復原狀。
- 窄版實測管理器 `scrollWidth === clientWidth`；拖曳把手 28px、眼睛圖示按鈕 30px、名稱欄取得剩餘寬度並維持 `nowrap`／`ellipsis`。
- 正式站 console error：0。

### 正式站 cache 檢查

- version 156 首次正式站驗收發現 HTML 仍引用 `20260728-pivot-points-v1`，瀏覽器沿用舊版 `app.js`／`styles.css`。
- 已將兩個資產查詢版本同步更新為 `20260729-watchlist-chip-mode-v1`；必須以重新發布後的正式站結果為準。
