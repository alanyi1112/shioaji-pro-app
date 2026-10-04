# 2026-10-04 MultiView 跨頁清單操作完成驗收

## 結論與範圍

時間採 Asia/Taipei，本輪最終真實快取瀏覽器驗收為 17:38:43–17:38:46。task 4.3 完成，change 為 **18／18**。這是隔離測試清單搭配真正保存的盤後行情，以及既有服務／使用者介面的唯讀前後核對；**不是盤中 SSE 事件驗收，也不是正式使用者清單寫入測試**。

本 change 的要求是清單異動持久化、圖表保留及交易／行情隔離，不要求交易日即時事件到達。因此不需等開盤，也沒有用測試事件冒充實盤。先前 fixture／503 的未驗收紀錄保留；本輪用下列不同種類的實證補足缺口。

## 程式與測試補強

- 保留先前已修正的 canonical identity 圖表同步：移除第一檔時只銷毀離開可見清單的卡片，不再先刪掉尾端卡片、再重載第一張。下一檔沿用其原 canvas、縮放與圖表更新註冊。
- 將舊的「按卡片位置 applyOrderedSymbol 並 reload」靜態斷言更新成保留 canonical 卡片；完整瀏覽器仍驗證真實滑鼠行為，而非只檢查原始碼。
- 加入明確啟用的只讀日 K 快取驗收入口。來源資料庫以 `DatabaseSync(..., { readOnly: true })` 開啟，僅讀 2449.TW／2330.TW 快取與清單 hash；清單 API 寫入在另建的 SQLite D1、測試身分及 `fixture.invalid` 瀏覽器環境執行。未攜入使用者身分、Cookie、帳務或清單原文。
- 操作前等待已載入圖表的初始 fit／ResizeObserver 穩定，再量測 viewport，避免把初始 `barSpacing=6` 當作使用者已完成的縮放位置。保持精確縮放斷言，沒有放寬容差。

## 真實資料與持久狀態

京元電 2449.TW、台積電 2330.TW 各使用既有 **160 根**真正保存的日 K，來源 `yfinance`，最新交易日 **2026-10-02**。報告保存 payload hash、來源日期與官方核對欄位，沒有更名或修改原值。

兩份原始 payload 都有 TWSE 收盤／OHLC 價格核對；`volume=mismatch` 仍保留，**本輪不宣稱成交量已核對相符，也不處理此獨立資料來源問題**。這不影響清單身份、排序或原 canvas 保留的驗收。

單圖與雙圖均由真正 Chromium 滑鼠 Option 拖曳複製、確認移除、再無 Option 拖曳移動，經實際 Worker API 寫入獨立 SQLite：

- 複製目的地恰有一筆、第一位；來源的全部卡片／canvas／visibleLogicalRange／barSpacing 完全未變。圖表更新註冊單圖 3→3、雙圖 4→4，來源日 K 請求增量 **0**。
- 目的地重新整理後仍在第一位；確認移除後資料列不再有效，重新整理仍呈現空清單。
- 移動 2449 後來源由 2330 遞補；保留原 2330 卡片與 canvas，縮放前後均 **3.9382716049382718**；目的地第一位與刷新後結果一致。
- 每個案例只有三筆清單寫入：`transfer`、`remove-from-tab`、`transfer`；全部只寫測試資料庫。瀏覽器外部請求 **0**、未攔到的 broker 請求 **0**、pageerror **0**。
- 批次更新與選單引發的 contract 讀取在隔離 router 回傳 503 並逐筆記錄；沒有傳至既有服務。這是安全隔離，不被記為行情來源正常或實際 SSE 成功。

完整逐筆請求與來源 hash：

- [單圖證據](isolated-real-cache-1-2026-10-04.json)
- [雙圖證據](isolated-real-cache-2-2026-10-04.json)

## 既有服務與使用者狀態前後核對

- 正式 MultiView 四張使用者表（頁籤、個人商品、系統頁籤覆寫、mutation revision）前後 hash 相同：`072c3191a6137b8913ff3b30b43d3b80a71fff6f5f079a006d12779b9957c55c`。
- 唯讀 `/api/v1/watchlist` 前後 hash 相同：`366952bbbb6a96cedbcee8d786e42ddb538c35d0664b4683c41f043bb3365fc0`；沒有保存使用者清單原文。
- `/api/v1/stream/status` 前後都是 `healthy`、active connections **63→63**。這是既有 API 的連線計數，不把它稱為單一 broker physical connection 計數。
- 既有 Chrome 標準看盤頁唯讀 DOM 前後一致：清單數 17／17／13／13／8、選取「觀察」、IX0001 圖表、委託 `Orders [0/0]`、即時訊號 `8/8 訂閱正常`；診斷訂閱總數 **35→35**。沒有開啟新看盤頁、修改清單或交易草稿。
- runtime status 前後為 simulation、business session／2330 Snapshot available、watchdog healthy／restart count **0**、production stopped、write master disabled、active obligations **0**。
- 8080／5173／5174 listener PID 前後均 **1273／933／938**；沒有停止／重啟 API、watchdog、Web 或 MultiView，沒有新增 login、broker 訂閱或下單。

交易 API 原始帳務內容未讀取；初版唯讀前檢誤把 POST 查詢 `order/trades` 當 GET，回 404，當輪在任何清單操作前就停止。改以既有介面委託狀態及零交易網路請求核對，不透過新增帳務查詢、登入或寫入來通過。

## 回歸與原失敗

- Node 24、隔離副本的標準 `npm run build`（含圖表 prebuild）通過。
- 清單 manipulation／interaction／DOM／完整 app browser、個人頁籤、rendered HTML、panel reorder、realtime hub 八檔 **108／108 通過，0 skipped**。
- 真實快取單圖／雙圖 **2／2 通過，0 skipped**。
- rendered HTML 與 realtime coordinator 另跑 **90／90 通過**；這與上述 rendered HTML 重疊，不加總為獨立測試數。
- MultiView `tsc --noEmit`、修改三檔 ESLint、OpenSpec strict validation、`git diff --check` 通過。

本輪原失敗沒有刪除或改稱成功：最初隔離副本漏根專案 `src`／tsconfig／scripts，造成 build／型別缺依賴，補齊副本後通過；舊 reload 靜態斷言 1 項失敗已修正；瀏覽器縮放基準讀得太早出現 6→3.217821782178218，修正為等待可見範圍穩定後，原精確斷言通過。以上與產品既有圖表保留錯誤分開記錄。

## 重現與限制

在包含根專案依賴的獨立工作樹副本建置，套入目前 `app.js` 及測試檔後，從 `apps/multiview` 執行：

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH npm run build
PATH=/opt/homebrew/opt/node@24/bin:$PATH node --test tests/watchlist-direct-manipulation.test.mjs tests/watchlist-direct-interaction.test.mjs tests/watchlist-direct-browser.test.mjs tests/watchlist-direct-app-browser.test.mjs tests/personal-tab-management.test.mjs tests/rendered-html.test.mjs tests/panel-reordering.test.mjs tests/realtime-hub.test.mjs
```

選用真實快取入口須明示 `MULTIVIEW_ACCEPTANCE_D1_PATH` 為既有本機 D1 的絕對路徑，以及 `MULTIVIEW_ACCEPTANCE_OUTPUT_DIR` 為本輪新建暫存目錄。缺少真實快取就失敗，不會退回 fixture 冒充成功。一般回歸不設此環境變數，仍使用明示測試 K 線。

原始生成報告與視覺核對截圖位於 `/tmp/realtimestock-multiview-closeout-heJRtp/evidence-final/`；副本與圖片為本機暫存，不提交大型行情或 SQLite。正式盤中事件到達、上游 broker 全域 ownership／用量歸因未在此輪驗證，也不是此清單 change 的必要條件。沒有修改其他 active changes，沒有歸檔、commit、push 或部署。
