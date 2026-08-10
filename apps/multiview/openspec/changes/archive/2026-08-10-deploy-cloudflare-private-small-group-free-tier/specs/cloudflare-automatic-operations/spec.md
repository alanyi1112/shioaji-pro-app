## ADDED Requirements

### Requirement: main 必須經完整 gate 後自動部署 Cloudflare

GitHub Actions MUST 在 `main` push 後執行 deterministic install、lint、完整 tests、build、OpenSpec strict validation、`git diff --check`、Wrangler dry-run 與 Free-tier budget gate；全部成功後才可套用 migration 並部署 Cloudflare production。

#### Scenario: 所有 gate 成功
- **WHEN** `main` 新 commit 的所有驗證與 dry-run 成功
- **THEN** workflow MUST 使用該 exact commit 建置並部署 Cloudflare
- **AND** production health／版本資訊 MUST 可對應該 commit SHA

#### Scenario: 任一 gate 失敗
- **WHEN** lint、test、build、OpenSpec、diff、budget、migration 或 smoke 任一失敗
- **THEN** workflow MUST 標示失敗並停止後續 promotion
- **AND** 前一個成功 Cloudflare deployment MUST 保持可用

### Requirement: migration 與部署必須可回滾且不洩漏秘密

Production migration MUST 先於需要該 schema 的 Worker promotion，並以向後相容的 additive change 為預設；Cloudflare API token、account ID、Access credential、Google client secret 與資料 secret MUST 只存於受保護平台設定，且不得出現在 source、artifact 或 log。

#### Scenario: migration 成功但 deploy 失敗
- **WHEN** additive migration 已套用而 Worker deploy／smoke 失敗
- **THEN** workflow MUST 保留或回滾舊 Worker version
- **AND** 舊 version MUST 可在新 schema 上繼續讀寫既有契約

#### Scenario: log 與 artifact 產生
- **WHEN** workflow 保存 build、budget、migration 或 smoke 證據
- **THEN** 證據 MUST 只包含 allowlist 狀態、計數、版本與安全 reason
- **AND** MUST 不包含任何 token、secret、authorization header 或 cookie

### Requirement: 部署後必須分離匿名與已授權 smoke

Cloudflare deployment 完成後 MUST 驗證未授權 request 遭 Access 拒絕，以及 Service Token／Google session 已授權路徑的首頁、health、核心讀取與非破壞性持久化；匿名 `302`／`401` 不得作為應用健康成功證據。

#### Scenario: 匿名存取
- **WHEN** smoke 不帶 Access credential 請求 production URL
- **THEN** 結果 MUST 為 Access login／拒絕狀態
- **AND** workflow MUST 只將其記為存取邊界成功

#### Scenario: 機器身分 smoke
- **WHEN** smoke 使用有效 Service Token 與專用 smoke authorization
- **THEN** `/api/health` MUST 回傳預期 runtime、D1 可用與 commit version
- **AND** 非破壞性讀取／暫時測試資料 MUST 成功或完整清理

### Requirement: 無人登入時仍必須自動更新資料

TDCC 與本益比河流圖 workflow MUST 以 schedule 觸發 Cloudflare 的受保護 control／ingest 流程，且 MUST 使用 target-specific concurrency、run ID、base URL、Access Service Token 與 pipeline secret；人員是否登入不得影響執行。

#### Scenario: 連續數日無人登入
- **WHEN** Cloudflare 正式站沒有 browser session 或 panel 流量
- **THEN** GitHub schedule MUST 仍啟動資料工作並更新合法的新 source date
- **AND** Cloudflare D1 health MUST 保存最近 heartbeat、成功時間、coverage 與安全 reason

#### Scenario: 兩個部署目標都啟用資料更新
- **WHEN** 同一 workflow 需要更新 Codex Sites 與 Cloudflare 的獨立 D1
- **THEN** 每個 target MUST 使用獨立 credential、run state 與 concurrency key
- **AND** 任一 target 失敗 MUST 不把另一個 target 的成功回滾或誤報失敗

### Requirement: 真實排程與資料落地必須作為完成 gate

系統 MUST 只在實際 `event=schedule` run、來源日期、受保護 workflow 摘要與 Cloudflare D1 health 均可核對時，將自動資料更新標示完成；`workflow_dispatch`、匿名回應、control-plane 狀態或另一 deployment 的 D1 不得代替。

#### Scenario: 真實 schedule 完成
- **WHEN** GitHub Actions 由 `schedule` 觸發並回報成功
- **THEN** 驗收 MUST 核對相同 run ID 的 target、phase、實際 source date、D1 write／no-op 與完成／pending reason
- **AND** health MUST 顯示對應的 fresh heartbeat 與 coverage

#### Scenario: 尚無已授權 D1 health
- **WHEN** workflow 成功但無法取得同一 Cloudflare deployment 的已授權 fresh health
- **THEN** task MUST 保持未完成
- **AND** MUST 不以手動重跑或匿名 `401` 宣稱自動資料更新已驗收
