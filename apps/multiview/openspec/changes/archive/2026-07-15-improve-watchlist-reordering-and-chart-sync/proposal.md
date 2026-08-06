## Why

目前「我的清單」每次按上下箭頭都必須等待完整網路與 D1 儲存完成，拖曳時也缺少清楚的操作把手與插入位置回饋；排序完成後，K 線畫面、分類分頁與商品下拉選單又未必使用同一個排序結果。這會讓使用者覺得排序遲鈍、不直覺，甚至誤以為儲存失敗，因此需要把互動、持久化與圖表同步整理成單一且可驗證的流程。

## What Changes

- 將上下箭頭改成即時更新本機排序草稿，允許連續快速移動，並以短暫 debounce 與 latest-wins 佇列合併背景儲存；進行中的舊請求不得鎖住後續操作或覆蓋較新順序。
- 將整列原生拖曳改為明確的拖曳把手與 Pointer Events 互動，提供拖曳中狀態、插入位置提示、清單邊緣自動捲動、取消操作與放開後單次儲存。
- 保留下上移／下移按鈕作為滑鼠、鍵盤與無障礙替代操作，並提供可理解的儲存中、已儲存與失敗回復狀態。
- 建立頁籤內商品的單一排序來源，讓「我的清單」、K 線面板、分類分頁與商品下拉選單一致依 `defaultOrder` 顯示。
- 修正開啟「我的清單」時可能選到與目前 K 線不同頁籤的問題；若目前頁籤完成排序，關閉管理視窗後立即把新順序套用到現有 K 線面板。
- 將 `/api/instruments/reorder` 改為帶有頁籤範圍的批次排序契約，使用 D1 batch 寫入並以頁籤身分識別商品，避免逐筆延遲、跨頁籤污染與 stale response 回寫。
- 補齊快速連點、拖曳、同代號跨頁籤、失敗回復、重新載入持久化、分頁與 K 線同步的自動測試及正式站瀏覽器驗收。

## Capabilities

### New Capabilities

- `watchlist-reordering`: 規範個人清單的即時箭頭排序、直覺拖曳、合併持久化、頁籤隔離，以及排序結果同步到 K 線與其他商品順序消費端。

### Modified Capabilities

無。

## Impact

- 前端：`public/static/app.js` 的清單選頁、排序草稿、儲存佇列、拖曳事件、圖表商品來源與關閉管理視窗同步；`public/static/index.html` 與 `public/static/styles.css` 的拖曳把手、狀態與插入提示。
- Worker API：`worker/app.ts` 的 `/api/instruments/reorder` request contract、頁籤範圍驗證、D1 batch 寫入與回傳排序。
- 持久化：既有 `user_instruments.sort_order`，不新增秘密資料；若現有 schema 足夠則不新增 migration。
- 測試與驗收：`tests/rendered-html.test.mjs`、必要的互動驗收工具，以及已登入 Codex Sites 正式站的可見行為驗證。
- 相容性：不改變既有商品新增、刪除、行情、指標與 SSE contract；現有資料重新載入後仍可使用。
