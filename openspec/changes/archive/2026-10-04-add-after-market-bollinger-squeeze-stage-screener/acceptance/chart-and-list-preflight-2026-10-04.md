# 指定圖表與雙清單預檢（2026-10-04，45／47）

本輪使用既有 Chrome 分頁、simulation session；未選取結果股票、未加入／刪除清單、未新增圖表、未呼叫行情下載器。原發布與歷史失敗證據保留。

## 已核對

- 09:42 標準看盤分頁與選股分頁的既有圖表都是 IX0001；標準頁為日 K、選股頁為 5 分 K。不能沿用舊對話的「目前為 2449」假設。
- 標準頁「觀察」清單包含 2408，頁面診斷顯示訂閱數 35。這不等於已證明選股分頁自己的合約快取具有 2408 的已確認訂閱。
- 使用選股頁 UI 暫時取消原三項條件，啟用布林預設草稿並查詢；真正結果顯示壓縮 14、準備 1、突破 1、unknown 61、資料日 10/2，其中 2408 為正在壓縮。沒有按「套用至每日自動篩選」。
- 09:48 以 UI 精準還原原三項條件：千張大戶比例趨勢 0–100%／3 週、十張以下散戶下降 3 週、價漲融資不增比較 5 日；AND／符合／股票代碼／升冪、原 IX0001 圖表目標均不變，再查詢恢復原條件結果。技術型態保持收合，原價漲融資設定保持展開。
- Chrome console 本輪讀取 warn／error 為空；這不能代替完整 network counts。
- 09:48:37 唯讀正式 DB：head 仍為 `72dd8c83-792e-4217-a8ab-398cf8513c51`，updatedAt 09:11:47.246；profile 仍 enabled／revision 1，createdAt 10/3 23:18:58.243，payload hash `4ce25d3d72813b4b0b05939920cb6779fbd96b54afecaa1415981cf035407028`。
- 唯讀 Shioaji「選股」仍 13 項且包含 2408；MultiView「選股篩選」仍 6 項：2454.TW、3675.TWO、8054.TWO、3715.TW、2436.TW、1809.TW，沒有 2408。頁籤 identity／updatedAt 未變。
- 09:48:53 擷取既有 SharedWorker 唯讀診斷：data 與 contract_event 兩個 channel 各 portCount=3，createdAt=1791036719866、openedAt=1791036719870、watchdogRestarts=0、acceptanceInterrupts=0；兩 channel 的 identity 與本輪早期觀察相同。委託頁籤顯示 0/0。
- `pnpm local-runtime status`：simulation healthy、business session／2330 Snapshot available、production stopped、write master disabled、watchdog restart count 0；沒有啟停服務。

## 未完成與需要的授權

指定圖表的實際路徑為 `App.tsx` → `createScreenerChartSelection` → `ensureContract`；後者即使 cache hit 仍呼叫 `ensureQuoteSubscription`，以**此分頁內**的確認 Map 決定是否送 Tick／BidAsk。其他分頁已顯示該股或 broker 全域訂閱數不變，不能證明此路徑不會再送訂閱請求。這是程式預檢，不是已送出請求或已完成圖表驗收。

本次 prompt 禁止新增 subscription，故在點選結果前停下。提出有界方案：使用已在「觀察」及 Shioaji「選股」的 2408，允許既有 simulation session 最多兩筆正常 Tick／BidAsk 訂閱請求及指定日 K 查詢，不另登入、不建第二條行情連線、不重啟服務；加入清單時 Shioaji 應為 already_present，只暫加 MultiView 的 2408.TW，驗證後僅移除此輪新項目，不回存整份舊清單。執行前須有使用者明確同意並具備實際 network 觀測方式；不以本輪其他頁的診斷取代操作期間的 network counts／零交易實證。

因此 7.4／8.8 仍未勾，45／47 不變。原五次 GET 的隔離結果頁證據仍見 `live-publication-and-reader-scale-2026-10-04.md`，本輪 Chrome 查詢未捕獲完整 network counts，分開記錄。

截圖（本機暫存）：`/tmp/bollinger-chart-preflight-20261004.png`、`/tmp/bollinger-draft-restored-20261004.png`。均已實際檢視；前者顯示正式結果狀態與尚未切換的 IX0001，後者顯示原三項條件結果及同一圖表。

本輪沒有功能程式變更，不重複已完成的完整回歸；執行 OpenSpec strict validation／diff／新文件 whitespace 檢查。維護舊三組不在本輪範圍，checkpoint 為 deferred，不記巡訪成功。
