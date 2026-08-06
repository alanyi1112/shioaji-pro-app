## 1. 有效頁籤模型與相容基線

- [x] 1.1 為目前 `user_tabs` 建立系統頁籤、一般自訂頁籤、`source_tab_id` override、歷史系統 ID override、重複來源與重複／非連續 `sort_order` 的 D1 fixtures 與失敗前測
- [x] 1.2 在 Worker 實作穩定 `tabKey` 與集中式 effective tab resolver，依 `source_tab_id` 合併系統預設和個人 override，並讓同一邏輯系統頁籤只出現一次
- [x] 1.3 實作 deterministic 舊資料排序與安全診斷，對無法唯一解析的歷史資料 fail closed，不刪除或重新綁定既有頁籤與商品
- [x] 1.4 擴充 `/api/instruments` 與頁籤 mutation response，回傳包含顯示／隱藏項目的 `managedTabs` 及唯一 canonical `marketTabs`，將 `personalTabs` 降為非排序來源的相容欄位
- [x] 1.5 補齊帳號隔離、同名不同 `tabKey`、system override replacement、歷史 row ID 與重複順序的 Worker contract 測試

## 2. 頁籤排序與 visibility API

- [x] 2.1 新增 `POST /api/tabs/reorder` request 驗證，拒絕重複、未知、遺漏、隱藏或不屬於目前使用者的 `tabKey`
- [x] 2.2 實作系統頁籤 override 的建立／重用與自訂頁籤更新，使用單一 D1 batch 將完整可見順序保存為唯一 `1..N` 並回傳 accepted revision 與 canonical payload
- [x] 2.3 新增 `POST /api/tabs/visibility`，以明確 `enabled` 操作隱藏／取消隱藏，讓系統頁籤尚無 override 時確實建立 disabled override
- [x] 2.4 在 visibility batch 中實作隱藏後移除並正規化、取消隱藏後加到最後、保留自訂頁籤商品及不得隱藏最後可見頁籤
- [x] 2.5 分離頁籤 metadata 儲存與排序／visibility，確保改名或預設狀態儲存不再接受使用者輸入的 `sortOrder` 或 `enabled`
- [x] 2.6 實作系統頁籤「恢復系統預設」與自訂頁籤限定刪除，重新正規化剩餘順序並維持每位使用者資料隔離
- [x] 2.7 補齊 reorder／visibility／reset／delete 的合法 batch、零異動禁止成功、最後可見頁籤、預設頁籤 promotion、validation 全批拒絕與不同帳號隔離測試

## 3. 管理視窗與頁籤排序互動

- [x] 3.1 更新 `public/static/index.html` 與樣式，把左側分成「顯示中的頁籤」和可收合的「已隱藏頁籤（n）」，移除排序數字欄位與泛用「啟用」勾選框
- [x] 3.2 以 `managedTabs` 呈現顯示／隱藏列、來源提示、空狀態、明確「隱藏頁籤」與「取消隱藏」操作，並讓系統／自訂頁籤顯示正確的 reset 或 delete control
- [x] 3.3 為顯示中頁籤加入拖曳把手、上移／下移按鈕、位置資訊與 accessible name，確保列的選取、改名及其他控制不誤觸拖曳
- [x] 3.4 實作頁籤拖曳中的插入提示、邊緣自動捲動、`Escape`、`pointercancel`、window `pointerup`、失焦與文件隱藏清理，取消時回復原順序且不送出寫入
- [x] 3.5 實作頁籤排序 coordinator：本機立即移動、短暫 debounce、遞增 revision、單一 in-flight、latest-wins、最後確認快照與安全失敗回復
- [x] 3.6 在 hide／unhide／reset／delete 前 flush 或取消衝突的排序草稿，mutation 期間停用衝突操作並以 response 的 canonical payload 一次更新狀態
- [x] 3.7 完成取消隱藏移到最後的成功提示、錯誤訊息與焦點回復，且取消隱藏不自動切換目前頁籤或改變預設頁籤

## 4. Canonical order、目前頁籤與預設頁籤

- [x] 4.1 移除 `watchlistTabsForManager()` 將 `marketTabs` 與 `personalTabs` 重新拼接排序的行為，讓導覽列、管理器、active reconciliation 與相鄰預載共同使用 canonical `marketTabs`
- [x] 4.2 讓本機頁籤排序草稿同步反映於管理器與導覽列，但不得以舊 API response 覆蓋較新草稿或造成圖表無關資料重載
- [x] 4.3 實作隱藏目前頁籤時優先下一個、否則上一個的 fallback，並同步圖表、分類分頁、商品選單與 localStorage
- [x] 4.4 實作隱藏預設頁籤時 promotion 至第一個可見頁籤，以及啟動時 saved `tabKey` 無效／已隱藏時的預設或第一項 fallback
- [x] 4.5 驗證改名、同名頁籤、排序、隱藏、取消隱藏、reset 與 reload 後，所有消費端仍以 `tabKey` 保持正確頁籤和相同順序

## 5. 自動化測試與回歸驗證

- [x] 5.1 新增前端契約測試，覆蓋兩區式管理器、隱藏數量、無排序數字／啟用欄位、系統 reset、自訂 delete、最後可見頁籤及取消隱藏提示
- [x] 5.2 新增快速連按與多次拖曳的 latest-wins 測試，驗證舊成功／失敗 response 不覆蓋新草稿、最新失敗正確回復、一次拖曳只排程一次寫入
- [x] 5.3 新增拖曳取消、pointer capture 遺失、邊緣自動捲動、鍵盤／輔助技術與 accessible name 測試
- [x] 5.4 新增重複歷史 `sort_order` 經首次 reorder／hide／unhide 正規化、系統 override 不重複、商品不遺失及重新載入持久化整合測試
- [x] 5.5 執行 `npm run lint`、`npm test`、`openspec validate improve-watchlist-tab-order-and-hidden-recovery --strict` 與 `git diff --check`，修正所有與本變更相關的失敗

## 6. 瀏覽器與正式站驗收

- [x] 6.1 在本機瀏覽器以滑鼠、鍵盤及窄螢幕驗收新增、改名、拖曳、連續上下移動、取消拖曳、隱藏、取消隱藏、reset、delete 與 reload，不得出現 console error
- [x] 6.2 以含重複歷史順序及系統 override 的測試帳號驗證導覽列與管理器順序一致、同一系統頁籤不重複、取消隱藏移到最後且既有商品完整
- [x] 6.3 依 Codex Sites 發布流程部署相同完整 HEAD，保存 version／commit 對應與不含秘密的驗證紀錄
- [x] 6.4 使用既有已登入 session 在正式站完成 browser-visible 驗收，確認帳號隔離、active/default fallback、重新載入持久化與無資料遺失；不得讀取 cookie 或建立 bypass credential
- [x] 6.5 正式站與自動化門檻全部通過後，更新 verification 證據並依 OpenSpec closeout 流程歸檔；未通過時保持 change active
