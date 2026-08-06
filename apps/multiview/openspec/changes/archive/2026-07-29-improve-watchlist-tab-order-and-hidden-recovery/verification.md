# 驗證紀錄

## 2026-07-29 本機自動化

- `npm run lint`：通過。
- `npm test`：296 項測試全數通過。
- `openspec validate improve-watchlist-tab-order-and-hidden-recovery --strict`：通過。
- `git diff --check`：通過。
- Worker 整合 fixtures 已覆蓋重複／非連續 `sort_order`、歷史 system ID override、重複 `source_tab_id`、未知來源 fail closed、帳號隔離、完整 reorder batch、visibility、reset 與 delete。

## 2026-07-29 本機瀏覽器

- 八張圖同時開啟時，驗證頁籤寫入會先暫停同源 SSE、完成後恢復，避免 mutation 卡在瀏覽器連線佇列。
- 驗證新增與改名後，管理器和頂端導覽都使用相同 `tabKey` 與顯示名稱。
- 驗證上移／下移與滑鼠拖曳，伺服器回傳後仍維持唯一連續的 `1..N`，重新載入不回復舊順序。
- 驗證將拖曳移出有效範圍會取消並回復原順序；成功拖曳只產生一次排序寫入。
- 驗證隱藏後顯示「已隱藏頁籤（1）」和「取消隱藏」，取消隱藏後移至可見清單末端。
- 375 × 700 viewport 可見並可操作拖曳把手、上下移動、隱藏與頁籤設定控制。
- 清理驗收用自訂頁籤後重新載入，頁籤未復活；瀏覽器 console 未出現本網站 error。

## 正式發布

- GitHub `main` 與 Sites source 已推送完整 SHA `40757f57fdead6e2835c5f13e02d90d557b456a4`。
- Codex Sites version 155 對應同一完整 SHA，owner-only production deployment `appgdep_6a69cecb94a081919afaa3dbde4baad9` 已為 `succeeded`。
- 正式網址：`https://quote-chart-multiview.alanyi1112.chatgpt.site`。

## 2026-07-29 正式站 browser-visible 驗收

- 沿用使用者已登入的 Codex 內建瀏覽器 session；未輸入帳密、未讀取 cookie、未建立或輪替 bypass credential。
- 新增暫存自訂頁籤 `Codex 正式驗收 0729`，先以上移控制移至第 5 位，再以滑鼠拖曳移至第 4 位；管理器與頂端導覽同步為唯一連續的 `1..6`，重新載入後順序持久化。
- 驗收時發現儲存頁籤會在讀取「設為預設」前先重繪表單，導致勾選值被覆寫；修正後由 Sites version 154 驗證預設狀態可保存。
- 將暫存頁籤設為 active/default 後隱藏，active 依規格切換到下一個「期貨期指」，預設頁籤在重新載入後提升為第一個可見頁籤「台股」，可見順序正規化為 `1..5`。
- 驗收時再發現重新開啟管理視窗可能保留左欄深層捲動且收合「已隱藏頁籤」，使取消隱藏入口不易發現；Sites version 155 已在每次開啟時將管理區捲回頂端，且有隱藏項目時自動展開。
- 重新載入正式站後，「已隱藏頁籤」立即展開且 `取消隱藏頁籤 Codex 正式驗收 0729` 按鈕可見；取消隱藏成功提示為「已取消隱藏並移到最後，可再拖曳調整。」。
- 取消隱藏後暫存頁籤位於第 6 位，不搶走目前頁籤或預設狀態；再次重新載入後仍位於最後，台股仍為 active/default。
- 刪除暫存頁籤並重新載入後，正式資料完全復原：頁籤順序為「台股、錢線百分百、匯率債券、期貨期指、美股」、隱藏數 0、台股商品共 26 項，暫存頁籤未復活。
- 正式站瀏覽器 console error 為 0。
