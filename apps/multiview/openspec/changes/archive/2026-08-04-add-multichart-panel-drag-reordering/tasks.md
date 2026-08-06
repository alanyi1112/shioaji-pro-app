## 1. Canonical 身分與 panel controller 基礎

- [x] 1.1 為完整頁籤順序、page slice 範圍與 visible identity 重排建立純函式及單元測試，確認第二頁重排不改變其他 index 範圍。
- [x] 1.2 讓每個 panel controller 保存頁籤限定 canonical item identity 與可更新的目前 position，並將臨時顯示 symbol 與排序身分分離。
- [x] 1.3 將 `createPanel(index)` 內雙擊、預設商品、refresh、debug report 等固定 index 依賴改為讀取 controller 目前 position／element identity。
- [x] 1.4 補上可診斷但不含秘密的 debug report，回報 panel position、canonical identity、display symbol、drag 狀態與資料 request／stream 計數。

## 2. Panel 拖曳與鍵盤互動

- [x] 2.1 在 panel 上方商品標題／報價區建立滑鼠可拖曳的非互動熱區，並加入只作視覺提示與鍵盤入口的可聚焦把手；只於 2／3／4／6／8 圖且目前頁至少兩個 canonical 商品時啟用。
- [x] 2.2 在 `public/static/styles.css` 實作上方熱區的 grab／grabbing、提示把手、來源狀態、輕量 ghost、overlay placeholder 與 focus-visible 樣式，確保各圖數及 responsive grid 不裁切控制項。
- [x] 2.3 實作並測試依 `getBoundingClientRect()` 計算 row-major target、跨列 pointer target 與鍵盤幾何鄰接的純函式，不以寫死欄數判斷。
- [x] 2.4 實作滑鼠左鍵 `pointerdown` 加 movement threshold 的 drag controller，排除 select、details、button、input、主副圖 surface 與 Canvas；拖曳中只更新 ghost／placeholder，不搬動真正 panel、Canvas、controller array 或 canonical state。
- [x] 2.5 以 window capture 處理 `pointermove`／`pointerup`／`pointercancel`，並加入 `Escape`、buttons 歸零、blur、visibilitychange、resize、頁籤／頁數／圖數切換的共用取消 cleanup。
- [x] 2.6 實作方向鍵等效排序、無效方向 no-op、焦點跟隨、位置 accessible name 與 live status 更新。
- [x] 2.7 隔離拖曳 pointer sequence 與 click／dblclick，確認拖曳不會誤開單圖新分頁，完成或取消後正常雙擊仍可使用。

## 3. 原子 panel 重排與永久保存

- [x] 3.1 實作合法 drop 的單次 `state.panels`、grid children、controller position 與排序提示／鍵盤把手資訊原子重排，不呼叫完整 `renderPanels()`。
- [x] 3.2 將 visible identity 新順序替換回完整頁籤 canonical order 的同一 page slice，保留所有不可見項目及頁碼／頁數。
- [x] 3.3 擴充既有 `stageManagedInstrumentOrder()`／reorder coordinator，讓 panel 來源沿用同一 revision／latest-wins 與 `/api/instruments/reorder` batch，且成功 response 不以 `applyOrderedSymbol()` 重新載入已重排 panel。
- [x] 3.4 驗證連續 panel 拖曳，以及 panel 與「我的清單」交錯排序時，舊 response 不覆蓋新草稿且只保存最後完整順序。
- [x] 3.5 實作最新保存失敗回復：同 context 原子移回既有 controllers，已離開 context 時只回復 canonical state，並顯示安全錯誤訊息。
- [x] 3.6 驗證 panel 臨時選擇及重複顯示 symbol 時仍使用不重複 canonical identities，不新增、刪除或替換清單成員。
- [x] 3.7 以 Worker／D1 fixture 驗證個人頁籤與系統頁籤 override 都保存完整合法清單、連續 `sort_order`，且不影響其他頁籤或其他使用者。

## 4. Chart lifecycle 與既有功能回歸

- [x] 4.1 加入 lifecycle／network contract，斷言拖曳與純順序 drop 不 destroy／reload panel、不新增 candles／籌碼 request、SSE connection 或背景回補。
- [x] 4.2 驗證 interval、visible range、主圖 overlay、annotation、技術／籌碼副圖、hover readout、cache 與 stream 都跟隨原 controller 保留。
- [x] 4.3 驗證 1 圖無排序入口、1／2／3／4 圖主副圖偏好維持、6／8 圖固定單一副圖，台股指數與 eligible 台股商品混合時資格不受重排影響。
- [x] 4.4 驗證拖曳中切換頁籤、分類頁、圖數或 single-view 會取消且不保存；拖曳到 grid 外或分頁控制不會自動跨頁。
- [x] 4.5 驗證重排後各位置雙擊開啟正確商品／週期／tab 的單圖新分頁，原多圖頁狀態保持不變。

## 5. 自動化驗證

- [x] 5.1 擴充 rendered HTML／CSS contract，檢查上方排序熱區、movement threshold、互動控制排除、鍵盤把手、accessible name、ghost／placeholder、window cleanup listeners 與 responsive 樣式。
- [x] 5.2 新增多圖排序專屬測試，涵蓋 2／3／4／6／8 圖、第二頁 slice、幾何 target、鍵盤鄰接、取消、latest-wins、失敗回復及臨時重複商品。
- [x] 5.3 執行 `npm run lint`、`npm test`、`openspec validate --all --strict` 與 `git diff --check`，修正所有失敗且不得降低既有驗收條件。

## 6. 本機與雙環境可見驗收

- [x] 6.1 在本機已登入測試資料驗收 pointer／鍵盤排序、第二頁永久同步、「我的清單」與下拉選單一致、取消 cleanup、零額外資料 request 及 console 0 errors。
- [x] 6.2 將 exact commit 部署至 Sites 保留站，驗收 2／3／4／6／8 圖、至少一個 responsive grid、重載持久化、臨時重複商品、雙擊隔離與 6／8 圖限制。
- [x] 6.3 將同一 exact commit 部署至 Cloudflare 正式站，完成與 Sites 保留站相同的已授權可見驗收，並確認 protected health、D1 persistence 及 commit SHA。
- [x] 6.4 在 change 內新增不含秘密的 `verification.md`，記錄測試數、兩站版本／部署、代表頁籤與商品、排序前後 canonical order、network／stream 計數及 console 結果，供後續歸檔判定。
