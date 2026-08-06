## 驗收紀錄

日期：2026-07-29

### 自動化驗證

- `npm test`：299／299 通過，包含 production build。
- `npm run lint`：通過，0 warnings。
- `openspec validate --all --strict`：33／33 通過。
- `git diff --check`：通過。
- 呈現模式測試涵蓋新舊偏好 migration matrix、`view=single` 資格、1／2／3／4／6／8 圖、主圖 none lifecycle、request 取消／隔離與 controller 清理。

### 本機瀏覽器驗收

- 全台股 8 圖可在主圖、單一副圖與多層副圖間切換；只有多層副圖使用 document scroll。
- 主圖模式的 1／2／3／4／6／8 圖都讓 panel 套用 `has-no-subchart`，副圖高度為 0、籌碼 pane 數為 0、設定入口具有 `inert`、`aria-disabled="true"` 與 `tabindex="-1"`，且沒有水平溢位。
- 單一副圖模式保留 8 個可見技術副圖槽位，設定入口恢復操作，頁面不套用多層 document scroll。
- 多層副圖模式的 8 圖建立 96 個籌碼 pane，頁面可捲動且沒有水平溢位。
- 非台股頁籤維持可操作的「主副圖」選單，只停用「多層副圖」；切到主圖後 8 個副圖槽位全部收合。
- 本機開發伺服器在主圖切換後沒有出現 `/api/taiwan-stock-chip` 籌碼請求；後續頁籤切換紀錄只有必要的 candles 請求。正式站單一商品頁另完成實際驗收。

### Sites 發布

- commit：`7bf525059a88ba51a293687f6f7ec96e7a7f75d7`。
- Sites version：158。
- deployment：`appgdep_6a69ed22f54c8191ab2934fa35935c6f`，狀態 `succeeded`。
- 正式網址：`https://quote-chart-multiview.alanyi1112.chatgpt.site/`。
- 正式 HTML 已載入 `20260729-main-subchart-modes-v1` 的 `styles.css`、`chart-interactions.js`、`chip-panes.js` 與 `app.js`。

### 正式站 browser-visible 終驗

- `00919.TW` 單一商品頁只建立 1 個 panel，三個選項皆可用；主圖時副圖高度 0、籌碼 pane 0 且設定入口停用，單一副圖恢復技術副圖，多層副圖恢復 12 個籌碼 pane 與 document scroll。
- `AAPL` 單一商品頁只建立 1 個 panel；主圖與單一副圖可用，只有多層副圖 disabled。主圖模式確實收合副圖且不建立籌碼 pane。
- 全台股「錢線百分百」頁籤的 6／8 圖多層副圖分別建立 72／96 個籌碼 pane，使用 document scroll，沒有 panel／副圖區內層垂直捲動，也沒有水平溢位。
- 含 `^TWII` 與台股商品的受限頁籤只停用多層選項，整個選單仍可切換主圖／單一副圖；返回 eligible 全台股頁籤後自動恢復先前保存的多層副圖與 96 個 pane。
- 全程正式站 console error：0。
- 驗收完成後已將正式頁面恢復為 4 圖、單一副圖，並保留正式站頁籤供使用者查看。

### 已知限制

- 無產品功能限制。瀏覽器同時開啟大量本機即時串流頁面時可能耗盡同源連線槽；本次已以關閉多餘驗收頁、檢查伺服器 request 紀錄，以及正式站單一商品頁終驗避免把驗收環境連線飽和誤判為產品錯誤。
