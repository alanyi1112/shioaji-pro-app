# 2026-10-13 14:05 真實收尾檢查點

時間 Asia/Taipei；唯讀查核至14:11:18。14:05時正式專案唯讀，本紀錄先另存允許位置；16:09恢復可寫後同步此正式acceptance。未重啟服務、訂閱、登入、代跑下載或稽核。

## 結果與根因

- 原daily runner於13:30:16.046提前partial收尾，closeReceipt=null，未到13:34:30封存。160檔全部partial、reason=observation_sink_rejected；不能宣稱今天完整成功。
- 正式SQLite保留09:01–13:02各160份，共38,720份observation，113筆trigger仍留存。最後accepted event13:03:07.408；來源reader至13:30:14.981仍收資料，43,113個frame、7,502,122bytes，delivered38,880包括forming，不等於38,720持久化筆數。
- 正式config audit id2於13:03:48.866由UI保存globalThreshold=3、revision9→10；diff僅globalThresholdChanged=true，added/removed/enabled/reordered/per-item threshold均無變動。session與已啟動runner綁定revision9。
- 以正式保存session、approval及hash驗證bundle，純唯讀重算13:04:00權限：savedRevision9為current=true；savedRevision10為current=false且唯一原因config_revision_mismatch，evidence仍fresh（52,584ms）。這是離線原因重算，不是新增live或成功修復。
- daily session authority每筆比較當前savedConfigRevision與session revision；sink拒絕後adapter泛化成observation_sink_rejected並逐檔鎖degraded，失去真正原因。13:30:15轉closing仍需current，因此提前partial stop。health只查來源與resources，未留下寫入停止的incident；待修正診斷出口。
- 目前status HTTP200、reason=config_revision_mismatch，session current=false，saved10/session9，新通知權限false。HTTP200不是監控正常。

## 資源與尾盤來源可觀測限制

peakRSS111,198,208bytes，最大event426ms、slowEvent0、resourceFault=null、剩餘磁碟315,490,430,976bytes；未見資源不足或背壓證據。stream disconnect=null、sourceGapEvents0、reportedDroppedFrames0；這不證明上游絕無漏送。

reader13:29有160檔、13:30有73檔、13:33無。2603/5284/3533/6426/3665只有13:29；6239收到13:30量582張。runner13:30:16已停止，不能將剩餘87檔或13:33未知歸因於券商未送；本日不能用來確認既有兩檔尾棒問題已解。

## 原始檔與雜湊

資料根目錄 `/Users/alanyi/Library/Application Support/RealTimeStock/IntradayMonitor`。

- `daily-run/2026-10-13/summary.json`：f5e0f70cc9a05a24e8301a05bc99629065f14d073cbaf75eb470884b9c1a377e。
- `failure-audit-runs/2026-10-13-2026-10-13T05-40-00.933Z-9ac504c3-b2d2-407a-9b73-d7d448a66b72.json`：bc08f4c4d401662ef3cd7aff7d4825316856d92642be0d6254246b3d9e228b88；原13:40 coverage_incomplete，complete0/partial160，nextBaseline collecting。
- `premarket/receipts/2026-10-13-0850.json`：0018e9b3a430b3204f7c906bf39d84994ffcbdc6f9282959a17c0d7c08298b46；原08:50程序完成時rolloverOutcome=failed，reason=daily_minute_volume_execution_failed。啟動成功與全日結果分開，不改判。
- local-alerts原08:50與13:40已交OS、userSawNotification=null；不能宣稱使用者已看到。兩檔hash：99562b8a2c7fcc4674d2174b55f2973932b1328e9211de7f58318b7048181765／22e9f45af3f08a21c0bd70432a8001654788525fa54903bf113935bd8be169cd。
- config audit previous_hash0533c0141c9853b30820a76f4f3b03ec8951aec90932b06af032a997d8ca2458／next_hash371c8c1220151ef3ccd2672e093d499cee072db880dd644a4026825e4d94ff8b。

## 原生盤後採集（獨立於live）

- 原13:35attempt01 claim時間13:35:08.741、PID72336仍在工作，同generation simulation:5fcbe46f-2eec-40f1-abf4-326280089f09，source10/13→target10/14。
- claim hash3d605d2fd4bf67fadcf4274bcaa942deee9c77c22860b59dc874a92422445636。
- 14:11:18已保存37/160份manifest，revision677；尚無complete receipt或same-key-noop收據。只報collecting，不代跑或提前勾7.2。
- 原程序已真正自動保存postclose官方日曆13:35:08.591，10/13→10/14，hash9dd22c03831ebe790c496356dcec00cfad324c98cefb3f98bf1d4a3b4581b462；與08:47 operator-repair分開。

runtime唯讀：simulation、business session及2330 Snapshot available、watchdog healthy/restart0、production stopped、write master disabled；Web924/API55152/MultiView75897未重啟。

## 推進結案的下一步

目前仍40/43，7.2/7.4/7.6未完成。17:05繼續核原生160基準與same-key-noop，不把盤後補件升格為live complete。

修正建議：隔離active session凍結設定與新保存設定，門檻變更明示下次session生效，名單/停用維持原安全規則；保留拒絕根因與健康事故，避免來源仍流動時假健康。不得單純移除版本Gate或回滾使用者3倍門檻。已向使用者提出生效策略選擇與恢復repo可寫需求；正式修正尚未實作。

## 16:09 盤中即時門檻候選核心

使用者已明確選擇「盤中立即生效」，並要求1.5／2／3倍均可切換；不採下次session才生效。專案已恢復可寫，14:05暫存診斷在此同步正式acceptance，原runtime失敗檔與hash不變。

已補proposal／design／daily-runtime及UI規格、tasks第8節6項。新增不在Vite config相依鏈的`threshold-switch-controller.mjs`，沒有HTTP、subscribe、login或服務生命週期port；僅提供純有界CAS切換、同步durable ack注入、逐檔封閉水位與比較epoch。只有門檻差異可切換，名單結構差異拒絕；先持久化確認後才原子套用。切換以最後已核實分鐘靜默重判，下一真正穿越依原notification Gate／去重；個別覆寫未改則保留原epoch，源身分／零分母／unknown仍拒絕。持久化／CAS失敗維持上一有效門檻，不回寫任何舊observation或trigger。

16項Node24候選核心測試通過，包含1.5→2→3→1.5、160檔有界原子準備、個別覆寫、兩分頁CAS、同鍵no-op、persist拒絕／wrong hash、來源身分、closing、stale／unknown與通知去重。第一次14項中1項fixture的生效時鐘早於其09:02:50水位，正確拒絕；將測試時鐘改為09:03後通過，不放寬正式future-time Gate。額外36項Vitest（relative-volume-evaluator、daily-product-sink、current-session-authority、dynamic-config-mutation）及Node24 tsc --noEmit／Vite build通過，只有既有chunk>500kB警告。strict validation與diff檢查通過。

以上是候選及離線回歸，不是正式UI或盤中驗收：8.1／8.2完成；runtime durable journal／session／sink接線8.3、API／UI8.4、整合與受控載入8.5、真正盤中8.6仍未完成。沒有修改共用live模組、reload／kickstart／新登入／訂閱／下單，也未啟動新監控。已請使用者確認在原13:35採集完成後，一批受控5173載入；未有答覆不能假設授權。

任務新增後為42／49，原7.2／7.4／7.6不勾；原10/13 live仍partial，原13:35採集與17:05查核續行，不以核心fixture追認當日成功。
