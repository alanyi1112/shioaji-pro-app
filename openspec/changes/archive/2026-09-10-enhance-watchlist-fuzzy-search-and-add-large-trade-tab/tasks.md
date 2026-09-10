## 1. 建立回歸基線與測試資料

- [x] 1.1 盤點 `watchlist.tsx`、`product-search.ts`、`stock-index.ts` 與盤中監控搜尋 client 的現行介面，記錄 direct-code、非台股商品及 MultiView 離線時的既有行為
- [x] 1.2 建立不含正式帳號或真實下單資料的台股搜尋 fixture，涵蓋完整股名、部分股名、全半形、符號、近似字、同代號跨來源及缺少股名
- [x] 1.3 建立 history/live tick fixture，涵蓋暖機、P70 邊界、低價／高價股、開收盤集合競價、零股、simtrade、重疊成交、跨日與 generation 切換

## 2. 共用台灣商品搜尋能力

- [x] 2.1 將 MultiView `/api/instrument-search` 的 request、timeout、schema 驗證與錯誤模型抽成面板無關的共用 client，並保留既有盤中監控匯入介面相容性
- [x] 2.2 實作 Unicode NFKC、大小寫、空白與常見分隔符號正規化，以及名稱 bigram Dice／edit similarity 與最低信心判定
- [x] 2.3 實作代號／股名決定性評分、`securityType + exchange + code` 跨來源合併、欄位品質取捨與同分穩定排序
- [x] 2.4 實作 request id、AbortController 與硬 timeout，確保過期搜尋回應不能覆寫最新查詢
- [x] 2.5 新增共用搜尋單元測試，驗證正規化、排序、去重、相似度邊界、timeout、schema 錯誤、競態及本機降級

## 3. 自選清單模糊搜尋 UI

- [x] 3.1 將自選清單台股輸入接到共用搜尋 client 與既有 `searchProducts` 降級結果，且不改變非台股商品流程
- [x] 3.2 候選列顯示代號、股名、交易所與商品類型，並分開呈現載入中、來源降級、錯誤、無結果及 contract 驗證失敗
- [x] 3.3 實作滑鼠與 `ArrowUp`、`ArrowDown`、`Enter`、`Escape` 操作，禁止把未選取的多筆模糊股名當成代號提交
- [x] 3.4 維持有效純代號直接查詢，且所有候選在建立 watchlist item 前均須由既有 Shioaji contract API 驗證 canonical 商品
- [x] 3.5 新增自選清單 component/browser 測試，驗證股名搜尋、競態、鍵盤操作、離線降級、錯誤狀態、canonical 驗證與非台股回歸

## 4. 大單分類核心

- [x] 4.1 建立純函式 tick normalizer，統一商品鍵、Asia/Taipei 交易日與時間、價格、common-lot 張數、`tick_type`、來源及穩定成交鍵
- [x] 4.2 實作合格成交過濾，只接受台灣上市／上櫃 `STK`、正價格、正張數、非零股、非 simtrade 且 `09:00:00 < time < 13:25:00`
- [x] 4.3 實作 `tradeAmount`、40 萬元保底、5 張價值、前 120 筆 P70 nearest-rank、30 筆暖機及三者取高算法
- [x] 4.4 確保候選成交先分類後入樣本，並為大單保存 `thresholdAtDetection`、`ruleVersion` 與不可變偵測證據
- [x] 4.5 實作 history 時序回放與 history/live 穩定鍵去重，避免重疊成交重複更新樣本或重複記錄
- [x] 4.6 實作商品、交易日及 stream generation 隔離／重設，拒絕舊世代延遲事件
- [x] 4.7 實作有界儲存：全部成交最近 120 筆、動態樣本最近 120 筆、大單最近 500 筆，且 UI 淘汰不破壞分類狀態

## 5. 大單分類測試

- [x] 5.1 測試 15 元、200 元、400 元股票的固定門檻、張數換算與 `>=` 邊界
- [x] 5.2 測試 29／30 筆暖機切換、P70 nearest-rank、候選不影響自身門檻、超過 120 筆樣本及極端值
- [x] 5.3 測試零量、無效價格、盤中零股、simtrade、`09:00:00`、`13:25:00` 後與不支援商品均 fail closed
- [x] 5.4 測試 history 非時序輸入、history/live 重疊、相同事件重播、不可變門檻證據及大單上限
- [x] 5.5 測試商品切換、交易日切換、stream generation 切換與舊世代晚到事件不會污染目前狀態

## 6. 成交明細大單頁籤 UI

- [x] 6.1 重構 TickTape 讓「全部」與「大單」共用成交列 renderer，並新增「全部」「大單 N」頁籤與空狀態
- [x] 6.2 在大單頁籤顯示目前有效門檻、三者取高規則摘要與 `n/30` 暖機進度，並確認介面使用「大單」而非「大戶」
- [x] 6.3 移除／禁止顯示「大單成交篩選，並非交易者身分判定」，同時保持小尺寸面板可讀與列表可滾動
- [x] 6.4 將同一分類管線接到一般成交明細與 popout，確保切換頁籤不新增 subscription、不重新 login 且不呼叫交易寫入 API
- [x] 6.5 新增 TickTape component/browser 測試，驗證頁籤筆數、列格式、條件文字、暖機、空狀態、一般／popout 一致與 subscription 回歸

## 7. 整合與安全驗證

- [x] 7.1 執行搜尋與大單相關的 targeted Vitest，確認所有新增 fixture 與邊界案例通過
- [x] 7.2 執行 `pnpm test` 與 `pnpm test:browser`，修正本 change 引起的回歸
- [x] 7.3 執行 `pnpm build`，確認 TypeScript 與 Vite production build 通過
- [x] 7.4 在 simulation-only 環境以實際 UI 驗證台股股名模糊搜尋、候選選取、全部／大單切換、門檻顯示與 popout，不啟用 production 或下單
- [x] 7.5 以唯讀方式核對行情 subscription 與登入數量，確認開啟搜尋或大單頁籤沒有第二個 subscription、第二個 login 或 broker write

## 8. 規格與交付檢查

- [x] 8.1 檢查公開參考來源、公式、UI 顯示文字、限制與實作一致，且未把大單描述成交易者身分
- [x] 8.2 執行 `openspec validate enhance-watchlist-fuzzy-search-and-add-large-trade-tab --strict`
- [x] 8.3 執行 `git diff --check`，確認只保留本 change 的預期變更且不納入無關既有工作樹內容
- [x] 8.4 更新 change 的實作證據與完成狀態；未經使用者明確要求不得 archive、commit 或 push
