## Context

目前盤中監控把 Stage 160 容量核准、單日 capture 狀態與產品 current-session 狀態保存在同一份 `direct-160-product-runtime.json`。2026-09-16 驗收完成後檔案停在 `phase=complete_go`、`evaluationState=go`、`tradeDate=2026-09-16`；Vite gateway 仍將這份狀態投影成 `approvedActiveLimit=160`、`controlPlaneSubscriptionRequested=true`，再把非 running phase 的舊商品改成 `outside_session`。因此 2026-09-22 畫面同時顯示歷史 `GO`、訂閱已接受、`dataActive=0` 與部分 degraded。

durable premarket LaunchAgent 確實會在 08:20、08:35、08:45、08:50 喚起，但其 `config.json` 固定為 `tradeDate=2026-09-16`，之後交易日全部以 `not_configured_trading_date` no-op。該設定亦引用已歸檔 change 的舊 active 路徑，若日期問題解除，artifact Gate 仍會因檔案不存在而失敗。現行 configured revision 已由 4 前進至 8，舊 160 檔狀態與新 200 檔設定合併後，11 檔落入 `subscription_confirmation_unknown`、40 檔落入 approved limit，造成 `waitingBaseline=0` 卻有 51 檔 baseline unknown 的誤讀。

既有 simulation API、business-session watchdog、5173、5174、盤後 pipelines 與行情連線正在運作。本 change 不取得 production、broker write、第二個 login 或任意服務重啟權限。

## Goals / Non-Goals

**Goals:**

- 將 durable capacity approval 與每日 live session 狀態拆開，讓歷史 `GO` 只能決定核准上限，不能冒充今天已訂閱或正在收資料。
- 依 `Asia/Taipei` 官方交易日 authority 每日原子建立 session manifest，綁定 trade date、上一適用交易日 baseline、config revision、cohort hash、artifact bundle、API generation 與 scheduler receipt。
- 讓執行期 artifacts 不受 OpenSpec active／archive 目錄搬移影響，且仍可用 hash、schema 與來源稽核。
- 讓 API 與 UI 以可相加、可稽核的狀態回報 configured、admitted、active、waiting、degraded、baseline 與 stale 原因。
- 保留 2026-09-16 的成功、NO-GO、尾端修復與 GO 證據，不覆寫歷史。

**Non-Goals:**

- 不重新驗證或擴大 160 核准上限，不把 configured 200 改成同時 active 200。
- 不證實 provider physical usage、其他 client usage、global ownership、release 或 headroom；未知仍保持 `null`／unknown。
- 不改變量比公式、sealed minute、`common_lot`、尾端修復政策、notification authority 或 trigger ledger 語意。
- 不啟用 production、CA、真實下單、broker write、第二個 Shioaji login，亦不自行啟停既有 runtime。

## Decisions

### 1. 容量核准與每日 session 使用不同持久狀態

建立 durable approval record，保存 `approvedActiveLimit`、evaluation stage、decision、reviewer type、reviewedAt、bundle hash 與安全 unknown 邊界。每日 session record 則保存 `sessionId`、`tradeDate`、`previousTradeDate`、`configRevision`、`cohortHash`、`baselineHash`、`artifactBundleHash`、`connectionGeneration`、phase、逐檔資料狀態及 freshness watermark。

選擇分離而非擴充現有 `complete_go` phase，因為 `complete_go` 同時代表「容量核准已完成」與「capture 已結束」；任何以 phase 推算今日 live 狀態的方式都會重現本次問題。舊 v1 product state 只匯入歷史與 approval，不得直接成為 current session。

2026-10-01 實盤揭露另一處殘留耦合：`createDirect160ProductSink` 在今日已具正式 Stage 160 approval 與 current session 時，仍以昨日可變 product runtime 的 `phase=complete_go` 作啟動前置條件。昨日因驗收側錄失敗標記 `failed`，致今日 08:50 在任何訂閱送出前即拒絕。產品 sink 應由 durable approval 加上今日 current-session authority 判定上限；昨日 capture 成敗只能作歷史證據，不得吊銷已核准上限。既有同一 generation 單次 claim 與訂閱安全規則維持不變，失敗收據不覆寫。

### 2. 每日 rollover 由 durable runner 依官方交易日 authority 建立

08:20 步驟先讀取前一交易日盤後完整驗證、已發布的 `baseline-set.json` 所嵌入的 TWSE／TPEx 年度日曆，不在盤前即時連兩個網站。runner 重新核對 baseline hash、雙官方來源 schema／年份／日期、calendar source version、來源日與下一適用交易日，並以 `Asia/Taipei` 判定今日是否為適用交易日及上一個適用交易日。最新已發布 artifact 不合格時直接 fail closed，不向更舊檔案回退；日曆已過目標日者最多使用七日，尚未到達目標日者最多三十日，以涵蓋長假但不無限沿用。這是「盤後先取得官方資料、盤前讀本機驗證結果」，不是用週末規則猜交易日。若是交易日，runner 以 exclusive claim 產生新的 session manifest；08:35、08:45、08:50 必須讀取同一 manifest 並核對 scheduler computed fire time、API generation 與 artifact hashes。非交易日建立明確 no-op receipt；不得把「config 尚未 rollover」記成 non-trading。

官方資料擷取移到盤後基準建檔。TWSE 官方 OpenAPI 優先，年度舊端點僅作另一個經完整驗證的官方來源；TPEx 官方年度資料仍為必備。遠端來源錯誤只會讓盤後建檔失敗並保存 receipt，不再讓翌日 08:20／08:35／08:45 各自碰運氣。盤前若本機驗證資料缺失、篡改、過期或跨年覆蓋不足，仍保留 `calendar_authority_unavailable`，不能建立 session、訂閱或通知；現有前日基準未完成時也不得把日曆可用誤當量比基準可用。未預告臨時停市無法僅由年度日曆提前得知，因此日曆只代表「預排交易日」，資料面仍需今日合法 KBar 才可宣稱實際監控活動。

2026-09-30 的 08:20 原排程確實執行，當時 TWSE 舊 JSON 端點回 HTML；08:35 雖取得有效來源，現行流程卻因缺少當日 session 失敗，08:45 再遇來源錯誤。此為外部端點與「每步盤前即時抓取」設計相疊的失敗，不是已證實的睡眠／未開機。若 08:20 留下同日 `calendar_authority_unavailable` 原始收據、未建立 session，08:35／08:45 在本機日曆恢復且今日無 capture／訂閱／observation／trigger、完整安全 Gate 與基準均通過時，可用自己的 claim 補建 session。收據須連結原收據 SHA-256、明示 `session_recovered_after_0820_failure` 與 `scheduled0820Success=false`；原始失敗不得覆寫，也不把補救列成 08:20 自動 rollover 驗收成功。補救不啟停服務、不登入、不訂閱；08:50 不補建。

若使用者在盤中修改名單，新的 config revision 不得靜默套入已固定的 cohort。狀態改為 `config_revision_mismatch`，本日 session 保持原 cohort 且停止新觸發，等待下一個合法 session 或經規格化的明確重建流程。

### 3. 執行 artifacts 匯入 archive-stable runtime bundle

將核准所需 cohort、plan、prerequisite 與 verifier metadata 以 immutable bundle 匯入 `Application Support/RealTimeStock/IntradayMonitor/runtime-artifacts/<bundle-hash>/`。bundle manifest 保存原始 repo-relative source、原始 change／archive identity、各檔 SHA-256、schema、建立時間與相依關係；執行期只依 bundle ID 與 hash 解析，不依賴 `openspec/changes/<active-name>/...` 的可變路徑。

不採 symlink 或搜尋 basename fallback，因為歸檔、同名 artifacts 或 repo 移動可能使解析指向錯誤內容。匯入時來源缺失、hash 不符或 schema 不符即 fail closed，不修改既有 bundle。

### 4. Current-session authority 使用完整 conjunct

API 只有在以下條件同時成立時才能回報 today live：

- session `tradeDate` 等於官方 authority 的目前交易日；
- session `configRevision` 等於啟動時鎖定 revision，且 API 明示是否仍等於 current saved revision；
- cohort、baseline、artifact bundle 與 approval hashes 全部一致；
- API generation 與 session generation 一致；
- phase 為 `starting`、`running`、`closing` 之一，且 evidence watermark 未超過該 phase 的 freshness budget；
- control-plane request 與逐檔 data-plane receipt 分開計數。

任一 conjunct 失敗時，歷史 approval 仍可顯示，但 `dataActive`、今日 subscription confirmation、今日 results authority 與 notification authority 必須為 0／false，並回報具體 reason，例如 `current_session_missing`、`session_trade_date_stale`、`config_revision_mismatch`、`artifact_bundle_invalid` 或 `generation_mismatch`。

2026-10-02 全日擷取發現收盤時序的例外：13:25–13:30 為集合競價，正常收盤 KBar 或暫緩至 13:33 的 KBar 必須等到 13:34:30 才封存。當日 160 檔 13:30 observation 全被產品 sink 拒收；session 最後真實 evidence 於 13:30:39 更新，但 13:34:30 仍套用 `running` 的兩分鐘 freshness 預算。正式擷取應在 13:30:15 收盤窗口內、當時 `running` authority 尚新鮮且訂閱已接受時，將同一 session 明確轉為 `closing`。轉換只改 phase 與有界十分鐘預算，不更新真實 evidenceAt；後續合法 observation 不得把 phase 改回 `running`。若當時已 stale、identity／generation 不符、未訂閱或超出收盤窗口，維持 fail closed。13:34:30 封存仍須由同日有效 13:30／13:33 KBar 與逐檔連續性佐證；不得單靠 phase 轉換填補缺分鐘。後續 capture 須以安全白名單彙總 sink 拒收 reason，使 freshness 問題可歸因且不洩漏錯誤原文。原 10/2 failed capture 與稽核收據保留，不事後改寫。

### 5. API 同時投影 approval、session 與資料品質

既有 `/status`、`/diagnostics`、`/results` 維持相同路徑並增加向後相容欄位：

- `approval`: limit、stage、decision、reviewerType、reviewedAt、evidenceTradeDate；
- `session`: authorityTradeDate、sessionTradeDate、phase、current、configRevision、savedConfigRevision、startedAt、updatedAt、staleReason；
- `capacity`: configured、eligible、admitted、dataActive、waitingGate、waitingPilotLimit、waitingCapacity、waitingBaseline、degraded；
- `baselineSummary`: complete、missing、stale、unknown 與實際 baseline trade dates；
- `freshness`: evidenceAt、ageMs、budgetMs、fresh。

既有 `evaluationState=go` 可為相容性保留，但 UI 必須讀取 `approval`；缺少新欄位的舊 server response 一律顯示「歷史狀態／今日未證實」，不得預設 current。

### 6. UI 分開顯示歷史核准與今日運作

容量摘要分成兩群：

1. 「容量核准」：例如 `160 · GO · 2026-09-16 · Codex 代理審閱`。
2. 「今日監控」：例如 `2026-09-22 · running · data active 160`，或 `未啟動 · current_session_missing`。

「訂閱已接受」只能來自今日 session 的 control-plane receipt；「等待基準」之外另顯示 baseline complete／missing／stale／unknown 總數，避免互斥狀態桶被誤當資料完整率。所有互斥 item states 加總必須等於 configured；不在 admitted cohort 的 40 檔仍明確顯示 `waiting_pilot_limit`。

### 7. 驗收以跨交易日真實 rollover 為完成條件

離線測試覆蓋 v1 migration、artifact bundle、交易日判定、revision/generation mismatch、狀態總和與 UI 文案。正式驗收至少跨兩個適用交易日：第一日建立完整 baseline／session evidence，下一日由 durable scheduler 自動 rollover 並在 09:02 後證明 current session、逐檔 data active、同分鐘比較與 results；不得人工改寫日期檔案冒充自動 rollover。

2026-09-30 的 capture 曾因被動 K 線證據檔缺失而在收尾失敗：收集器當時只隨盤中監控面板掛載，標準看盤版面的可見 K 線即使真實更新也無人記錄。改為在主工作區常駐單一收集器，唯讀輪詢 current-session 狀態；僅 Stage 160 今日 `running` 時觀察既有可見 K 線 DOM 的 visual commit，並沿用既有本機證據提交端點。監控面板不再另建收集器。開盤前重繪昨天 K 棒也可能產生新的 visual commit，因此提交前還須核對 `lastSourceTime` 屬於今日 session，且同圖表下一次提交的來源時間嚴格前進。這不新增行情訂閱、broker 操作或圖表載入；沒有真實可見畫布或兩次來源時間前進的更新仍不得建立圖表證據。

2026-10-02 更正驗收邊界：盤中監控是背景功能，正式擷取不應受使用者選擇日 K、1 分 K、其他週期或不開啟圖表限制。開盤大量資料亦可能使圖表渲染落後。後端 `firstKbarAt` 由已接受的合法 Shioaji KBar 事件寫入，`dataActive` 與封閉分鐘 observation 由同一資料面證據推進；這些與畫面 K 棒顯示分離。被動圖表證據只作選用 UI 診斷：收尾記錄 valid／missing／invalid／unreadable，缺失時量測值為 null，不以假數值替代、不阻擋背景收尾。正式擷取之後的 `validateDirect160LiveAcceptanceCapture` 與尾端缺口 `validateCaptureEnvelope` 亦不得再要求圖表 hash；必要的第一分鐘真實資料、串流重連、逐檔資料、replay、freshness 與安全 Gate 仍嚴格驗證。10/2 08:50 已在執行的舊程序不會熱載入此變更，當日收尾需依原程序實際結果查核；原失敗證據不改寫。

### 8. 前一適用交易日收盤後自動建檔

既有 `collect-direct-160-baseline.py` 與 `build-direct-160-baseline.mjs` 已能從 Shioaji 歷史 1 分 K 累計 270 個封閉分鐘，經雙抓 hash、契約／單位、官方交易日、逐筆每分鐘及終量核對後產出 `baseline-set.json`。收盤後唯讀排程只在 `Asia/Taipei` 當日 13:35 後、官方 authority 確認適用交易日、runtime 為 simulation 且既有 business session 可用時採集。啟動所需額度由目前 provider `limit_bytes` 的 25% 保留額，加上「相同 cohort、最近 30 日、至少兩筆完整驗證」實測採集用量最大值的三倍推得；樣本、來源身分或 quota 欄位不足即 fail closed，不再使用固定 256 MiB 起跑線。所有估算數值與樣本雜湊寫入不可覆寫 budget receipt，不能把 `connections=1` 推論為 provider physical ownership。

採集器必須讀取同一次 attempt 的 budget receipt，核對 cohort／交易日／provider limit，每個資料請求前重新讀取 provider usage，確保剩餘額度至少涵蓋動態保留額與單次回應上限；每完成一檔再以剩餘檔數和預測每檔用量檢查完整採集的可行性。保留既有串行間隔、單請求 timeout、30 分鐘總期限、8 GiB 磁碟保留與逐筆／雙抓驗證；超過預算時停止並保留 partial，不發布 baseline。

每天最多三次嘗試：13:35 首次、14:15 與 14:55 有界重試。後兩次只在前次已有完整失敗 receipt 且原因可恢復時啟動；前次 claim 尚無 receipt、已有可用 baseline 或達上限時 no-op。每次獨立來源與 staging 目錄、append-only claim／budget／成功或失敗 receipt；舊版 2026-09-23 首次失敗證據原樣保存，不能覆寫、改日期或把人工重試冒稱排程成功。只有 160 檔都驗證、cohort hash 與官方日期完全吻合時，才把 staging 目錄原子發布到 premarket 的精確日期路徑。來源失敗、流量不足、官方日曆不可用、partial 或 hash 不符時保持 `baseline_missing`。圖表 UI／IndexedDB 可視範圍不作為正式基準來源。

若指定來源日的當日排程已失敗，且下一適用交易日尚未到來，可由使用者明確要求執行**事後歷史補建**。此路徑只接受過去 1–30 日的明確來源日期、當前重新抓取的 TWSE／TPEx 官方日曆判定來源及下一交易日、同一不可變 160 檔 cohort、既有 simulation business session、實測用量動態預算與 8 GiB 磁碟保留。採集器需明確 `--historical-backfill` 才能讀取過去日期，仍維持 30 分鐘期限、單回應 16 MiB、逐次額度檢查、串行間隔、雙抓與逐檔 270 分鐘／ticks 完整驗證。補建的 claim、budget、來源、驗證與 receipt 使用獨立 namespace，最多三次有界嘗試；原 13:35／14:15／14:55 claim／receipt 一律唯讀保留，不把補建標為 scheduler 成功。僅驗證 160/160 且目標交易日仍在未來時，原子發布既有 premarket 精確路徑；開盤當日的 session 建立與盤中驗收仍必須由真實排程完成。

Shioaji 歷史 KBar 可能省略當日零成交分鐘。補足缺口前須由同日 RangeTime ticks 證明該分鐘成交量為零，並維持 KBar 全日量與 ticks 全日量一致；缺分鐘有非零 ticks、雙抓不一致或總量不符，一律拒絕，不能為湊足 270 筆填假成交量。

### 9. 開盤前 generation 換代的受控恢復

08:20 session 所綁 API generation 若在 08:35／08:45 前換代，正常 Gate 仍先回報 `generation_mismatch`。只有當原 session 尚無 control-plane request／accept、160 檔均未訂閱且無第一筆 KBar、phase 僅為 `waiting_baseline` 或 `starting`，且當次 simulation API／business Snapshot、官方交易日、config revision、cohort／bundle／approval hashes 全部重新核對時，runner 才可建立 append-only generation transition receipt，再將同一 session 推進至新 generation epoch。舊／新 identity hash、generation、排程收據與失敗紀錄須可稽核；重複執行同一 recovery 必須冪等，轉換後再重新跑完整 Gate。08:50 是資料擷取啟動關卡，若屆時才發現換代，一律 fail closed，不在同一步驟換代並啟動訂閱。已有任何 data-plane、subscription、trigger 或無法確認其不存在時不得 rebind，維持 fail closed。此機制不得回頭修改 2026-09-23 的 08:35／08:45／08:50 原始失敗收據。

### 10. 正式擷取預檢與同日失敗通報

2026-09-30 的 `capture_failure_sidecar` 於 13:34:30 已記錄缺少被動 K 線證據，並標為 `alertEligible=true`，但 operational log 並無通知送出器；直到次日人工查核才揭露。`alertEligible` 只能代表值得警示，不得被說成已通知使用者。正式擷取在 2026-10-01 08:50 又因前次可變 `failed` 狀態被產品 sink 擋下；修正狀態耦合之外，08:35／08:45 的唯讀 Gate 應使用與正式 sink 相同的靜態商品、基準與容量核准驗證，不寫入 state、不申請訂閱，避免 08:50 才發現可預知的輸入錯誤。今日 session authority、generation 與即時資料 Gate 仍由原流程另外核對。

正式排程遇失敗時，將固定、不含帳號與錯誤原文的警示交給 macOS 通知中心，並以 append-only 本機收據分別記錄 `os_handoff`、`failed` 或 `unsupported`；`os_handoff` 只證明作業系統接手，不代表使用者已讀。通知失敗不得遮蔽原始擷取失敗，也不得觸發登入、訂閱或服務重啟。另設唯讀 LaunchAgent 在交易日 08:52 查 08:50 收據、13:40 查正式擷取結果；可於當天啟動時補查，但不得把檢查時間改寫為原事件時間。第一次通知交付失敗可於稽核時再試一次，原交付收據保留。關機、macOS 拒絕通知或無可靠交易日 authority 時仍可能無法即時提醒，需在驗收文件明示。

2026-10-02 08:52 發現 full-session 擷取仍在執行時，08:50 的收尾 receipt 尚未存在，舊稽核卻以「receipt 缺席」直接送出失敗通知。修正為先核對同日 08:50 claim、同日 session 的新鮮 `starting`／`running` 狀態、control-plane accepted 與失敗 sidecar；在 claim 後五分鐘內且無失敗證據時視為 pending，不送失敗警示。五分鐘過後仍缺證據或已有明確失敗時維持警示，13:40 仍獨立核對最終正式結果。當天已送出的誤報收據保留，不改寫成成功或刪除。

## Risks / Trade-offs

- [官方交易日 authority 暫時不可用] → 不建立今日 session，回報 `calendar_authority_unavailable`；不得沿用昨日日期或探測未完成日報。
- [08:20 時前一日 baseline 尚未可用] → session 保持 `waiting_baseline`，不發通知；允許既有有界 baseline bootstrap，但不得盤中無界抓取。
- [使用者盤中修改 revision] → 保持固定 cohort 與歷史結果，停止新觸發並明示 mismatch；不在同一 session 輪替補位。
- [狀態 schema 增加提高 UI 複雜度] → 提供單一 view-model 正規化層與互斥計數 invariant，避免各元件自行推論。
- [匯入 runtime bundle 增加本機儲存] → 僅保存必要小型 manifest／plan／metadata，內容 hash 去重；不得自動刪除歷史 evidence。
- [跨日 live 驗收受休市或來源中斷影響] → 保留真實 partial／failed evidence，延後完成，不以離線 fixture 結案。
- [基準採集流量不足或日曆不可用] → 不以固定 256 MiB 或圖表快取替代證據；使用同 cohort 實測成本與動態保留額度，樣本不足／採集中額度不足即存明確 partial／failed receipt，隔日 premarket 繼續 fail closed。
- [API 換代時已出現資料活動] → 不允許受控 rebind，保留原始 session 與 mismatch；不得藉新 generation 重播或重複觸發。

## Migration Plan

1. 以唯讀方式驗證現有 2026-09-16 state、capture、bundle 與 GO review，建立 durable approval record及 archive-stable runtime bundle；原檔保持不變。
2. 新增 session schema、repository 與 resolver，讓舊 v1 state 僅能投影為 historical approval。
3. 更新 premarket config／runner，使下一適用交易日自動建立 current session；安裝前先以 dry-run 與 scheduler readback 驗證台北時間。
4. 更新 API 與 UI，在沒有 current session 時先顯示 fail-closed 狀態，再進行真實跨日 acceptance。
5. 若新 runner 發生問題，停止建立新 session 並回退 UI 至「歷史核准／今日未證實」；不得回退成以舊 `complete_go` 冒充 live，也不得刪除新舊 evidence。

## Open Questions

- 無阻擋實作的未決問題。實作時仍須以現有官方交易日 authority 的實際介面與資料日期為準，若無法提供下一交易日判定，應在 Gate 中保留 `calendar_authority_unavailable`，而不是自行猜測。
