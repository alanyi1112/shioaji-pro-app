## 1. 契約、fixtures 與 feature gate

- [x] 1.1 核對 `use-free-pe-river-data-sources` 已提供 latest-first runner、FinMind budget、官方 daily adapter、D1 trust order 與 private workflow；只補本變更缺少的 provisional 行為，不複製五年 history lane。
- [x] 1.2 新增不含秘密的 TWSE／TPEx 官方落後、FinMind 較新、官方追上相符、`0.01` 邊界、`0.011` mismatch、官方無有效 P/E、盤中與超過三個 sessions fixtures。
- [x] 1.3 建立預設關閉的 provisional latest feature gate 與安全設定：Asia/Taipei 18:30 當日閘門、14 日曆日 request 上限、三個 completed sessions 上限；設定不得從前端任意改寫。
- [x] 1.4 更新資料來源研究／操作文件，記錄本變更只使用 FinMind 與官方 OpenAPI、不呼叫交易所日期查詢網頁、不把 provisional 稱為官方及 private／custom 授權邊界。

## 2. Provisional candidate 正規化與計算核心

- [x] 2.1 實作 bounded FinMind latest request，從官方實際 `sourceDate` 查至 Asia/Taipei 當日，依 `sessionDate` join `TaiwanStockPER`／`TaiwanStockPrice` 並沿用全域 request budget、timeout、payload size 與安全錯誤碼。
- [x] 2.2 實作 `finmind_provisional_latest` candidate 純函式，驗證 exchange、canonical symbol、同日有限正數 P/E／close、18:30 completed-session gate 與最多三個 session 上限。
- [x] 2.3 實作 provisional reference EPS 與河流點計算，只套用既有 verified P10／P30／P50／P70／P90 multiplier，不把 provisional P/E 納入 percentile 或 252 筆門檻。
- [x] 2.4 建立 candidate／計算單元測試，涵蓋亂序、重複日期、日期錯配、零負／空值、盤中手動 run、休市、三 session cap 與極端 provisional P/E 不改變 multiplier。

## 3. D1 schema、雙 coverage 與原子狀態遷移

- [x] 3.1 以 additive migration 補上 `finmind_provisional_latest`、provisional dates／created at、verified／display／official source dates、provider quarantine、mismatch difference 與安全 reason 所需欄位，不刪改既有估值或籌碼資料。
- [x] 3.2 擴充 repository trust order 與冪等 upsert，確保 `official_verified` 永遠優先、歷史 `finmind_pending_verification` 不會被誤當 latest provisional，晚到 FinMind row 不得降級官方 row。
- [x] 3.3 分離 `verifiedEnd`、`displayEnd`、`officialSourceDate`、`provisionalDates` 與 verified sample count；provisional row 不得完成 official checkpoint 或誤報 official fresh。
- [x] 3.4 實作 D1 原子 reconciliation：同批完成 valuation row、validation／provider state、coverage 與 job／checkpoint，全部成功後才標示 completed；失敗可冪等重試。
- [x] 3.5 建立 D1 嚴格 binding／repository 測試，涵蓋 provisional 重跑、官方相符取代、官方 mismatch 取代並 quarantine、官方無 P/E 轉 gap、批次中途失敗不先完成及 verified／display coverage 一致性。

## 4. Latest runner、自動追認與 health

- [x] 4.1 擴充 latest planner，固定依序執行官方快照、既有 provisional reconciliation、新 provisional candidate，最後才允許 history lane；官方日期相同或較新時不得建立 candidate。
- [x] 4.2 實作相同商品／日期的 P/E 與 close 各自 absolute difference `0.01` 核對；相符時以官方數值重算 reference EPS並升級 `official_verified`。
- [x] 4.3 實作 mismatch 與官方 gap 終態：有效官方 row 即使與 FinMind 不同仍取代 provisional；另保存 `source_mismatch` 並停用該商品後續 fallback，官方無有效 P/E 時移除可見 provisional point並保留 gap。
- [x] 4.4 擴充 private ingest payload validation、job claim／lease、bounded retry、retry-after、single-flight 與 source-date 去重，禁止未授權網頁 URL 或完整上游 body 進入 response／log。
- [x] 4.5 更新 private GitHub Actions workflow，使 `schedule` 與 `workflow_dispatch` 都能執行 provisional／reconciliation，並確保 FinMind 額度接近上限時停止 claim 新 target而非 busy loop。
- [x] 4.6 擴充 health／per-symbol state，分開回傳 official fresh、provisional pending、provisional capped、source mismatch、retry waiting、verified end、display end、official source date 與最近成功時間。
- [x] 4.7 建立 runner／workflow contract 測試，涵蓋官方延遲、下一 run 追認、mismatch quarantine、休市 heartbeat、schema drift、429／5xx retry 與完成狀態原子性。

## 5. 河流 API 與前端可見行為

- [x] 5.1 擴充河流 API 的 `sources`、`coverage`、`warnings`、`backfill` 與 `provisional` metadata，只回傳必要單日值與衍生點，不提供五年 FinMind 原始資料 dump。
- [x] 5.2 在主圖以降低透明度、虛線尾端或等價可辨識樣式繪製最多三個 provisional sessions，時間／價格座標仍與 K 線對齊且 `pointer-events: none`。
- [x] 5.3 擴充 status 與 pointed-date readout，顯示「FinMind 暫代本益比」「暫定參考 EPS」「等待交易所確認」、provider、暫代日期與最後官方驗證日期；不得補造 fiscal year／quarter 或稱為官方值。
- [x] 5.4 實作追認、mismatch、取消勾選、切換商品／週期與晚到 response 的 latest-wins 清理，確保 provisional 線段、band、warning、poll 與 readout 不殘留。
- [x] 5.5 更新完整 panel PNG 匯出，使畫面存在 provisional tail 時保留相同線型、透明度、來源、最後官方日期與警示；未啟用或無資料時不得出現殘影。
- [x] 5.6 建立 API／DOM／繪圖／匯出測試，涵蓋 verified 與 display coverage、provisional label、固定 percentile、gap、1／4／8 圖、快速切換與 PNG clone。

## 6. 真實排程、正式站與完成驗證

- [x] 6.1 執行完整單元、integration、D1、Worker 與前端測試，以及 `openspec validate add-provisional-pe-river-latest-fallback --strict`、全專案 strict validation 與 `git diff --check`。
- [x] 6.2 在本機 D1／測試環境重演「官方 D-1、FinMind D」並驗證 `verifiedEnd=D-1`、`displayEnd=D`、percentile 不變、API／UI 明確標示 provisional。
- [x] 6.3 啟用 feature gate 後手動執行一次 private workflow，保存不含秘密的 run、heartbeat、target、source dates、provisional pending、budget 與 D1 row 證據。
- [x] 6.4 在真實後續 `event=schedule` 或官方 OpenAPI 到齊後驗證自動追認；確認相符時 row／coverage 原子升級，或 mismatch／官方 gap時依規格取代、隔離且不偽造官方狀態。
- [x] 6.5 發布至 private／custom Sites 後，以已登入瀏覽器驗收上市與上櫃普通股的單圖、4／8 圖、readout、warning、快速切換、重新載入與完整 panel PNG，並核對 live API／D1／workflow source date。
- [x] 6.6 更新 change verification、專案工作紀錄與必要操作文件，記錄實際日期、測試數、workflow／Sites 證據、剩餘風險及是否需要再次等待官方追認；不得寫入秘密值。
