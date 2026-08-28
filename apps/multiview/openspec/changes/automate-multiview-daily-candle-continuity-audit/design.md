## Context

既有日 K 修復已提供 requested-scope continuity audit、官方月資料 cache、每檔最多 6 個未快取月請求、相同 key single-flight、`/api/internal/candle-continuity-audit`、逐商品 health，以及人工觸發的 Sites／Cloudflare 大立光 acceptance。現況缺少的是跨 tick 的 durable run、全啟用商品目標快照、優先序、SLA 與每日雙環境排程；直接讓 workflow 用 cursor 反覆呼叫現有 endpoint，無法在 Worker restart、workflow retry 或清單變動時證明沒有跳過或重複商品。

本專案的 Sites 與 Cloudflare 各自擁有 D1 與私人存取邊界，不能共用 run state。既有每日籌碼流程已採 GitHub Actions 盤後 schedule、單例 concurrency、protected start／tick／fail 及安全摘要，可作為 orchestration 形狀，但 continuity 必須沿用自己的 eligibility、request budget 與逐商品狀態，不與 TDCC run table 或 secret 混用。

## Goals / Non-Goals

**Goals:**

- 讓每個目標環境每天自動、可續跑地稽核所有目前啟用的 eligible 台股日 K 商品。
- 對新商品、未稽核、缺口、過期及 coverage 落後商品提供穩定優先序與逐商品 SLA。
- 在 Worker restart、workflow retry、部分失敗及 rate limit 下保留進度，並以有界負載完成後續批次。
- 讓 protected health、workflow summary 與正式 UI 驗收能互相對帳，而不洩漏個人清單或秘密。

**Non-Goals:**

- 不新增、替換或繞過 TWSE／TPEx／Yahoo 官方與既有 fallback 資料來源。
- 不將 Sites 與 Cloudflare D1 合併，不建立跨環境寫入或中央資料庫。
- 不把 continuity 排程接到前端頁面流量，也不要求使用者開啟商品才完成稽核。
- 不處理主力／分點副圖、盤中分鐘 K、非台股、交易、production Shioaji 或公開存取。

## Decisions

### 1. 使用獨立 durable orchestrator，而不是讓 workflow 自行持有 cursor

新增 additive D1 tables：`candle_continuity_runs` 保存 run 級狀態，`candle_continuity_run_items` 保存目標快照與逐商品 item。run 至少保存 `run_id`、`trigger`、`expected_session`、`status`、`phase`、`cursor`、各狀態計數、owner／lease、heartbeat、開始／完成時間與 allowlist reason；item 以 `run_id + symbol` 唯一，保存 priority、status、attempt、claim owner／lease、continuity before／after 摘要與時間。

workflow 先送出 `orchestrator-start`，每輪以受保護的 `orchestrator-peek` 讀取下一個可 claim symbol、再重複 `orchestrator-tick`，必要時送出 `orchestrator-fail`；peek 只回單一 symbol 與固定安全摘要，不 claim、不改 lease，也不回傳完整 target list。這讓 runner 可在 hosted request 進入長時間 provider timeout 前先準備官方月 cache，而重試與 restart 仍由 D1 狀態決定，不依賴 GitHub runner 記憶體。

替代方案是直接沿用 `/api/internal/candle-continuity-audit` 的 lexicographic cursor。該方式較少 migration，但清單在 run 中變動、cursor 後插入新商品、runner 中斷或同 run 重送時無法提供固定目標快照與逐商品終態，因此不採用。既有 audit endpoint 保留作為 orchestrator 的單批執行核心與人工診斷入口。

### 2. Run 開始時建立目標快照，並以狀態優先序而非純 symbol cursor 排序

目標 discovery 聚合 canonical 內建頁籤與啟用個人清單，只輸出 DISTINCT canonical symbol；相容商品目錄僅補充 active、quote type 與市場 metadata，再套用既有 ordinary-stock／ETF eligibility。商品目錄的 `active` 代表仍上市，不代表使用者已啟用，MUST NOT 單獨擴張 target set。item priority 固定為：

代表性 acceptance 是獨立、已授權的內部驗收路徑：最多可指定 4 檔格式合法的台股上市／上櫃 symbol，即使其中某檔不在該環境當日 target snapshot，仍可核對新加入商品情境；此例外不得寫入或擴張 durable target set，普通批次稽核仍只能接受當日已啟用商品。

驗收 runner 每檔先執行 D1-only acceptance；已有完整 `candle_history`／`candle_history_state` 時不再依賴當下上游可用性。只有 D1 證據不足並回覆 5xx 時，才以獨立有界 request 執行 `acceptancePreparation` audit／回補後重試 acceptance。此受保護 preparation 最多只接受 4 檔合法台股，允許準備不在當日 target snapshot 的代表商品但不寫入 durable target。acceptance 最新收盤核對每檔只執行一次，再以相同核對結果分別產生 `display160.first/repeat` 與 `display320.first/repeat`；repeat 仍重新讀取 D1 並證明 cache hit。逐商品 item 以 `display320.repeat` 的 continuity 摘要產生。一般 audit 與每日 durable run 的 target 限制不受此驗收模式影響。

Sites／Cloudflare runtime 若因 egress 限制無法直接取得 TWSE／TPEx 官方月資料，GitHub runner 僅在該 tick 回傳可重試的台股 item，或 D1-only acceptance 證據不足時，才直接向既有官方端點取得最近 18 個月 payload。runner 固定最多 2 個官方請求並行、每次最多重試一次、12 秒 timeout，並將 payload 每 6 個月一批送回受保護 action。Worker MUST 以既有 TWSE／TPEx parser 重新驗證 symbol、month、status 與 rows 後才寫入官方月 D1 cache；合法官方 rows 另以既有 `candle_history` repository 合併寫入，再由既有 continuity audit 讀取 D1 月 cache 重算並保存 state，讓缺少 320 rows 的首次驗收不必再等待 hosted Yahoo refresh。runner 不可直接寫 D1、不可提供 candle 派生值，也不可擴張 durable target。後續 audit 仍由既有核心從 cache 續跑並決定 complete／unknown／excluded evidence。

1. 新加入或 `continuity_checked_at` 為空。
2. 已確認缺口或 missing count 大於零。
3. `partial`／`unknown`、evidence 過期或 coverage 落後 expected session。
4. 仍在寬限期的待發布商品。
5. complete 且證據新鮮；這類建立 skipped／fresh item，不重新呼叫官方來源。

同 priority 依 symbol 排序，cursor 指向 run item 的穩定序位，而非即時清單。下一個 run 會重新 discovery，因此 run 中新加入的商品不破壞快照，最晚在下一次排程進入最高優先級。

替代方案是每 tick 重新查詢即時清單；會造成 remaining count 漂移及同 run 無法證明全量 coverage，因此不採用。

### 3. 沿用既有限額，另加 run／tick 上限

單次 tick claim 最多 1 個 item、worker concurrency 最大 1；每檔內的官方月份請求仍最多 2 個並行，production automation 每個 HTTP tick 最多新抓 4 個月份，低於核心上限 6，並沿用 8 秒 timeout、單 key 最多一次 retry、月 cache 與 single-flight。超過 4 個月份時以 `audit_request_budget` 跨 tick 利用已寫入月 cache 接續。若 runner 已為該 item 補入官方月 cache，下一 tick 可繼續處理其他 queued item；只有沒有 audited item 可 claim、run 仍為 `retry_waiting` 時才等待 60 秒，避免因逐 item 等待超出 15 分鐘總上限。workflow 最多 60 ticks、15 分鐘，HTTP call 最多 90 秒；到達上限時 run 保持 `running`／`retry_waiting` 與持久化 cursor，由下一次 schedule 或人工 dispatch 接續，不把未完成 item 改成 complete。

Sites 與 Cloudflare 排程錯開，避免同時對官方來源形成雙倍尖峰；預設在既有 22:30 台北每日籌碼作業後執行，Sites 23:00、Cloudflare 23:30。台灣沒有日光節約時間，因此 GitHub cron 可分別使用固定 UTC；仍保留 `workflow_dispatch` 供驗收與續跑。

替代方案是單次 request 內跑完全商品；會超過 Worker request lifetime、D1 statement 與上游 rate limit，且難以安全續跑，因此不採用。

### 4. SLA 以 expected completed session 與 checkpoint 判斷

run 使用既有台北市場日工具計算 `expected_session`。同交易日晚間首次 run 若官方尚未發布，item 為 pending／retry_waiting；下一個 SLA checkpoint 設為次日 10:00 Asia/Taipei。到 checkpoint 後仍未涵蓋 expected session、仍為 `partial`／`unknown`、存在 `missing_traded_session` 或 evidence 已過期，才標記 overdue／degraded 並讓品質 gate 失敗。

合法休市、停牌、上市前與官方明確無成交資料沿用 continuity excluded evidence，可達 complete；不得為通過 SLA 造出零量或前值 candle。週末與休市日 schedule 可安全 no-op，或接續前一個未完成 run。

替代方案是首次來源未發布立即告警；會把正常官方產製延遲誤判為事故，因此不採用。

### 5. Sites 與 Cloudflare 使用相同契約、不同 workflow 與狀態

建立兩份 workflow 或由同一模板產生兩份明確 target workflow；兩者有不同 concurrency group、run ID prefix、URL、protected access headers、audit secret 與 D1。Sites 使用現有私人站存取 header，Cloudflare 使用 Access service principal；application audit secret 仍是第二層授權。Cloudflare workflow 使用 `cloudflare-production` environment，Sites 不借用 Cloudflare secrets。

兩環境 workflow 共用一支只處理安全 JSON contract 的 runner script，避免 shell 邏輯漂移。runner 只印 aggregate summary、allowlist reason 與少量代表性 acceptance；不得印 request headers、response body、完整 target list 或秘密。

替代方案是以 Sites 成功代表 Cloudflare；無法證明 Cloudflare 自己的 D1、Access、migration 與 cache，違反雙環境隔離，因此不採用。

### 6. Health 分成 run aggregate、SLA aggregate 與 bounded anomaly items

`/api/health` 的 protected continuity 區塊新增 automation 摘要：configured、最近 run 身分／trigger／expected session／phase／heartbeat、target／processed／remaining／complete／partial／unknown／failed／overdue 計數、next checkpoint，以及固定最多 20 筆異常 item。item 只含 symbol、status、verified through、missing count、checked time 與 allowlist reason；超過上限回 `truncated=true` 與 total。

既有逐商品 `dailyCandleContinuity.items` 保留向後相容。全域 `ok`、D1 schema current 或 run completed 不會覆寫 SLA degraded；workflow 最後以 exact deployment target、commit SHA、run ID 與上述計數做 protected health gate。

### 7. 驗收分成 deterministic、資料層與實際畫面三層

自動測試以固定清單、D1 舊 state 及假官方回應驗證 discovery、priority、snapshot、cursor、lease、retry、SLA 與環境隔離。資料層正式驗收在 Sites／Cloudflare 各執行一次全量 run，並固定核對大立光、上市、上櫃、ETF、新加入商品的逐商品 evidence、160／320 cache reuse 與 health。

實際畫面驗收只讀取已授權 session：確認代表性 panel loaded、continuity 提示、日期、主副圖 canvas、核對 scope 與 console。匿名 `401`／`302` 只證明存取邊界，不列入資料健康證據。

## Risks / Trade-offs

- [每日雙環境會增加官方來源流量] → 錯開排程、只重查不新鮮 item、保留月 cache／single-flight 與每檔／每 run 上限。
- [清單在 run 中變動造成新商品延遲一天] → run 採固定快照確保可對帳；新商品由下一個 run 最高優先處理，前端按需 audit 仍可先建立證據。
- [GitHub schedule 可能延遲] → 以 run heartbeat 與 expected session SLA 判斷，不以 cron 觸發時間本身冒充完成；保留手動 dispatch。
- [官方資料正常延遲造成假告警] → 同日晚間使用 pending 寬限，次日 checkpoint 才 overdue；`reference_not_published` 與 provider failure 分開。
- [大量歷史 unknown 首次 rollout 可能無法單次完成] → migration 只建立狀態，不在部署 request 全量執行；以多次 tick／多次 run 漸進完成並保留 remaining。
- [Protected health 洩漏個人清單組成] → log 只印 aggregate，health item 有固定上限且不含清單來源／使用者；完整 target set 只存在 private D1。

## Migration Plan

1. 先部署 additive run／item tables、repository 與 deterministic tests；既有 candle history、continuity state 與 audit endpoint 不變。
2. 部署 orchestrator 路由、runner script 與 health 欄位，但保持 schedule 未啟用；在本機與 staging 以 `workflow_dispatch` 驗證 start／tick／fail、restart、SLA 與 rollback。
3. 先啟用 Sites schedule，完成至少一次全量 run、protected health 及 UI 驗收；異常時停用 workflow，D1 run rows 保留供診斷與續跑。
4. Sites 穩定後部署 Cloudflare exact SHA、套用相同 migration，啟用錯開 schedule 並完成獨立全量驗收。
5. 兩環境皆通過後，將代表性 acceptance 與 SLA gate 納入 release evidence；正式排程、部署、secret 配置與 workflow 啟用均需使用者另行明確授權。

Rollback 只停用兩份 schedule 並回退 Worker／workflow；additive tables、run rows、既有 continuity state 與 candle history 保留，不執行破壞性 schema 降版。舊版 health 可忽略新增欄位，人工 audit endpoint 仍可使用。
