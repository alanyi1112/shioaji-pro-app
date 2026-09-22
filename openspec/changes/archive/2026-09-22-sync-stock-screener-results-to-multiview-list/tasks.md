## 1. MultiView 後端同步能力

- [x] 1.1 為「選股篩選」固定頁籤 identity、canonical symbol 輸入與結構化 `added`／`already_present`／錯誤結果建立型別與純函式測試
- [x] 1.2 實作 server-side catalog 驗證，保留 `.TW`／`.TWO` market／provider identity，並拒絕未知、矛盾或非台股 STK 商品
- [x] 1.3 實作目前 principal 範圍內的精確同名頁籤查找，對多個同名頁籤及保留 identity 衝突 fail closed
- [x] 1.4 以穩定 tab identity、D1 transaction／batch 與 upsert 實作 ensure-tab-and-item，並在回讀後才回覆成功
- [x] 1.5 新增 MultiView 固定用途 endpoint，確保只寫 `user_tabs`／`user_instruments`，不呼叫預熱、回補、訂閱或 runtime lifecycle
- [x] 1.6 新增 worker 測試，涵蓋頁籤缺少、既有頁籤、重複商品、雙請求併發、不同 principal 隔離、`.TW`／`.TWO` 與衝突 fail-closed

## 2. 5173 固定用途 gateway

- [x] 2.1 建立選股清單同步 gateway，只接受固定 POST path、受限 payload schema 與設定好的 loopback MultiView target
- [x] 2.2 將 gateway 接入本機 5173 啟動／Vite 流程，保留既有 screener 唯讀 gateway 行為
- [x] 2.3 新增 gateway 測試，證明合法請求可轉送，且任意 host／URL／path／method、非 loopback target、過大或畸形 payload 均被拒絕
- [x] 2.4 驗證 MultiView 未執行、timeout 與非成功回應會轉成不含機密資料的結構化可重試錯誤

## 3. 選股前端雙端 orchestration 與 UI

- [x] 3.1 建立 MultiView 選股清單 client，從 `UniverseStock.symbol` 傳送 canonical identity 並解析結構化結果
- [x] 3.2 將既有 Shioaji helper 與 MultiView helper 組合為雙端獨立、冪等的加入流程，保留每一端成功、原已存在與失敗結果
- [x] 3.3 更新選股結果按鈕狀態與訊息，只有兩端確認才顯示整體完成；部分成功時指出完成端、未完成端及可重試動作
- [x] 3.4 維持卡片 chart pick、mouse／touch／keyboard 與加入按鈕事件隔離，且 pending 期間阻擋同一卡片重複送出
- [x] 3.5 新增單元與 browser tests，涵蓋兩端成功、兩端原已存在、兩種部分成功、兩端失敗、重試收斂、reload persistence 與不改動目前圖表／交易草稿

## 4. MultiView 頁面收斂

- [x] 4.1 抽出可重用的個人頁籤／商品唯讀 refresh，使外部新增資料可更新現有 list model
- [x] 4.2 在 window focus 與 document 恢復 visible 時加入 single-flight refresh，不新增 polling
- [x] 4.3 新增前端測試，驗證連續 focus／visibility 只產生一個進行中 request，且刷新不切換作用中頁籤、商品或圖表

## 5. 整合驗證與文件

- [x] 5.1 在 simulation-only 本機環境驗證「選股篩選」不存在時建立一次、存在時沿用、重複加入與兩個選股分頁併發皆不重複
- [x] 5.2 以至少一檔 `.TW` 與一檔 `.TWO` catalog 商品驗證兩端 persistence，並重載 5173／5174 確認各目標只出現一次
- [x] 5.3 中斷 5174 驗證 Shioaji 成功／MultiView 失敗的部分狀態，恢復後重試並確認收斂，且不補償刪除 Shioaji 資料
- [x] 5.4 以 network／state 證據確認同步期間沒有委託、production 切換、額外行情訂閱、籌碼預熱／回補、DDL 或 runtime 啟停
- [x] 5.5 執行相關 focused tests、TypeScript／lint／build、`openspec validate sync-stock-screener-results-to-multiview-list --strict` 與 `git diff --check`，並記錄任何 repo-wide 既有失敗
- [x] 5.6 更新本機 runtime／MultiView 文件，說明固定 gateway、頁籤名稱、部分成功語意、focus 收斂與安全邊界

## 6. 歸檔前真實商品回歸修正

- [x] 6.1 新增最新已發布 verified screener universe 的 server-side fallback，使 `instrument_catalog` 沒有的普通股仍可驗證，且 ETF、未發布、revision 矛盾與未知商品繼續 fail closed
- [x] 6.2 新增 `2454.TW` 回歸測試，驗證不觸發 provider／DDL／預熱副作用，並在現行本機 runtime 完成缺少端的冪等重試與持久化回讀
