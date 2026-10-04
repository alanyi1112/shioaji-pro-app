# 本機保守帳本與真實 watcher 啟用驗收（2026-10-03）

時間均為 Asia/Taipei。使用者已同意本機持久保守帳本方案並要求繼續至具備結案條件。本輪完成 8.4，進度 **39／43**；7.2、7.3、7.4、8.8 仍須完整歷史與真實發布／ready UI 證據，不提前勾選。本文件接續紀錄，不覆寫前階段失敗或將人工校準冒充正式排程。

## 程式與保護邊界

- 正式 v3 budget policy 使用 `local-conservative-v1` 身份，只初始化一次持久錨點，明示 `quotaEpochVerified=false`。API 沒有提供可信額度重設週期；本機身份不是 broker reset 證據。
- 同一資料庫所有 scope／epoch 的 charged／quarantined／未解除預留均持續計入。換日、API generation 變更、來源 counter 下降不清帳；新 counter 段往後增加的 bytes 仍累加。限額變更、錨點／counter head 破損或未知觀察 fail closed。
- 真實基準預算檔重算 forecast 後由正式 observation writer 保存 immutable journal 與 CAS head。保留完整 forecast **85,667,193 bytes**，不能因昨日工作完成便宣稱零承諾。
- 額外保護池 **314,572,800 bytes（300 MiB）** 位於可設定 DB 政策，不是程式寫死的剩餘流量啟動門檻。它保護互動行情、候選／bootstrap／ATR／人工歷史等尚未逐請求接入中央帳本的用途；**不宣稱這些工作已全部完成中央協調**。實際共享 usage 持續重驗，其他工作若消耗保護池／可用餘額不足，備援暫停。
- 兩次真實共享用量增量上界為 244,804／215,846 bytes，estimateMultiplier=1.5，正式每請求預留 **367,206 bytes**。HTTP bytes 與 broker shared usage 分記，不宣稱獨占精確歸因。延遲扣量時仍扣住 estimate。
- 維持兩次來源 HTTP／run、8 MiB／run、15 分鐘上限與中央兩請求／分鐘限制；不增加 login／subscription，不用逐檔分鐘 K 取代每日行情。

## 真實配置與自動下載

- 23:18:04 透過既有 simulation safety／business-session／2330 Snapshot／usage port，真實 reservation 放行；預檢沒有下載，requested=0 後安全釋放。原 reservation `069627fc-0d0d-46c8-8ca8-853f8dc88515` 與 released 收據保留。
- 23:18:58 啟用已驗證來源選擇政策並保存每日 profile revision **1**，預設三階段全部啟用、其餘舊條件停用；配置動作沒有立即下載。
- 既有 `com.alanyi.realtimestock.multiview-tdcc-watcher` 真正觸發，23:21 自動完成 **2026-10-02、2026-10-01** 兩個全市場日期快取，凍結四份市場／日期 manifest。兩次 started、兩次 complete，中央 charged 兩筆合計 retained estimate **734,412 bytes**。
- 母體仍為 1,977 普通股（TWSE 1,085／TPEx 892）；history plan **2026-02-03–2026-10-02，共 160 個官方交易日**。兩日期校準中的 2/2 不屬這份 plan，沒有冒充 160 日歷史。
- 23:36:30 原 watcher 新一輪 run `ed374ef4-c821-43e2-908c-2cc02e30e90f`：availableDays=2、processed market/date=4、source HTTP=0、最早重試 23:41:15.210。publication 仍為 **0**，所以仍是 pending，不是成功發布。

## 真實限流缺陷與修正

23:21 第二次 capability 呼叫在中央限流下被拒絕；舊 loader 把原因簡化成 `broker_budget_pending`，provider loop 仍嘗試其餘每個日期，造成 **158 筆 failed 收據與 158 日 pending／20 分鐘冷卻**。沒有來源 HTTP，但這個重試行為與訊息有錯。

- 新增回歸在舊程式確實失敗：日期快取列數／admission 呼叫應為 1，實際為 160；修正後通過。
- 中央拒絕明示可觀察的 `broker_rate_limited` 與最早期限；診斷查詢不取代 atomic admission。
- 未送 HTTP 的全域 admission／simulation 拒絕立即結束當輪，不污染其餘日期。新限流採實際窗口期限；一般未知 admission 一分鐘後由下輪重驗。真正 source failure／429 仍保留原冷卻與 Retry-After。
- 已保存的舊 20 分鐘冷卻完全保留，不手動提前解除；下一輪讀到它亦停止全域重試。
- 原 23:21 failed 收據依 id 排序，選取 id／cache_key／payload／created_at 共 158 筆，23:37 唯讀確認 SHA-256：`1fb7a9e0e0146249a0b61987fe9be6a2feedccdcd418fe6760b3584be27ab413`。
- 實際 UI 已修正「未下載」的誤導訊息：顯示本輪未放行、已取得資料保留、已備 **2／160 日**、台北最早重試時間。瀏覽器 warn/error 觀察為空。這是 **pending UI 驗證**，不是 7.4 ready UI 驗收。

## 回歸與安全

- Node 11 files **149／149** 通過；涵蓋中央 reservation、持久保守錨點／counter、舊債、allocation producer、承諾 CAS、真實 port 的隔離 HTTP、provider loop、date cache、來源 manifest、fallback publication／API 與舊 v8 發布。
- Chromium panel fixture **9／9** 通過，含限流／既有資料保留／台北時間／GET 零 profile PUT。Fixture 不是正式來源或自動發布證據。
- root／MultiView 型別檢查及 root build 通過；原 chunk >500 kB 提示保留。
- 23:38 真實 runtime status：simulation、business session／2330 Snapshot healthy；watchdog restart count=0；production stopped、write master disabled、active obligations=0；8080／5173／5174 保持運作。既有其他能力的 partial／verification_required 狀態保留。
- 瀏覽器測試未點「套用至每日自動篩選」，正式 profile revision 1 未變。使用者原草稿三項（大戶比例趨勢、散戶比例下降、價漲融資不增）已還原；布林草稿停用。查詢與背景 profile 隔離。
- 未重啟共用服務、增加 broker login／subscription、交易、改訂單／交易草稿、archive／commit／push；原始資料留本機私密 SQLite，不納入 Git。

## 接續安排與未完成

依使用者「繼續直到結案」要求建立本串後續 heartbeat `automation-2`，每 30 分鐘只接續診斷／實作／驗收，**不取代既有 watcher、不執行另一份下載器**。scheduler DB 實際 next_run_at 已核對為 **2026-10-04 00:05:02.545 Asia/Taipei**。背景由既有五分鐘 watcher 有界續跑，不能為趕結案放寬來源／日期／預算、清除失敗或手動補出自動發布。

尚待 160 日全部合法取得、逐股 unknown 分類與獨立公式重算、真實 watcher atomic head／後續同鍵 no-op、實際 ready API／UI／network counts／指定圖表與兩套清單。完成這四項才具備結案條件；本輪不能宣稱已結案。

## 23:41–23:53 真正續跑與畫面核對

- 23:41 原 watcher 自動完成 9/30、9/29，availableDays=4；當輪後續中央限流只保存下一個日期的拒絕，不再污染其餘日期。舊冷卻到期後由正常排程續跑，沒有人工提早解除。
- 23:51:37.471 的 current state：availableDays=**8／160**、processed market/date=**16／320**、profileRevision=1、publication=null、reason=`broker_rate_limited`；run `743f1e86-a318-48fc-87de-26e0dd8cb65b` 的第二次 capability 呼叫 requested=0，最早重試 **23:52:35.474**。此前該輪真正來源下載與這次被拒絕的呼叫分記，不把 requested=0 誤寫成整輪沒下載。
- 完成日期為 10/2、10/1、9/30、9/29、9/24、9/23、9/22、9/21；正式 publication 筆數仍為 **0**，不能當作三階段結果已 ready。
- 23:52 實際 Chrome 手動唯讀查詢顯示「已備 8 日」、資料保留、台北最早重試期限。畫面保存於 `local-bollinger-pending-2026-10-03-2352-visible.jpg`，不是 fixture。
- 23:53 已還原使用者原草稿的三項條件並查詢完成；布林停用，指定 K 線圖仍為「等待商品」，沒有自動切換。瀏覽器 warn／error 觀察為空；正式每日 profile 仍為原 revision 1，沒有點每日設定寫入按鈕。
- 原 158 筆 failed 收據再核對，內容 SHA-256 仍為 `1fb7a9e0e0146249a0b61987fe9be6a2feedccdcd418fe6760b3584be27ab413`；未刪除或美化舊失敗。
- 最終 change strict validation、git diff --check 及本輪新增／修改文字檔的 whitespace 檢查通過。既有五分鐘 watcher 繼續有界下載，本串 heartbeat 接續剩餘四項；沒有 archive、commit 或 push。
