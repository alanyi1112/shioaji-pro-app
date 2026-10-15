# 2026-10-13：即時門檻接線及17:05盤後驗收

時間均為 Asia/Taipei。使用者明確授權：「允許，待原採集完成後受控載入」。原13:35採集自然完成後才修改共用runtime／API／UI；沒有中止原採集、另建owner、代跑下載器或人工audit，沒有production／CA／下單／新broker login。

## 原生翌日基準與同鍵重用

原scheduled PID72336的attempt-01於16:14:31.346完成159／160 partial，3017.TW來源失敗；原件保留。原程序有界冷卻後自然attempt-02於16:29:31.667完成10/13→10/14的160／160，第二次只追加1請求／16,996 response bytes。不是人工補跑，原13:40當時collecting的收據不改寫。

17:09:52唯讀重新驗全部manifest的正式schema／hash／日期／270封閉分鐘，160份均成立，TSE121／OTC39，closeMode均normal_or_revised_13_30。每檔獨立closeTotalCheck=not_observed；這是有效基準與已記錄品質，不代表已做獨立總成交量對帳，亦不代表當日live完整。

原檔根目錄：`/Users/alanyi/Library/Application Support/RealTimeStock/IntradayMonitor/daily-minute-volume-collection/2026-10-13`。

- attempt-02-receipt.json：SHA256 `93d36455aaa5b7c337ab45254c7838fa2b64ec118c704d3259bb2ca6eb698b57`。
- attempt-02-claim.json：SHA256 `8c8907cc1b1224e14c2d33200662d4a8be240f5f345bcf304f6f218b1c69a8c6`。
- attempt-02-same-key-noop.json：state=same_key_noop_verified、originTrigger=scheduled、originalOwnerPid=auditOwnerPid=72336、sameOriginalProcess=true、count160、新下載0、新reservation0。重新核evidenceHash、原claim／receipt hash及repository revision全部一致，逐檔manifestBytesHash全部一致。這是同一原程序完成後第二次collector重用，不是第二個獨立排程。
- 真正postclose官方日曆於13:35:08.591自然保存；hash `9dd22c03831ebe790c496356dcec00cfad324c98cefb3f98bf1d4a3b4581b462`，與08:47 operator-repair分開。

因此7.2可依真實證據完成。10/13 live仍是0 complete／160 partial、13:30:16提早停止與原13:40 coverage_incomplete，不能追認；7.4不勾。

## 程式接線

- 啟動時凍結原source session revision／名單，原owner另建立0600 SQLite threshold journal。只有同session／owner／generation／日期及門檻差異的hash proof可保持source authority；名單、排序、停用、來源改動仍不能取得熱切換資格。沒有全域取消revision Gate。
- 專用PUT `/api/intraday-monitor/v1/threshold`限1.5／2／3，expectedRevision CAS及idempotency；只讀正式名單改全域門檻，不提交UI草稿items。普通儲存的合法個別門檻變更亦由同一threshold-only proof／controller處理。
- 原daily runner每秒唯讀本機config revision，封閉observation入口亦查核；沒有新增broker HTTP、SSE或subscription。先原子保存不可變切換收據，再換比較epoch；收據失敗保留上一有效門檻，合法行情仍持續SQLite寫入。逐檔封閉水位靜默重判；新符合結果標「門檻調整後符合（不補發通知）」，原trigger不刪改。
- API／UI分列saved、active、pending、failed及effectiveAt。pending每秒有界查本機status，ack後立即唯讀刷新結果；個別覆寫優先，未受影響的epoch不重置。closing沿用原期限與freshness，但API通知Gate只在running成立，避免metadata或收盤來源重開通知。
- adapter保留合法sink拒絕原因，runner健康檢查收集比較故障與實際degraded原因，不再來源仍流動就假稱healthy。沒有原始上游證據仍不斷言券商未送尾棒。
- read-only完整收據chain可重建比較core，測試證實零重新寫入／通知。這不授權第二owner或同日重新登入；runtime registry原排他限制不變。

## 回歸及正式載入

21項Node24 controller／journal回歸通過。70項Vitest涵蓋API CAS、owner-bound source compatibility、sink、runner與adapter：實際隔離SQLite2→3→1.5切換保留原session revision及每分鐘留存；再以SQLite拒絕切換INSERT模擬持久化失敗，active仍1.5、saved3，下一封閉分鐘仍保存且不補發通知。完整22項Chromium面板回歸通過，包含2→3→1.5、pending不假生效、草稿7倍保留、不PUT全名單及零fixture broker請求。

第一次把Vitest檔交Node runner造成2個測試入口錯誤，改用正確Vitest後通過；sandbox暫時fixture HTTP server遇EPERM，授權隔離loopback後通過，非正式服務故障。新browser測試最初act警告已修正，後次完整22項無該警告。Node24型別／Vite build通過，原chunk>500kB警告保留，不冒充無警告。

正式17:21:08的status／config唯讀確認：dailyExecution=partial、翌日nextBaseline=ready160、savedRevision10、savedThreshold3、items200、通知權限false；thresholdSwitch=unsupported_runtime、active/effectiveAt=null。今日舊runner已結束且沒有新journal，不能冒充今日已即時套用；明日原排程新程序會載入候選接線。

受控載入後Web924／API55152／MultiView75897 PID不變；原collector72336已正常退出。simulation business session／2330 Snapshot available、watchdog healthy且restart0、production stopped、write master disabled。沒有主動點股／切週期／加入清單／按正式門檻，原3倍偏好未更動。瀏覽器在這批修改中可能由Vite重連／重載；未保存逐請求錨點，不能宣稱瀏覽器既有商品重要求或重載次數為0／恰1。

實際頁面已可見三快捷按鈕及「保存不代表當日已生效」；載入前圖表為2449／1D，載入後曾見等待商品及0050／5m，故不宣稱圖表目標完全復原，也未為驗收主動選新商品。即時門檻功能不依賴圖表可見性。畫面保存於本機 `/private/tmp/intraday-threshold-controls-2026-10-13.jpg`。

## 尚待真實盤中

8.6要在下一官方共同交易日，以原唯一owner實際切1.5→2→3→1.5並保存來源／量比公式／比較收據／SQLite不中斷／API與UI／零新login及broker額外subscription／通知去重證據；測試與盤後UI不能代替。切換前保存當時全域門檻，完成後精準還原，不能覆寫草稿或名單。

7.4仍需真實全日封存及13:40獨立稽核，特查2603、5284、3533、6426、3665、6239及未知上游範圍；7.6待完整dossier後才完成。strict／diff及122份新增文字whitespace核對通過，8.5完成，現行46／49。不歸檔、commit或push。

最後唯讀核原daily summary、13:40 failure audit及08:50 receipt的SHA256與14:05記錄完全一致，沒有倒填成功。既有驗收heartbeat已更新為46／49及上述剩餘三項，原台北時間08:05／09:05／14:05／17:05檢查點不改，不新增下載排程。17:33讀回scheduler顯示原17:05 nominal slot尚有17:33:59補觸發，不能說實際一定準時；不把排程延後冒充新的驗收結果。
