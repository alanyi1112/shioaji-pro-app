# 五型態 UI 與真實本機結案驗收

驗收日期：2026-10-04，時間均為 Asia/Taipei。範圍僅本 change；其他監控 change 的 dirty work 保留。沒有歸檔、commit、push、重新登入或重啟服務。

## 1. UI 與契約

已加入紅三兵、看跌吞噬、晨星（精確十字子型）、三隻烏鴉、刺透。收合控制位於技術型態的 K 棒分型後，分支預設停用、五個子型態預設全選；成立／次日突破確認、工程門檻、晨星跳空與回補、烏鴉首根、刺透開盤／長首棒，以及選用量能／位置均有獨立設定。

晨星第三根 **收盤** 必須嚴格超過第一根實體中點，不以 high、第三根實體長度或全振幅中點替代。刺透另驗證第二根收盤嚴格高於首根實體中點且低於首根開盤。canonical units 的等於／上下各一單位有反例測試。

影片 82／79／78／78、排名 3／5／6／7、晨星十字 76／8，以及刺透 64%／台股研究平均交易報酬 13.25%／獲利比例 90.91%／11 筆樣本分列於收合說明。這些是外部統計，不是本功能勝率或程式門檻；OLS 工程趨勢與原研究 MA5、樣本期間／成本／持有方式差異保留。

台灣呈現固定紅陽／綠陰，依 close 對 open 判斷，附看多／看空文字，不依昨收漲跌或國際主題反轉。六張明暗／midnight、台灣／國際主題 fixture 截圖保存於 `src/components/candlestick-ui-fixture-*.png`；這些不是 live 行情截圖。Chromium 同時涵蓋最小寬度、600 CSS px 高、特大字、鍵盤與文字對比至少 4.5。全部取消保留數值草稿，結果更新不自動切換商品，未改每日布林 profile。

## 2. 官方日曆、additive migration 與真正背景發布

使用既有官方原文快取驗證 TWSE 公告「臺灣證券交易所集中交易市場115年7月10日休市一天」，發布 2026-07-09，公告 ID `8a8216d69ef76943019f46cb86bf0111`：

- 原文：https://www.twse.com.tw/zh/about/news/news/content.html?8a8216d69ef76943019f46cb86bf0111
- 快取取得：2026-10-04 09:11:19.038。
- 原文 SHA-256：`ea698586ff3d2e6fe0830da7b8b44119351be9f18d80e1905466555081b0c3ec`。
- 年度底表 hash：`fa8c1db367dd1b0b7e270f49765265a63d645947678a9208d3ac74a50a01ab33`。
- 有效日曆 hash：`e3f19254abb134e73f56a93946814c5e0911d95a9a41c0fa86dc2fc8c2afe268`。
- 證據有效至 2026-10-05 14:00；到期後重新核實，不永遠視為有效。

修正短窗準備對既有有效日曆快取的識別；仍驗底表 hash、到期時間、官方原文 hash 與當日投影，不從空行情批次推論休市。共同 session grid 排除 7/10。TPEx-only 臨時公告 transport／schema 仍未驗證，不能把 TWSE 公告冒充 TPEx 獨立證據。

真正本機資料庫套用 additive `0040_screener_candlestick_publication.sql`，先備份、完整性檢查與 transaction，再記 migration。備份為本機 `MultiView/backups/candlestick-before-0040-20261004T150600Z.sqlite`，權限 0600；Node 24 SQLite 成功，原 macOS sqlite CLI error 14 保留，不冒充首次工具執行成功。舊 v8 head／profile 不變。

既有五分鐘 watcher 自然發布，沒有人工觸發下載或 publisher：

- 發布：2026-10-04 **23:11:47.036**。
- v9 snapshot：`b5530665-242d-43ec-a546-54e3a542d761`。
- publication key：`b64334c82a15df59a205f011f3c29d39f05324969921e31eb1a5ac52c27854f1`。
- rows hash：`b40de0126955494c2d6170abca23f6b8bb174d6e6158c55fa0f929125bcadc2b`。
- universe hash：`3810c3fc93263f74f61079d0b3ea18c0f2d11b29850950df929492e446f5a053`。
- 收據 `published`／`sourceRequests: 0`／1,977 檔。
- 後次真正 state 為 `unchanged`，23:11:56.790 保存同一 snapshot，23:34 再唯讀核對 head 不變，沒有重複成功收據。

## 3. 真實逐股獨立重算

`scripts/stock-screener-candlestick-live-audit.mjs` 從真實凍結原值讀取，以獨立 BigInt／OLS／形態公式重算，不呼叫正式 evaluator 取得預期答案。2026-10-04 23:21:11.990 完成：

- 64 個官方 session：2026-07-02 至 2026-10-02；128 市場日期 manifest、126,528 商品日期點，7/10 不在窗口。
- 日期點 readiness：ready 124,493；missing_ohlcv 846；no_trade 531；source_missing 281；before_listing 377，合計 126,528。完整窗口不代表每檔完整。
- 形態成立：符合 **26**、不符合 **1,900**、unknown **51**，合計 1,977。刺透 12、看跌吞噬 13、晨星 1、紅三兵／烏鴉 0，保留真實零命中。
- 次日突破確認：符合 **5**、不符合 **1,918**、unknown **54**，合計 1,977；5 檔為看跌吞噬確認。
- 真實唯讀 API 完整分頁 43 次 GET，皆 HTTP 200：成立 pass 1／fail 19／unknown 1；確認 pass 1／fail 20／unknown 1。集合、逐條件、hash、去重與三態守恆一致。

稽核初次執行的 price-basis 字面值預期錯誤、舊條件未清除造成混合查詢的兩次 harness 失敗保留；修正稽核腳本後完整重算，不把其失敗改寫為產品來源失敗。

## 4. 使用者授權的真實圖表與雙清單操作

使用者明確允許既有選股頁重載、一檔真實命中的日 K、最多兩筆 Tick／BidAsk，以及雙清單暫加後精準移除；不新增 broker login／行情連線或重啟服務。

23:17 重載原選股頁，23:19 預設五型態查詢顯示 26／1,900／51。23:21 點選真實命中的 **1519 華城／刺透**，指定未鎖定圖表正確顯示 1519 日 K；沒有自動跟隨其他結果。23:21:47 加入 Shioaji「選股」與 MultiView「選股篩選」均成功。

操作前保存原清單。後續只移除本輪新加的 1519，不廣域回存整份舊清單：

- Shioaji「選股」原 13 檔，移除後原 13 檔及其順序一致。
- MultiView 原 6 檔，暫加第 7 檔 1519.TW 後，僅刪此新 item；原 6 檔 item ID／順序一致。
- 其他 Shioaji 清單成員集合不變；「庫存個股」的 GET 回傳次序本來會變，完整 raw-list 相等斷言因此失敗。沒有為通過斷言而覆寫其他清單，將此失敗與原 13／6 精準復原分開保存。
- 清單復原透過正常 loopback API：DELETE `/api/v1/watchlist/56098003/contracts` 僅指定 1519、POST `/api/instruments/remove-from-tab` 僅指定 `1519.TW`／`personal:stock-screener-filtered`，皆 200。後者使用 revision guard、不同步新行情訂閱。
- 復原請求：前後 GET 各 2 次、DELETE 1、POST 1；再唯讀 GET 2 次確認。MultiView GET 明確使用 `mode=read-only&purpose=stock-screener-list-sync-refresh`，realtime not-requested／accepted 0。
- 原布林草稿與查詢已復原，五型態停用；圖表復原 IX0001／5m。診斷 Debug 暫用面板移除，原兩個面板保留。未按每日 profile 儲存或改交易草稿，圖表口數仍 1。

原每日布林 profile revision **1**，payload hash `4ce25d3d72813b4b0b05939920cb6779fbd96b54afecaa1415981cf035407028`；v8 head `72dd8c83-792e-4217-a8ab-398cf8513c51` 與 v9 head 操作前後一致。沒有宣稱新 v9 browser preference key 在使用新功能後仍與操作前位元相同；停用分支及舊草稿語意已復原。

### 真實逐請求網路證據

完整 HAR 從原 Chrome DevTools 紀錄擷取，窗口 23:17:14.748–23:25:39.776，**874** entries；本機檔 `/private/tmp/candlestick-live-network-full-20261004.har`，5,619,489 bytes、0600、SHA-256 `5ecbe6e5a17e9f0c2553b763f0199ad2b7ce3ad210c1c5364f25a33125c23fb5`。不放入 repo 或上傳原始帳務紀錄。HAR 無 response body，僅用於逐請求計數；結果原值依真實 DOM 與獨立 API 稽核，不從缺 body 推論資料正確。

| 請求 | 數量與結果 |
| --- | --- |
| GET 五型態 `/api/stock-screener/results` | 1 × 200，version=9；另獨立稽核 43 GET 分開計數 |
| POST `/api/v1/stream/subscribe` | 5 × 200，其中重載既有啟動 IX0001 Quote／TXFR1 Tick／BidAsk 共 3；授權選股增量為 1519 Tick／BidAsk **2**，無其他股票訂閱 |
| GET 1519 contract／info | 各 2 × 200 |
| POST 1519 `/api/v1/data/kbars` | 3 × 200、3 × status 0 取消；記錄實際行為，不美化成單次查詢 |
| POST Shioaji 選股 contracts | 1 × 200 |
| POST MultiView `/local-multiview/api/v1/stock-screener-list/items` | 1 × 200 |
| GET watchlist | 5 × 200 |
| GET daily-profile／status | 各 1 × 200 及 1 × status 0（重載取消） |
| 登入、CA、委託送出／修改／取消 | **0**；`POST /api/v1/order/trades` 為既有查詢，不是下單 |

其他既有頁面背景流量：snapshots 72 × 200；position_unit 54 × 200／54 × 400；health 66 × 200；monitor status 36 × 200；order/trades 66 × 200／66 × 400；accounts 2 × 200；info 9 × 200；account_balance 10 × 200；margin 18 × 400。沒有宣稱全頁無錯誤。console 讀取介面最終返回 0 筆，不足以抵銷 HAR 中帳務 400 的實際紀錄。

原 Save 對話框 disabled、0-byte 匯出與被工具截斷的 200,011 字元 HAR 失敗檔保留。改以原生選單貼上原紀錄到未提交的本機 Debug 欄位，分段唯讀擷取並驗 JSON 完整，隨後清空欄位／移除暫用面板。這是匯出紀錄，不是重跑驗收或新行情下載。

### 共享連線與交易安全

SharedWorker data stream 的 createdAt `1791125157124`／openedAt `1791125157133`、contract_event `1791125161118`／`1791125161145` 前後一致；sourceCreated 4／sourceClosed 2、open 1、watchdogRestarts 0／acceptanceInterrupts 0。最後 heartbeat 95，portCount 由 3 至 2，並非另建 EventSource。Debug 是讀原 port，沒有斷線演練，最近 order_event 仍無事件。

用量前錨點 23:20:38：connections 1、bytes 20,761,333、limit 524,288,000、remaining 503,526,667；23:35:23 後：connections **1**、bytes **25,839,735**、remaining **498,448,265**。總增加 5,078,402 bytes，含共用背景與日 K，不能全部歸因單一 UI 查詢。

服務 PID 前後維持 8080=1229、5173=951、5174=957；simulation healthy、2330 Snapshot available、production stopped、write master disabled、active obligations 0／drain empty、watchdog restart 0。sandbox 內 status 曾誤投影 listener down／unknown；以有權限的唯讀重查確認，原工具輸出保留，未因此重啟服務。MultiView 全域市場／籌碼 coverage 仍 partial，與本 change 五型態窗口完整性分開。

## 5. 回歸與交付

Node 24.19.0：最新 root focused **8 files／117 tests**、Chromium **3 files／59 tests**、v9／v8 publisher 與 migration Node tests **34 tests** 全通過，合计 **210** 項（不與第二階段 203 重複加總）。根目錄 `tsc -b`、MultiView `tsc --noEmit`、Vite build、MultiView vinext build 通過。保留 root 大 bundle 與 vinext configLoader／route classification 既有警告；第一次 vinext CLI 路徑錯誤已修正，未影響服務。

最終 OpenSpec strict validation、`git diff --check` 通過；51 個 untracked 文字檔 whitespace／檔末換行問題 0。CLI apply state 為 `all_done`，27／27 完成。未跑 repo-wide 全測試，不能宣稱其他監控 change 全部結案。以上真實來源、獨立重算、指定圖表／雙清單、完整網路與安全證據成立後，本 change 具備結案條件；歸檔、同步主規格、commit、push 仍待使用者另外指示。

真實圖表截圖：`/private/tmp/candlestick-live-1519-final-20261004.png`；原 DOM `/private/tmp/candlestick-live-1519-20261004.dom.txt`；復原 DOM／截圖 `/private/tmp/candlestick-restored-20261004.dom.txt`、`/private/tmp/candlestick-restored-20261004.png`。1519 截圖攝於精準移除之後，畫面「已加入」訊息是前次操作狀態，不代表移除後清單仍含 1519；最終 membership 依 API 實證判定。
