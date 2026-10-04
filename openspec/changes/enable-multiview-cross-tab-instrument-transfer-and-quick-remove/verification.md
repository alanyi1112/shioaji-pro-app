# 實作與驗證紀錄

## 已完成

- 唯讀檢查既有 `user_instruments` 的 `(user_id, symbol, tab_id)`、系統頁籤 `tab_id=''`、`user_tabs` 的 `source_tab_id`、有效頁籤合併及卡片 canonical／顯示商品分離規則；在隔離 SQLite D1 fixture 重現四類來源／目的頁籤。
- 新增 per-system-tab 成員覆寫及相容遷移。遷移只複製可依預設標籤或唯一系統頁籤覆寫判定歸屬的舊列，保留原列；無法判定者保留並由 API `tabDiagnostics` 回報。
- transfer、quick-remove 與既有清單新增、排序、刪除共用有效頁籤成員解析。跨頁籤移動／複製以單一 D1 batch 寫入；每位使用者的 revision guard 使競爭寫入回滾並回報衝突。
- 卡片標題手把可拖到其他啟用頁籤，放開時按 Option 複製；右鍵與 `⋯` 提供相同操作，移除須確認。顯示商品不是 canonical 清單成員時不發送異動。成功後不自動換頁籤，空頁籤顯示空狀態。
- 完整應用隔離瀏覽器測試發現 `⋯` 按鈕的點擊區原本被報價數字覆蓋，實際滑鼠事件落在 `.price-value`。已提高按鈕點擊層級，並加入真實滑鼠命中及點擊回歸檢查。

## 隔離測試結果

- `apps/multiview`：`npm run build`、`npx tsc --noEmit`、針對本 change 修改檔的 ESLint 均通過。
- `node --test tests/watchlist-direct-manipulation.test.mjs tests/watchlist-direct-interaction.test.mjs tests/watchlist-direct-browser.test.mjs tests/watchlist-direct-app-browser.test.mjs tests/personal-tab-management.test.mjs tests/rendered-html.test.mjs`：90 項通過；涵蓋四類頁籤組合、複製目的重複、備註保存、不同使用者、停用／過期頁籤、失敗注入、並行競爭、舊列遷移、單圖拖曳候選、放開時 Option、無效落點及 canonical 不一致無網路寫入。
- 新增完整應用的隔離 headless Chrome 測試，所有網路請求限制在 `fixture.invalid`，使用獨立 SQLite D1；實際以滑鼠 Option 拖放複製、刷新後確認目的第一檔、點 `⋯` 並確認移除、刷新後確認空狀態，再由來源拖放移動並確認下一檔卡片遞補及刷新後目的第一檔。複製時來源線圖 DOM 未重建；沒有連到既有 5173／5174 或交易服務。
- `npx openspec validate enable-multiview-cross-tab-instrument-transfer-and-quick-remove --strict` 通過；本 change 的 `git diff --check` 通過。
- 全專案 `npm run lint` 尚未通過：兩個與本 change 無關的既有警告，分別在 `tests/stock-screener-v4-publisher-route.test.mjs:133` 與 `worker/stock-screener-v6-route.ts:148`。沒有改動這兩處。

## 尚未驗收

- 完整應用測試已核對卡片遞補與空狀態；但行情 API 在隔離瀏覽器內回傳 503，尚未量測真實 K 線 viewport 與行情訂閱數，故 4.3 保留未完成。沒有對使用者現有清單、RealTimeStock 清單、行情連線或交易狀態做寫入測試。
- 未部署或執行正式 D1 遷移；未 archive、commit 或 push。
