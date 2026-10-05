# 2026-10-05 盤中前端修復紀錄

時間均為 Asia/Taipei；真實監控錨點與隔離圖表測試分列。本紀錄不改寫正式擷取收據或其他 change 驗收。

## 實作前安全錨點（11:23–11:24）

- 監控 API HTTP 200：current session 2026-10-05、phase running、revision 9、startedAt `2026-10-05T00:20:04.762Z`；control-plane requested／accepted true。
- API generation `local_rAiZ7VO0u6wi1iX1wWuun9d20ji0SS3k`；160 active／dataActive、0 degraded，evidenceAt `2026-10-05T03:23:07.635Z`、fresh true，brokerWriteAuthority false。
- 原擷取 PID 7871；8080 PID 1503、5173 PID 914、5174 PID 921。
- host runtime status：simulation、business session／2330 Snapshot available、watchdog healthy、restart_count 0、production stopped、write master disabled、active obligations 0。
- 受限 sandbox 的 status 曾顯示 listener down，與 host lsof 矛盾；以核准的 host 唯讀 status 及實際 listener 交叉確認正常，未重啟任何服務。

## 根因失敗測試（11:24）

- 實際 `aggregate` 的 3 項新測試失敗：陣列／物件別名、三分鐘時間 `[60,120,120,180,180,240,240]`、同分鐘 volume 應 103 卻成 106。
- 以上為合成事件的隔離測試，不代表供應商重複或 live 驗收。
- 改為逐根複製後，時間／所有權、快取與提交完整性 17 項測試通過；Node 24.19.0。

## 第一輪修改後安全錨點（11:27）

- 同一 generation、session running／current、160 dataActive、0 degraded，evidenceAt 已前進至 `2026-10-05T03:27:07.757Z`，fresh true，brokerWriteAuthority false。
- 型別檢查 `tsc -b` 通過。HMR 後原主頁仍顯示 3090，局部 K 線錯誤日誌為空；尚未以此宣稱完整 live 驗收。

## Chromium 與相關回歸（11:34–11:41，隔離來源）

- Node 24.19.0：16 個單元／整合檔、134 項通過，包含價量共同契約、成交值及 residual、readout、日 K drilldown、CDP／三關價／Pivot Point、支撐壓力及 Fibonacci。
- 真正 headless Chromium：3 個檔、35 項通過；新增元件測試 6 項。使用 mock REST／合成 Tick 並封鎖其他 fetch，沒有 broker login／訂閱／真實交易。
- 同分鐘 raw／display 各為 103 張、1,030,000 元；重播／舊分鐘拒絕。跨 09:01、09:02、09:03 三個邊界後 raw／display 皆 4 根，再走 1m→5m→1m→1D→1m，無重複時間或崩潰。
- 污染當前 key 為 miss、其他 key 原值保留；只計算 endDate 為今日的 bootstrap，恰好一次。可見範圍觸發的正常 history prepend 與 bootstrap 分開計數。
- prepend 後 62 根含有效 live tail；同分鐘下一筆量為 2 張、成交值 20,000 元，證明 lastBarRef 指向重新提交的尾棒；scrollToPosition 平移前後 barSpacing 均維持原值。
- 舊商品延遲 response 在新 generation 被拒絕。真正 candle series 的 setData 注入例外後僅一次 rollback，資料精確等於前次有效系列，局部 alert 可見，週期按鈕仍可操作。
- 保留測試迭代失敗：初次 sandbox EPERM；初版 mock importOriginal 循環依賴卡住後只取消自建測試程序；bootstrap 計數初版誤含 history；setVisibleLogicalRange 初版測試誤將縮放當平移。修正測試後 35 項通過，最終無未捕捉例外或 React act 警告。失敗截圖位於本機 `src/components/__screenshots__/candle-chart-integrity.browser.test.ts/`，不作 live 成功證據。
- `tsc -b` 通過；Vite build 通過（原有 >500 kB chunk 警告）；strict validation 通過。最後 whitespace 檢查另列。

## 實際頁面與安全複核（11:32–11:41）

- 不手動 reload，使用既有 HMR 與已選取 3090，切 1m／5m／1m，整頁保持正常；1m raw／display 都為 413 根，再正常查詢刷新至 420 根，最後來源分鐘 11:40，時間軸狀態 valid，兩邊尾棒均 1 張、174,500 元。
- 11:41:27 監控 API 同 generation、same current session、running、160 dataActive／0 degraded；fresh true，evidenceAt `2026-10-05T03:41:06.695Z`，brokerWriteAuthority false。
- 原擷取 PID 7871，API 1503／Web 914／MultiView 921 均未變；business watchdog healthy、restart_count 0、2330 Snapshot available、production stopped、write master disabled、active obligations 0。
- 共用串流唯讀診斷：sourceCreated 2／sourceClosed 0；data 及 contract_event 兩條既有來源各 portCount 2、open 1、readyState 1、watchdogRestarts 0、acceptanceInterrupts 0。11:39→11:40 data tick_stk 計數 202603→202718，來源仍推進。
- 只啟用既有 3090 五分鐘／32 筆唯讀事件觀察，不另開 SSE、不中斷、不新增訂閱。該觀察目前 ticks 為空，沒有 chartLastAcceptedTrade；歷史查詢的較新分鐘不能冒充單次真實 SSE 增量。因此 4.2 保留未完成。
- 局部 K 線 warn/error 查詢為空；其他既有帳務錯誤不在此 change 範圍，不宣稱整頁零 error。主圖修復畫面已在本輪工具輸出檢視，未上傳其他第三方。
- 已向使用者提出改用 2449 的有界驗收方案，最多兩筆既有 Tick／BidAsk 訂閱、沿用同一 login／行情連線、完成切回 3090；尚未取得該輪授權前不切股。

## 最終核對（11:45–11:49）

- 真實 3090 主圖完成 1m→5m→1m→1D→1m，1m 最後 427 根，raw／display 尾棒皆 1 張、174,000 元，來源分鐘 11:47，無局部 alert／K 線 warn 或 error；這仍是查詢刷新，並非單次 SSE 增量證據。
- 已復原原 3090／1D（321 根、timeline valid），觀察輸入清空、五分鐘事件觀察停止；清單、訂單與交易草稿未操作。沒有手動 reload、額外 broker 訂閱或服務重啟。
- 串流最後擷取仍 sourceCreated 2／sourceClosed 0、portCount 2／open 1／watchdogRestarts 0；tick_stk 計數前進至 203140。沒有因本輪驗收重建 SSE 來源；供應商實體用量仍 unknown，不把頁面計數冒充實體用量。
- 11:47:57 API 同 session／generation、160 active／dataActive、0 degraded；evidenceAt `2026-10-05T03:47:07.208Z`、fresh true、brokerWriteAuthority false。前端錯誤修復沒有停止今日原正式擷取，不據此宣稱監控的全日或跨日驗收通過。
- 最後型別／build／strict／git diff --check 通過；新增 OpenSpec 與程式文字 10 個檔案 whitespace／末行換行檢查通過。沒有 archive／commit／push；其他 dirty work 保留。
- 保存畫面時初次 /tmp 路徑受到測試 Vite fs 限制，未放寬安全政策；改存專案測試截圖路徑。首次 fixture 容器缺少 flex／主題，後補容器及 canvas 可見高度斷言、足夠 viewport；本機舊截圖保留，合成畫面不是 live 實證。

## 待完成

- 既有連線 3090 的短時間真實事件與週期切換、至少三個分鐘邊界及單次價量增量證據。
- tasks 13/14；唯一保留為 4.2。即使前端離線測試通過，未取得單次 live 證據前不宣稱可歸檔，也不替代固定 160 檔的全日驗收。
