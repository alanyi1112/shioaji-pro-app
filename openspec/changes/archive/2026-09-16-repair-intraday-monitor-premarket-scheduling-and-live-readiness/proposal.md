## Why

2026-09-15 的 exact 160 盤中驗證同時暴露兩個會使完整日失效的缺口：08:45 heartbeat 雖以 `Asia/Taipei` 建立，排程器卻把本地時間當成 UTC，主流程沒有觸發；人工於 08:49 冷啟動後，系統又把批次訂閱已接受誤報成 160 檔資料已 active，直到 09:11 才收到第一批 09:10 KBar，造成全 cohort 缺少 09:01–09:09。

這些問題必須在下一次正式交易日驗收前修正，讓盤前啟動、逐檔資料就緒、開盤缺口復原及操作回報都有可稽核證據，避免再次以控制層成功冒充行情資料層成功。

## What Changes

- 所有使用者時間與交易日排程一律以 `Asia/Taipei` 解讀；建立或修改排程後必須讀回 scheduler 計算的實際 `next_run_at`，換算為台北時間並驗證，不接受只核對 RRULE 文字。
- 將關鍵盤前啟動改為本機 durable scheduler 主責，Codex heartbeat 負責監督、診斷與回報；兩者使用相同 run registry 與 single-owner claim，禁止重複啟動或重複訂閱。
- 把 simulation API 暖機、business session、2330 Snapshot、160 檔 KBar data-plane canary 與正式 capture 分成明確 Gate；不得在逐檔收到權威事件前宣稱 `active`、`confirmed` 或 `boundedTransportReady`。
- 讓產品狀態區分 `subscription_requested`、`awaiting_first_kbar`、`active`、`degraded`，並以已收到本交易日 KBar 的唯一商品數計算 `dataActive`。
- 09:02 起檢查 09:01 KBar；缺少時立即回報並啟動一次性、有界、唯讀的同來源 REST KBar bootstrap。bootstrap 必須保存來源、範圍、hash、接收時間、與 SSE 重疊分鐘一致性及逐檔完整性證據。
- bootstrap 只能補上服務啟動或 SSE 重連缺口，不得補造零成交。來源覆蓋、單位、交易日、逐檔身分或 SSE 重疊不一致時 fail closed，該日不得取得完整日資格。
- 保留 Shioaji simulation API、正式 capture 與 scheduler 的本機輪替日誌；回報每個 Gate 的台北時間、scheduler run id、API generation、subscribe receipt、第一筆逐檔 KBar、缺口與復原結果。
- 修正監控規則：主排程未建立 run、computed fire time 偏移、09:02 尚無 09:01、160 檔未全數收到第一筆 KBar 或 failure sidecar 出現時，必須立即通知，不能因 `dataActive` 預設值而保持安靜。
- 封存與完整性判定不得把所有個股的收盤硬編碼成 13:30；個股若有延後收盤或收盤競價延遲，必須依權威逐檔收盤證據延後封存並納入驗收。
- 盤中功能驗收新增受限收盤尾端例外：只要 09:01 live canary 為 160／160、盤中連續性與功能 Gate 全數通過，且少於 5 檔只缺最後連續至多 5 分鐘，系統可在收盤後以同來源歷史 KBar 雙抓一致、完整 270 分鐘並與既有 live 累積量前綴完全相符後核准；補回列必須標記為 historical、不得冒充 live 或產生通知。
- 增加時區偏移、冷啟動、預開盤訂閱遺失、部分商品無第一筆 KBar、REST/SSE 不一致、重連缺口與完整 160 檔復原的 unit、integration 及本機 rehearsal 驗證。

## Capabilities

### New Capabilities

- `intraday-monitor-premarket-readiness`: 規範台北時間排程、durable 盤前啟動、KBar data-plane 就緒、開盤 canary、權威缺口 bootstrap、日誌與操作回報。

## Impact

- 影響 `scripts/realtimestock-runtime`、盤前 scheduler／LaunchAgent、`scripts/intraday-monitor-runtime/` 的 transport、product runtime、capture runner、bootstrap、run registry 與 evidence repository。
- 影響 `/api/intraday-monitor/v1/status` 與盤中選股面板的 capacity／item state 語意，但維持現有 simulation-only、通知關閉、broker write 禁止及 active limit 未核准前維持 20 的邊界。
- 影響 Stage 160 收盤審閱：原始 live capture 維持不可改寫，另建立引用來源 capture hash 的尾端回補審閱 artifact；只有新政策全部 Gate 通過才可產生 derived acceptance、bundle 與 activation。
- 新增本機日誌與排程／canary evidence 檔案；不得記錄帳號、token、API key、憑證或其他秘密值。
- 2026-09-15 capture 已於 13:34:30 結束並正確維持 NO-GO／active limit 20：正式資料只有 09:10–13:30，共 41,752 筆；156 檔各 261 筆，2395.TW、3023.TW、3680.TWO、6770.TW 各 259 筆且止於 13:28。當日缺少開盤 09:01–09:09、四檔收盤尾段及被動圖表 evidence，不得回填成正式 live 完整日。
- capture failure sidecar 實際建立為 `capture-2026-09-15.json.failure.json`，既有監督卻檢查 `capture-2026-09-15.failure.json`；本 change 必須統一 sidecar contract，避免檔案存在卻被監控誤報為不存在。
