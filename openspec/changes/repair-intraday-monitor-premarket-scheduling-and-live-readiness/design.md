## Context

2026-09-15 原訂由 heartbeat automation `160` 在 08:45（Asia/Taipei）接手盤前檢查，08:50 啟動 exact 160 full-session capture，另由 cron automation `160-2` 於 08:55 保險接手。事後稽核顯示：

- 主排程使用 `DTSTART;TZID=Asia/Taipei:20260915T084500`，排程器卻將 08:45 存成 UTC，computed fire time 成為台北時間 16:45；當日上午沒有建立 automation run。
- 備援 cron 未使用相同 `TZID` 寫法，於 08:55:53 建立 run，證明當時主機與 scheduler 可工作。
- 人工於 08:49:30 冷啟動 simulation API，08:50:43 啟動 capture。`POST /api/v1/stream/subscribe/kbars` 回覆成功後，產品狀態立刻把 160 檔標為 `active/confirmed`。
- 第一批實際 SSE 在 09:11:02 收到，內容為 09:10 KBar；160 檔全部缺少 09:01–09:09。相同來源的歷史 REST KBar 已可讀到這些分鐘，因此是 live transport／subscription readiness 缺口，不是市場不存在資料。
- 現行 simulation LaunchAgent 將 stdout／stderr 導向 `/dev/null`，Shioaji API 也不提供逐商品 KBar 訂閱生效 receipt，無法事後證明供應端是在開盤切換時丟失預先訂閱，或直到 09:10 才完成內部連線。
- 專案已有有界 REST KBar bootstrap 元件，但尚未接入 direct 160 正式 runner；現有 product sink 又在第一筆行情前預設 `dataActive=160`，使監控條件沒有及時揭露缺口。
- capture 於 13:34:30 結束後，產品狀態為 `evaluationState=no_go`、`approvedActiveLimit=20`、41,752 observations、9 triggers；156 檔有 09:10–13:30 共 261 筆，2395.TW、3023.TW、3680.TWO、6770.TW 只有 259 筆並停在 13:28。
- 正式輸出未建立，實際 failure sidecar 是 `capture-2026-09-15.json.failure.json`，內容記錄被動圖表 evidence 不存在；既有監督使用另一個檔名 `capture-2026-09-15.failure.json`，因此盤中多次得到錯誤的「沒有 failure sidecar」結論。

本 change 在現有 `simulation-only`、無通知權限、無 broker write、未通過 GO 前 active limit 維持 20 的邊界內修正。2026-09-15 capture 保留為部分日與負載證據，不可因後續補抓而改寫為 live 完整日。

## Goals / Non-Goals

**Goals:**

- 讓使用者提供的時間預設以 `Asia/Taipei` 解析，並用 scheduler computed fire time 證明實際觸發時間正確。
- 由本機 durable scheduler 執行關鍵盤前啟動；Codex heartbeat 只負責監督、診斷、審閱與回報。
- 將 control-plane accepted、data-plane awaiting 與逐檔 live active 清楚分開。
- 在開盤第一分鐘立即偵測全 cohort 缺口，保留一次有界重訂閱與權威 REST gap repair 能力。
- 使完整日驗收同時檢查分鐘資料完整性與當時即時功能可用性，避免事後補抓掩蓋盤中不可用。
- 保存足以找出排程、服務、訂閱與 SSE 時序的本機去敏日誌及 evidence。

**Non-Goals:**

- 不以本 change 核准 160 active limit；仍須另一個符合全部 Gate 的正式完整交易日。
- 不把 2026-09-15 的歷史 REST 補抓轉成 live 驗收證據。
- 不啟用 production、CA、broker write、通知發送或真實下單。
- 不宣稱可以從現有 Shioaji API 得知 physical subscription usage、global ownership、release 或 headroom。

## Decisions

### 1. 關鍵盤前流程使用 durable local scheduler

以 macOS LaunchAgent 執行本機 premarket orchestrator，固定採 `Asia/Taipei` calendar authority 產生當日 UTC instant 與本地顯示值。預設時序為 08:20 啟動或確認 simulation API、08:35 完成暖機檢查、08:45 完成 exact 160 prerequisite、08:50 建立唯一 capture claim。Codex heartbeat 讀取 durable evidence 並回報，不負責唯一一次的關鍵啟動。

選擇此方式是因為 LaunchAgent 可在 Codex task 沒有被喚醒時獨立運作，並能留下退出碼與日誌。只修正 heartbeat RRULE 仍會把產品關鍵路徑綁在 app scheduler 的時區解析與 task 喚醒狀態；只保留手動操作則無法滿足無人值守的開盤時點。

### 2. 排程必須有 canonical instant receipt

每次建立或修改交易日排程，都保存 `requestedLocalTime`、`timeZone=Asia/Taipei`、`scheduledForUtc`、`computedLocalTime`、scheduler id、讀回時間及一致性結果。只有 `computedLocalTime` 與要求完全一致、且仍在未來，排程才是 ready。若有明確證據顯示使用者已離開台灣，下一次涉及時間的工作先詢問時區；沒有此證據時不得自行改用系統、UTC 或其他所在地時區。

### 3. Control plane 與 data plane 使用分離狀態機

transport 的成功回應只允許進入 `subscription_requested`。每個商品在收到符合 trade date、generation、contract identity、source version 與分鐘格式的第一筆 KBar 前維持 `awaiting_first_kbar`；收到後才成為 `active`。`dataActive` 等於已有 data-plane evidence 的唯一商品數，`boundedTransportReady` 只有 exact cohort 全數完成 first-event Gate 且 stream 未 degraded 時才能為 true。

採逐檔狀態而非單一批次 boolean，可直接揭露部分商品未生效；保留 `subscribeAccepted` 作為 control-plane 診斷欄位，但它不得參與 active 計數。

### 4. 第一分鐘 canary 與有界恢復

正式 runner 於 08:50 前先開 SSE，再提交一次 exact cohort subscribe。09:02:15 前每檔都應收到 09:01 completed KBar；屆時缺少任一商品即寫入 incident evidence、立即回報並維持 NO-GO。系統最多允許一次相同 cohort 的 unsubscribe／resubscribe recovery，且使用同一 run claim；不得輪替商品、拆成不受控多連線或無界 retry。

即使 recovery 後恢復，第一分鐘 live availability Gate 仍記為失敗；當日可繼續取得負載與功能復原證據，但不能核准 Stage 160。這避免用事後資料完整性掩蓋使用者在開盤時實際無法使用盤中選股。

### 5. REST bootstrap 只修復資料連續性，不改寫可用性歷史

當第一個 SSE KBar 或重連後 KBar 顯示中間有缺口，runner 先以逐檔第一個 live minute 決定 gap 終點，再對「09:01 至第一個 live minute 的前一分鐘」或 reconnect gap 做一次有界 REST `/api/v1/data/kbars` 讀取。bootstrap 尚未完成時，第一個 live minute 只暫存在記憶體且維持 `waiting_continuity`，不得先以不完整累積量寫入正式序列。canonicalizer 只接受已完成分鐘，逐檔核對欄位等長、日期、交易時段、單位、遞增時間、contract identity 及範圍，並對包含第一個 live minute 的固定範圍做第二次讀取與 hash 比對。REST 與 SSE 重疊分鐘的 volume 必須一致；不一致或缺少 coverage evidence 即 fail closed。

成功 bootstrap 的 row 保存 `source=shioaji-kbars-bootstrap`、REST generation、來源版本、fetch time、range hash 及對應 live generation。它可恢復累積成交量與產品查詢，但 `liveDelivered=false` 的分鐘永遠不可改標為 live。正式 Stage 160 GO 仍要求 09:01 live canary 通過；核准後的一般產品 session 才可依既定可用性政策使用 bootstrap 維持資料連續性。

### 6. 累積量必須從 09:01 canonical 序列建立

minute accumulator 不得把第一個收到的 09:10 volume 當成從開盤累積量起點。任一商品只要 09:01 至目前 watermark 有 unknown，量比分類維持 `waiting_continuity`，不得產生正式 trigger。bootstrap 完成且全段驗證後，按 09:01 起的 1 分 K Volume 重新建立累積序列，再從第一個完整可比較分鐘開始評估；歷史補算 trigger 不得發送通知。

### 7. 日誌、evidence 與回報使用相同事件模型

simulation API、premarket orchestrator 與 capture 各自輸出權限 0600 的 JSONL 輪替日誌，保留至少最近五個交易日並設總容量上限。事件至少涵蓋 scheduler computed fire time、process/generation、health／snapshot Gate、subscribe request/receipt、逐檔 first KBar summary、canary、recovery、bootstrap、failure sidecar 與 close seal；秘密值與帳戶識別不得寫入。

capture output 與 failure sidecar 使用單一共用 path constructor，status API 與 monitor 必須從 runner 回傳或 registry receipt 讀取正式路徑，不得自行用字串猜測。建議 contract 固定為 `<capture>.failure.json`，並在結束時原子寫入 `outcomePath`、`mainEvidenceCreated`、`failureEvidenceCreated` 與 hash；監督若找不到宣告路徑，視為 evidence contract failure。

monitor 在下列事件立即回報：排程沒有 run、computed time 偏移、服務 Gate 失敗、09:02:15 canary 失敗、exact cohort 未全 active、SSE 中斷、bootstrap 不完整、failure sidecar、13:34:30 capture 完成及 GO／NO-GO。健康且沒有里程碑時保持安靜。

### 8. 逐檔收盤邊界不得固定為 13:30

13:30 只作為一般盤的名目邊界，runner 不得在此時間對所有商品直接 seal。每檔商品保存 nominal close、實際最後事件、延後收盤狀態、權威 close evidence 與 seal time；若交易所機制、處置或收盤競價使該商品延後收盤，runner 必須繼續接收並將延後區段納入逐檔完整性。只有該商品的權威 close condition 成立，或到達經規格設定的安全截止點並明確標記 unresolved，才可封存。

延後期間沒有成交時不得補造零成交 KBar，也不得要求不存在的每分鐘 row。完整性以該商品適用的 expected-minute set、實際成交事件與 close evidence 共同判斷；安全截止前仍沒有可驗證 close evidence 時，該商品維持 unknown，當日不得 GO。

### 9. 盤中導向的收盤尾端例外必須有界且可稽核

使用者明確將 Stage 160 的主要目的定義為盤中比較，因此收盤尾端少量供應端 frame 遺失不再單獨否決整日盤中能力。例外僅在下列條件同時成立時適用：09:01 live canary 為 160／160、受影響商品少於 5 檔、每檔缺口是連續結尾且完全落在 13:26–13:30、每檔最多 5 分鐘、缺口以前的 live 累積量連續、stream／圖表／資源／安全 Gate 通過。

收盤後針對受影響商品以相同 simulation API 執行兩次固定交易日 REST KBar 讀取。兩次 canonical hash 必須一致、各有完整 270 分鐘、欄位等長，且從 09:01 到最後一筆 live KBar 的逐分鐘累積量必須完全相符；任何差異均維持 NO-GO。通過後只在新的 derived acceptance artifact 中附加 historical tail rows，保存 `liveDelivered=false`、來源 capture SHA-256、雙抓 hash、回補時間與受影響清單。原始 capture 與首次 NO-GO dossier 不得覆寫。

derived acceptance 可將 `postCloseDataContinuityComplete=true`，但必須同時輸出 `tailLiveCompletenessException=true`，不得把 historical rows 改標成 live。尾端回補只用於收盤比較、replay 與 Stage 160 審閱，notification authority 與 retroactive trigger authority 均維持 false。受影響商品達 5 檔、缺口早於 13:26、不是連續尾端、雙抓不一致、live prefix 不符或 09:01 canary 失敗時，一律維持 NO-GO。

## Risks / Trade-offs

- [08:20 提早啟動增加 session 存活時間] → 維持 simulation-only，使用 watchdog 與 generation pinning；08:45 再做一次完整 business readiness。
- [逐檔 first-event Gate 受零成交商品影響] → exact cohort 目前已限定曾驗證可提供每分鐘 KBar 的普通股；若供應端仍不送事件，保留 unknown 並 NO-GO，不以估算零成交替代。
- [REST bootstrap 可能碰到尚未定稿分鐘] → 僅讀 completed watermark 以前的分鐘，固定範圍雙抓並與 SSE overlap 核對。
- [一次重訂閱可能造成重複事件] → repository 使用商品、交易日、分鐘唯一鍵與 payload hash 去重；不同內容視為 revision 或衝突，不可靜默覆寫。
- [日誌可能成長或含敏感資訊] → 僅記 schema 定義的去敏欄位，權限 0600，按日／容量輪替，禁止 raw payload、帳戶與秘密值。
- [Codex heartbeat 仍可能延遲] → 核心執行不依賴 heartbeat；durable runner 將 incident 落檔，下一次任何監督或使用者查詢都能讀取。
- [延後收盤商品的分鐘數不固定] → 以逐檔 expected-minute set 與 close evidence 驗證，不以固定 row count 補造資料；無法確認時 fail closed。
- [放寬尾端缺口可能掩蓋盤中斷流] → 僅允許少於 5 檔且每檔至多最後 5 分鐘；任何較早缺口、非連續缺口、5 檔以上或 REST／live prefix 不一致均不得套用例外。

## Migration Plan

1. 2026-09-15 收盤前保持現有 capture 與服務不變，只讀取狀態並保存部分日證據。
2. 13:34:30 後封存當日 capture 為 NO-GO／partial，不產生 activation，不把 REST 補抓寫成 live row。
3. 實作 canonical schedule receipt、LaunchAgent premarket orchestrator、受限日誌與安裝／移除命令；用非交易時段 dry-run 驗證台北時間與 single-owner claim。
4. 實作 product state machine、first-event Gate、canary、一次 recovery、bootstrap reconciliation 與 waiting-continuity trigger gate。
5. 以 fixture 和錄製資料完成 unit／integration；再於非交易時段做不連行情的 scheduler rehearsal。
6. 下一適用交易日前建立新的 exact 160 baseline；08:20 必須實際通過 simulation mode、API generation、business session 與 2330 Snapshot 才能固定 generation anchor，08:50 才可開始 capture；完整日通過後才交由既有 bundle／Codex review／activation 流程判斷 160 GO。
7. 任一 migration Gate 失敗即移除新的 premarket LaunchAgent、恢復既有 active limit 20 與 simulation runtime；保留 evidence，不回滾或刪除失敗紀錄。

## Open Questions

- Shioaji 1.7.1 對預開盤 KBar subscription 在開盤 session 切換時的官方保證仍未知；在取得正式文件或逐檔 receipt 前，系統一律以 first-event evidence 判斷。
- physical subscription usage、global ownership、provider release 與 headroom 仍維持 unknown，不因 exact cohort 收到資料就推論為已證實。
