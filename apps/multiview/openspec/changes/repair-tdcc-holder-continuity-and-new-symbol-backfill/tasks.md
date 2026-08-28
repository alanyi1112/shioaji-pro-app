## 1. 建立日期證據模型與回歸基線

- [x] 1.1 新增 TDCC fixture，覆蓋「53 筆但缺 `2026-08-07`／`2026-08-14`」、「新增商品只有 `2026-08-21` 一筆」及最近 51 個官方日期集合。
- [x] 1.2 新增 additive D1 migration 與 schema metadata，保存每個 continuous target 的官方計畫核對終點、coverage 驗證時間及必要 handoff 查詢 index，不刪除既有 rows／items。
- [x] 1.3 擴充 migration／schema contract tests，驗證既有資料庫可升級、重跑 migration 冪等、舊欄位與個人清單資料不受影響。
- [x] 1.4 實作純函式日期投影器，以官方日期、分布 rows、`pre_listing`／`not_published` items 計算 expected、completed、missing、failed、coverage 與狀態。
- [x] 1.5 新增日期投影單元測試，確認 row count 不可掩蓋中間缺週，且所有官方日期 resolved 並涵蓋最新 `dataDate` 後才可 `completed`。

## 2. 修正 Worker reconcile、狀態與 API

- [x] 2.1 重構 target upsert／sync，停止以 saved row count 的最大值推高 expected／completed，改由日期投影結果更新 symbol counters 與 missing dates。
- [x] 2.2 擴充最新快照保存：當 `latest_snapshot_date` 晚於官方計畫核對終點時，保留真實新 row 並將錯誤完成狀態降為 `queued`／`partial`，不得推算固定星期五日期。
- [x] 2.3 擴充受保護 plan／reconcile control plane，將最近 51 個官方日期冪等建立到 item ledger，對已保存 rows 與合法 gaps 標記 resolved，只讓真正缺週可 claim。
- [x] 2.4 擴充逐 symbol 籌碼 API 與 TDCC health，安全回傳 `officialPlanThrough`、`coverageVerifiedAt`、queued-since、handoff、expected／completed／missing 及 bounded missing dates。
- [x] 2.5 加入全域 target／run 摘要與逐 symbol evidence 的一致性測試，確認全域 healthy 不會掩蓋 handoff overdue、missing dates 或錯誤 `completed`。
- [x] 2.6 加入 Worker behavior tests，覆蓋最新快照前進、合法 gap、blocked／running 保護、重複 reconcile、lease owner 與 material changed-only 寫入。

## 3. 建立新增商品的有界背景交接

- [x] 3.1 新增本機受保護 queue-only probe，在沒有 runnable／overdue target 時成功 no-op，且不建立 TDCC 歷史 session 或來源 request。
- [x] 3.2 新增本機 TDCC queue watcher command，只有 probe 發現工作時才取得 host single-flight 並啟動既有 continuous runner；重疊執行必須安全退出。
- [x] 3.3 更新本機 LaunchAgent 安裝／升級設定，使 watcher `RunAtLoad` 並最晚每五分鐘檢查一次，同時保留週六 22:30 主同步與週日 22:30 隔日重試。
- [x] 3.4 保留 Sites／Cloudflare 既有受保護 dispatch，補齊 deployment-specific handoff 記錄；未設定或失敗時必須 truthful degraded 且 queue 不遺失。
- [x] 3.5 新增 watcher／dispatch contract tests，覆蓋五分鐘 SLA、無工作零來源流量、重複喚醒、dispatch unavailable、不同 deployment 隔離與秘密 redaction。
- [x] 3.6 新增商品保存整合測試，確認 request 可快速完成，而日籌碼、TDCC target、queue 與 handoff 各自留下可由後續 durable 工作恢復的 evidence。

## 4. 修正歷史 runner 的官方日期計畫與續跑

- [x] 4.1 調整 continuous runner，在建立 TDCC session 前先確認有可 claim 工作；無工作時輸出安全 no-op 摘要並結束。
- [x] 4.2 讓 runner 取得官方日期集合後先呼叫 reconcile，再依 missing dates 固定順序處理；不得以 checkpoint 或總筆數略過中間缺週。
- [x] 4.3 將 published、`pre_listing`、`not_published` 與 retryable／blocked 結果逐日期寫入 ledger，並在每批完成後重新投影 symbol 狀態。
- [x] 4.4 維持單一併發、至少一秒間隔、每 claim 最多 12 週、總時間上限、lease heartbeat、checkpoint 與 oldest-first／公平續跑。
- [x] 4.5 新增 runner tests，覆蓋大立光只 claim 兩個缺週、晶呈科技建立 51 週計畫、部分批次續跑、官方日期含連假、CAPTCHA fail-closed 與相同 item 冪等。

## 5. 修正大戶、散戶與集保戶數副圖狀態

- [x] 5.1 擴充 holder coverage state，讀取官方計畫終點、handoff、expected／completed／missing 與 bounded dates，不再只以 series 點數或錯誤 `completed` 判定完整。
- [x] 5.2 讓大戶、散戶與集保戶數共用同一份 `shareholder-distribution` backfill evidence，分別保留自身 series，但顯示一致的缺週／queue／runner 狀態。
- [x] 5.3 新增「等待背景回補（x/y 週）」、「背景回補中」、「缺少 n 週」及 handoff degraded 文案；最新讀值與「首筆」比較不得取代歷史狀態。
- [x] 5.4 runner evidence 改善時使對應 symbol／dataset cache 失效並重畫；HTTP 空、較舊、較少、coverage 倒退或來源暫時錯誤時沿用 verified-slice 非退化資料。
- [x] 5.5 更新有限輪詢與右鍵立即回補狀態，完成、blocked／failed、切換 symbol、移除 pane 或 controller 銷毀時停止 timer／listener。
- [x] 5.6 新增前端 tests，覆蓋大立光兩個缺週、晶呈科技一週資料、三種 holder panes 一致狀態、新 evidence 重畫、暫時退化保留與跨 symbol 隔離。

## 6. 修復既有資料並完成實際驗收

- [x] 6.1 以唯讀 dry-run 比對全部 active targets 與 TDCC 官方最近 51 週，輸出只含 symbol、coverage、missing dates 與狀態的安全摘要。
- [x] 6.2 在任何本機 D1 寫入前建立只含 TDCC 公開資料表／fetch state 的可復原備份與 digest，不匯出使用者、登入或個人清單資料。
- [x] 6.3 取得當次明確執行授權後，執行 additive bounded reconciliation；先核對大立光建立 `2026-08-07`／`2026-08-14` items、晶呈科技建立最近 51 週計畫，再讓 runner 只補缺週。
- [x] 6.4 逐 symbol 驗證全部 active targets 的官方日期 evidence、零未解釋 missing dates、coverage 起訖、最新快照、queue／lease／handoff 與錯誤狀態，不以全域成功取代。
- [x] 6.5 在本機實際 MultiView 驗證大立光與晶呈科技的大戶、散戶及集保戶數 DOM、Canvas、日期／進度、切頁非退化與 console 零錯誤。
- [x] 6.6 更新 TDCC 操作手冊與本機 runtime 文件，修正「每日 02:15 UTC」漂移，說明週末主同步、隔日重試、五分鐘 queue watcher、手動入口與安全停用方式。

## 7. 品質門檻與部署邊界

- [x] 7.1 執行 TDCC schema／behavior／runner、watchlist prewarm、chip panes、local runtime focused tests，並保留逐案例失敗證據。
- [x] 7.2 執行 `npm test`、`npm run lint`、`npm run build`、OpenSpec strict validation 與 `git diff --check`，確認既有日 K 線 change 與其他 dirty work 未被混入本 change。
- [x] 7.3 以本機 exact working tree 重啟或重新載入 runtime 前先取得對應授權，確認 watcher／週末 jobs、5174 listener 與既有 simulation-only 邊界；普通驗收不得停止行情或其他服務。
- [ ] 7.4 Sites 保留站與 Cloudflare 正式站部署、migration、workflow dispatch、D1 repair 及 protected health 必須分別取得授權與逐環境驗證，不以本機或另一個 deployment 的成功代替。
