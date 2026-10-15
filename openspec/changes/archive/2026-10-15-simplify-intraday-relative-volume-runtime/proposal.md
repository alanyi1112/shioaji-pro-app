## Why

日常盤中量比目前由完整 Stage-160 擷取／驗收程序帶動，導致資料已留在 SQLite，卻因收尾報告或資源審閱失敗而把產品狀態一併改成 failed。使用者要求改成「盤後分鐘 K 建立翌日基準＋盤中同分鐘累積量比較」，移除日常運作不必要的全日側錄、重播與報告依賴。

## What Changes

- 新增獨立的日常監控路徑：重用既有 simulation business session、單一有界行情串流、封閉分鐘 adapter、量比公式與必要 SQLite 結果，不再由完整 capture 檔取得正常運作權限。
- 收盤後以當日 Shioaji 歷史 1 分 K 為主要來源，逐商品驗證日期、合約、單位、分鐘完整性、收盤模式及累積量後，原子發布緊接下一適用交易日基準。基準建立不依賴當日盤中是否開機、收齊資料或生成 capture。
- **BREAKING**：日常模式不再要求全日 capture JSON、shadow recorder 的全日重複資料、雙重 deterministic replay、每日 Stage bundle／GO 審閱或被動圖表證據；歷史 Stage 核准與原始失敗證據保留，只作容量及診斷參考。
- **BREAKING**：新增版本化日常基準契約，預設每商品一次分鐘 K 查詢；取消每檔固定雙抓及全日 ticks 下載的正常前置。保留結構／來源／日期檢查、可信收盤總量有則對帳、衝突拒絕、缺分鐘無證據不得補零；不把未做的雙抓或獨立總量對帳宣稱為已驗證。
- 將既有基於 capture 的尾端衍生驗收、重播與報告工具移出常態排程，保留明確的選用診斷入口。盤後若要追查缺口，讀取必要 SQLite observation 與獨立歷史基準，不補發即時通知、不倒填 live provenance。
- 將收尾狀態分為程序正常結束、逐檔 live 覆蓋及翌日基準就緒；選用報告失敗不撤銷先前有效結果，也不吊銷既有容量核准。真正串流／日期／單位／連續性故障仍必須隔離與告警。
- 延用本機盤前、登入後接續與 13:35 盤後排程，移除常態入口對 legacy capture／formal acceptance 的依賴，13:40 改稽核真正日常狀態與基準進度。不新增 Codex 常態排程。
- 精準取消不再可達的日常程式、import、排程參數及 UI 欄位；共享 adapter、動態名單、晚開機、安全 Gate、歷史診斷工具與原失敗檔案不得廣域刪除。
- 10/13 使用者要求全域量比 1.5／2／3 倍在盤中立即生效：將不可變行情 session 身分與可切換比較門檻版本分開，沿用同一 owner／generation／名單／基準，以原子切換收據與真正 runner 確認呈現生效時間；不得因只改門檻而停止分鐘留存、追溯通知或輪替訂閱。

## 10/15追加：收盤尾筆例外與盤後補算

使用者授權日常產品採有界容錯：固定160檔至多10檔僅缺canonical 13:30，09:01–13:29必須全部為連續真實live，且無串流／來源gap／資源／設定故障；待原盤後160份基準完整發布、日期／來源／hash及13:29累積量銜接核實後，使用收尾時已durable生效的逐檔門檻及前日同分鐘合法基準補算。新增「日常運作通過（收盤尾筆例外）」獨立判定，不改原live partial、08:50／13:40原收據或歷史失敗，不宣稱上游根因已修復。補算資料獨立不可變、無通知／下單權限、不寫入live observation或trigger。這項政策從10/15適用，不追認更早日期；不新抓資料、不干擾既有採集。

## Capabilities

### New Capabilities

- `intraday-monitor-daily-runtime`：輕量日常執行、版本化分鐘量基準、非阻擋診斷、資源／傳輸保護與可核實遷移。

### Modified Capabilities

- `intraday-relative-volume-monitor`：日常基準以盤後歷史分鐘量為主來源，與 legacy live capture／嚴格雙抓診斷的資格分開。
- `intraday-monitor-premarket-readiness`：常態啟動、排他 claim 與收尾稽核綁日常 runtime，而非完整擷取驗收結果。
- `intraday-monitor-tiered-capacity-evaluation`：歷史 Stage 資格維持原契約，日常監控不必每天重新完成 Stage 審閱。
- `intraday-stock-selection-workspace`：呈現日常運作、逐檔完整性、翌日基準與選用診斷的獨立狀態。

## Impact

- 主要涉及 `scripts/intraday-monitor-runtime/` 的 capture／daily execution、shadow recorder 接線、盤後 collector／builder／baseline resolver、session／run registry、排程、failure audit、API 投影，以及 `src/components/intraday-monitor-panel.*`、`src/lib/intraday-monitor-api.ts`。
- 新版日常 schema 不得冒充舊 `historical_baseline_verified` 雙抓 manifest、Stage session、bundle 或 live acceptance；舊檔維持唯讀與原 hash。
- 協調四個 active changes：跨日修復、盤後尾端復原、動態名單及晚開機接續。建立逐項保留／遷移／被取代矩陣，不把被取消的驗收要求勾成通過，不自行歸檔。
- 預設容量上限維持既有核准 160／configured 200；不啟用 production／CA／交易，不新增 broker login 或行情連線，不干擾今早 1 分 K、清單、分價量表及資金流向修復。
- 本提案不啟停服務、不更新已載入排程、不 commit／push；正式切換須在回歸通過後，於不重複行情所有權的安全窗口執行並保存證據。
