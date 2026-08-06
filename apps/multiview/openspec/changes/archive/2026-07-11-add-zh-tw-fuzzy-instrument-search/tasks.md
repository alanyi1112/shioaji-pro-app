## 1. 搜尋目錄資料模型與測試基線

- [x] 1.1 為 D1 `instrument_catalog` schema、唯一鍵、索引與向後相容初始化新增測試，確認不影響 `user_instruments` 與 `tpex_market_mirror`。
- [x] 1.2 新增海外商品繁中 seed／alias fixture，涵蓋目前 `stock_setup.md` 的美股、指數、期貨、外匯、債券與加密貨幣，並加入完整性與重複 `symbol + exchange` 檢查。
- [x] 1.3 建立台股目錄 ingest 測試，覆蓋 TWSE／TPEx 有效筆數、代號格式、非空中文名稱、交易所、重複資料及拒絕不完整更新。

## 2. D1 商品目錄與官方同步

- [x] 2.1 在 `worker/app.ts` 建立 `instrument_catalog` 與必要索引，實作共用 catalog upsert／query helper。
- [x] 2.2 匯入並版本化海外商品繁中主名稱、英文正式名稱及常用別名，讓新增別名不必修改搜尋演算法。
- [x] 2.3 建立受保護的台股商品目錄 ingest contract，沿用安全的伺服器端秘密處理並確保 log／response 不暴露 secret。
- [x] 2.4 擴充 private GitHub Actions 官方資料同步流程，將 TWSE／TPEx 代號、中文名稱、交易所與商品類型驗證後寫入 Sites D1，不依賴 Render。
- [x] 2.5 執行一次完整目錄同步並以唯讀查詢確認上市／上櫃代表商品、資料筆數與更新時間正確。

## 3. 搜尋正規化、評分與 API

- [x] 3.1 以測試鎖定 Unicode／全半形／大小寫／空白／標點／symbol suffix 正規化，以及至少兩字中文與短代號查詢規則。
- [x] 3.2 實作 local、D1 catalog、TWSE／TPEx 與 Yahoo 候選的統一資料結構及獨立錯誤處理。
- [x] 3.3 實作 exact、prefix、contains、中文 bigram／trigram fuzzy 與英文 fallback 的 deterministic 評分及最低門檻。
- [x] 3.4 以 `symbol + exchange` 合併去重，讓可信繁中目錄 enrich 同商品的 Yahoo 英文候選，且保留不同交易所的同代號商品。
- [x] 3.5 擴充 `/api/instrument-search` response，保留既有欄位並新增 `localizedName`、`englishName`、`matchedBy`、`score`、`warnings[]`，同時維持舊 `warning` 相容欄位。
- [x] 3.6 新增 API 測試覆蓋 `元太`、`8069`、`輝達`、`蘋果`、`日經`、`布蘭特原油`、上市 ETF、英文名稱、代號 prefix、模糊輸入及無結果。
- [x] 3.7 新增部分來源失敗測試，確認 TPEx、TWSE、D1 或 Yahoo 任一失敗時仍回傳其他來源候選，且 warning 不互相覆蓋。

## 4. 商品設定候選介面

- [x] 4.1 更新搜尋觸發規則，名稱查詢至少兩字、可辨識代號允許較短輸入，並保留 debounce 與過期 request 取消邏輯。
- [x] 4.2 更新候選版面，以繁中主名稱為主要文字，英文正式名稱、symbol、exchange、market／商品類型及來源為輔助資訊。
- [x] 4.3 保留點選候選只填入表單的行為，確認繁中名稱、代號、分類與 provider 正確，且未按「儲存商品」前不寫入 D1。
- [x] 4.4 調整 warning 呈現，存在候選時仍顯示非阻斷來源警告，不把可用結果誤呈現為完全失敗。
- [x] 4.5 補齊前端 contract／DOM 測試，鎖定繁中主名稱、英文輔助名稱、候選 metadata 與明確確認文案。

## 5. 本機與正式 Codex Site 驗證

- [x] 5.1 執行 `npm run build`、TypeScript／Node 檢查、完整測試、`git diff --check` 與 `openspec validate --all --strict`。
- [x] 5.2 在本機瀏覽器驗收搜尋、候選排序、同名辨識、點選填表、未自動儲存及明確儲存流程，並確認 console 無新增錯誤。
- [x] 5.3 推送 Sites source、儲存並部署新版本，確認部署使用本次驗證過的 commit 與 D1 商品目錄。
- [x] 5.4 以正式 Codex Site API 驗收 `元太`、`8069`、`輝達`、`蘋果`、`日經`、`布蘭特原油`、上市 ETF、英文與代號查詢，保存實際候選欄位證據。
- [x] 5.5 以正式站瀏覽器確認繁中／英文候選顯示及「點選只填表、按儲存才新增」，並檢查既有多圖、頁籤與個人清單流程無回歸。
