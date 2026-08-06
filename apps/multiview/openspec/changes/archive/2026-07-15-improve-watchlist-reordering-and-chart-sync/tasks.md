## 1. Worker 排序契約與 D1 批次持久化

- [x] 1.1 在 `worker/app.ts` 建立頁籤限定的排序 request 型別與解析／驗證 helper，要求 `tabId`、`tabLabel`、`scope`、ordered item identities 與 client revision，並拒絕重複、跨頁籤或未知項目。
- [x] 1.2 將 `/api/instruments/reorder` 從 generic `saveInstrument()` 分離，讓排序只能修改目前使用者指定頁籤的 `sort_order`，不得改寫名稱、provider 或其他商品欄位。
- [x] 1.3 以單次 `env.DB.batch()` 保存個人頁籤順序，並以 `scope=system` 的個人 override 保存系統頁籤順序，不修改共享 `stock_setup.md`。
- [x] 1.4 讓排序 response 只回傳已接受的頁籤身分、client revision 與 canonical order，不回傳可能覆蓋前端新草稿的完整 instrument payload。
- [x] 1.5 確認既有 `user_instruments.sort_order` 可直接沿用且不需 migration；若實作證據顯示需要 schema 調整，先更新 design 與 migration plan 再改資料庫。

## 2. 前端 canonical ordering 與頁籤隔離

- [x] 2.1 在 `public/static/app.js` 建立包含頁籤身分與 symbol 的排序 item key，將本機套用、快照與回復從 symbol-only Map 改為頁籤限定比對。
- [x] 2.2 建立 `orderedInstrumentsForTab()` canonical selector，以 `defaultOrder` 與穩定 tie-breaker 產生 deterministic order，並讓管理清單沿用此 selector。
- [x] 2.3 將 K 線預設商品、分類分頁、商品下拉選單與相鄰頁籤／分頁預載的 symbol 來源改為 canonical selector，移除依全域 `state.instruments` 原始順序推斷的路徑。
- [x] 2.4 修正 `openWatchlistManager()` 的選頁順序，優先選取目前有效 `activeMarketTabId`；只有目前頁籤無效時才使用預設個人頁籤或第一個可見頁籤。
- [x] 2.5 確認在管理視窗手動選擇非目前 K 線頁籤時，關閉後不會擅自切換 K 線，但日後切換該頁籤會使用已保存順序。

## 3. 即時箭頭排序與 latest-wins 儲存協調器

- [x] 3.1 以每頁籤排序狀態取代 `watchlistReorderPendingKey` 全域阻塞，保存確認快照、草稿、revision、debounce timer、in-flight revision 與 dirty 狀態。
- [x] 3.2 讓每次有效上移／下移先立即更新草稿與管理清單，只有清單邊界的無效方向停用，不因網路請求停用其他排序控制。
- [x] 3.3 以約 250ms trailing debounce 合併箭頭操作，並以 serialized coalescing 保證同頁籤最多一個排序 request in flight、完成後再送最新 dirty revision。
- [x] 3.4 實作 revision 檢查，使 stale success／failure 不會覆蓋較新草稿；只有最新 revision 失敗且沒有更新草稿時才回復最後確認快照。
- [x] 3.5 在關閉管理視窗、切換管理頁籤或需要同步 K 線前 flush 最新草稿，但不以網路等待阻塞 dialog 關閉與後續 UI 操作。
- [x] 3.6 更新排序狀態訊息，低干擾地顯示待儲存、儲存中、已儲存與安全錯誤，避免訊息重繪造成清單跳動。

## 4. Pointer Events 拖曳體驗

- [x] 4.1 在每個商品列加入可聚焦、具 accessible name 與位置資訊的專用拖曳把手，移除整列 `draggable`，保留列點擊選取商品設定的行為。
- [x] 4.2 以 pointer capture 實作 pointerdown／pointermove／pointerup 拖曳，只有目標索引改變時才更新本機草稿與插入位置。
- [x] 4.3 加入拖曳項目、插入位置、grab／grabbing cursor 與 live status 的可見樣式，並設定適當 `touch-action`。
- [x] 4.4 實作清單上下邊緣自動捲動，使用單一 animation frame 與受限速度，結束拖曳時確實清理 frame、pointer capture 與 CSS state。
- [x] 4.5 讓 pointerup 只排程一次排序儲存；`Escape`、`pointercancel` 或無效落點則回復拖曳前快照且不送出寫入。
- [x] 4.6 保留上移／下移的滑鼠、鍵盤與輔助技術操作能力，確認不用拖曳也能完成所有排序。

## 5. K 線、分頁與 panel 同步

- [x] 5.1 擴充 panel API，使目前頁籤排序改變時可依 panel index 套用新的 ordered symbol 與 options，只有 symbol 實際改變才呼叫 `load()`。
- [x] 5.2 套用新順序時保留 interval、主副圖指標、聚焦狀態與其他 panel 設定，不以整批 `renderPanels()` 重建所有圖表。
- [x] 5.3 在目前 K 線頁籤的排序確認或管理視窗關閉時，同步分類頁碼、visible symbols、panel 與下拉選單；跨頁邊界時正確 clamp 頁碼並維持相同 order。
- [x] 5.4 在最新排序失敗回復時，同步回復管理清單、分類分頁、panel 與下拉選單，不留下不同排序來源。
- [x] 5.5 確認排序非目前 K 線頁籤時不觸發目前 panel 市場資料重載，切換到該頁籤後才依 canonical order 顯示。

## 6. 自動測試與正式站驗收

- [x] 6.1 擴充 Worker／Fake D1 測試，涵蓋個人與系統頁籤 batch reorder、revision response、非法／重複／跨頁籤 request 全批拒絕，以及排序不得修改非排序欄位。
- [x] 6.2 新增同一 symbol 位於不同頁籤的隔離測試，證明本機與 D1 只更新指定頁籤，重新載入後兩個頁籤各自維持正確順序。
- [x] 6.3 新增前端 contract／行為測試，涵蓋快速連點不鎖住、debounce 合併、stale response latest-wins、最新失敗 rollback 與關閉時 flush。
- [x] 6.4 新增拖曳把手、插入位置、pointer cancel、邊緣 auto-scroll、一次 drop 只儲存一次，以及箭頭無障礙替代操作的測試。
- [x] 6.5 新增管理視窗優先目前 K 線頁籤，以及排序後管理清單、分頁、panel、下拉選單與預載 order 一致的測試；確認未改變 symbol 的 panel 不重複載入。
- [x] 6.6 執行 `npm test`、必要的 lint／TypeScript 檢查、`git diff --check` 與 `openspec validate --all --strict`，修正所有回歸。
- [x] 6.7 以實際滑鼠與鍵盤驗收快速箭頭、長清單拖曳／自動捲動、取消、跨頁排序、關閉後 K 線同步與 console 無新增錯誤；本機位址遭瀏覽器安全層以 `ERR_BLOCKED_BY_CLIENT` 阻擋，改在相同版本的已登入正式 Codex Site 完成等效可見互動驗收。
- [x] 6.8 依 Sites 流程建置、保存並部署驗證過的版本，確認 deployment `succeeded` 且使用本次 source commit。
- [x] 6.9 在已登入正式 Codex Site 驗收目前頁籤開啟、快速連點、拖曳、K 線同步、重新整理持久化與同 symbol 跨頁籤隔離，並確認 `/api/health`、行情、指標與 SSE 無回歸。

## 7. 拖曳遺失結束事件回歸修正

- [x] 7.1 將拖曳生命週期的 `pointermove`、`pointerup` 與 `pointercancel` 改由視窗 capture phase 接收，避免清單 DOM 重排後把手失去 pointer capture 而僵住。
- [x] 7.2 加入滑鼠按鍵已放開、視窗失焦與文件隱藏的 fail-safe cleanup，並確保所有全域 listener、pointer capture、animation frame 與拖曳 CSS state 都會移除。
- [x] 7.3 補上遺失 pointer capture、全域結束事件與 fail-safe cleanup 的回歸測試，執行完整 build／test 與 OpenSpec strict validation。
- [x] 7.4 在已登入正式 Codex Site 以長清單實際拖曳到頂端／底端後放開，確認不僵住、排序只儲存一次、重新整理仍持久化且 console 無新增錯誤。
