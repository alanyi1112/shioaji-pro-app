## ADDED Requirements

### Requirement: daily 官方日曆不得依賴舊版基準包持續更新

daily 盤後入口 MUST 在實際雙市場官方日曆來源與相鄰交易日已驗證後，獨立保存原文、來源版本、實際取得時間與內容 hash；不能僅保存新版分鐘基準卻繼續依賴停止更新的 v1 `baseline-set.json`。盤前 MUST 優先驗證新版不可變日曆快取；沒有新版快取才可沿用原合法 legacy authority。新快取損壞、日期／hash／來源不符或逾原新鮮度期限 MUST fail closed，不回退舊快取掩蓋錯誤，不自動改日期或在盤前反覆連官方網站。

明確授權的臨時官方來源修復 MAY 另存 `operator-repair` 證據，但 MUST 使用真正原文與實際取得時間，不改舊原件，不冒充昨日盤後排程或授予 broker write／通知權限。額度續轉 MUST 重新核對此新版 authority 的私密原檔及 hash，保留相同帳戶、來源計數與 CAS 安全條件。

#### Scenario: v1 包已過期但 daily 盤後日曆有效

- **WHEN** 日常模式已保存新鮮、來源與 hash 相符的雙市場日曆，而舊 v1 包已超過原期限
- **THEN** 盤前 MUST 以新版 authority 判定今日及前一共同交易日，不以舊包過期誤擋；新版分鐘基準仍需逐檔驗證

#### Scenario: 08:45 後恢復官方日曆但今日 session 尚未建立

- **WHEN** 原 08:20 因日曆 unavailable 而失敗、沒有其成功 claim／今日 session／今日資料，且真正 08:50 排程在開盤前恢復合法 authority、完整額度與原安全 Gate
- **THEN** 08:50 MAY 沿用既有同日補建機制建立 session 並繼續原排程，明列 recoveryOf=08:20／scheduled0820Success=false；原失敗收據 MUST 不變
- **AND** 此補建 MUST 限 08:50–09:00，已有今日資料、其他失敗原因或任一 Gate 不成立時 MUST 拒絕，不手動代跑排程或建立第二個 owner

### Requirement: 日常盤前排程必須啟動獨立日常 runner

啟用 daily 模式時，08:20／08:35／08:45 本機排程與既有晚開機接續 MUST 驗證官方交易日、同日 session、設定／plan、durable capacity approval、逐檔合法基準、API generation 與 simulation 安全 Gate；08:50 MUST 呼叫日常 runner，不再要求新的 Stage bundle 或完整 capture。舊 Stage 盤前／首分鐘 canary／擷取資格僅供 diagnostic 模式，不得冒充 daily 證據。

各入口 MUST 使用同一排他 run registry 與同日冪等 claim，保留原失敗收據。固定 160 與動態 plan MUST 使用一致的模式契約；本案不得放寬晚開機時窗、商品基準或通知授權，亦不得新增常態 Codex 排程。

#### Scenario: 已有容量核准而沒有今日 Stage bundle

- **WHEN** daily 模式今日預檢通過，durable 核准有效且逐檔基準已驗證
- **THEN** 08:50 MUST 啟動單一日常 owner，不得因缺少今日 Stage bundle 或昨日 capture 退出

#### Scenario: 晚開機接續與正常排程競爭

- **WHEN** 同日排程與 late-boot 同時嘗試啟動
- **THEN** 僅一個入口 MUST 成功取得 ownership，其他入口 MUST 保存冪等／拒絕原因而不另開行情連線

### Requirement: 日常收尾稽核必須查真實程序與基準進度

daily 模式的 13:40 稽核 MUST 分別核對日常程序收尾、真實 stream／持久化故障、逐檔 coverage、小型 receipt 或寫入故障，以及獨立盤後 baseline 的 collecting／ready／failed；MUST NOT 以 `formalAcceptanceEvidence`、完整 capture、雙重 replay 或被動圖表檔作日常成功前提。尚在期限及預算內的 13:35 採集 MUST 表示進度而非整日擷取失敗。

#### Scenario: 基準仍在正常採集

- **WHEN** 日常監控已正常收尾，13:35 基準程序仍在合法期限內 collecting
- **THEN** 稽核 MUST 分列日常 ended 與 baseline collecting，不得發出 capture_missing 或 falsely failed 通知

#### Scenario: 正式 runtime 真實故障

- **WHEN** ownership 異常、程序逾期未收尾、已記錄串流故障或摘要寫入失敗
- **THEN** 稽核 MUST 保存可歸因故障／unknown，不能因有歷史基準或舊 GO 隱藏當日問題
