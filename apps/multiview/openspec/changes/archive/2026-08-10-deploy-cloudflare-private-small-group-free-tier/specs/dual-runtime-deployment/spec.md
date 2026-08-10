## ADDED Requirements

### Requirement: 兩個 runtime 的 migration 必須處理既有 schema drift

Cloudflare production MUST 套用 repo 內正式 additive migrations；Sites 保留站若既有 D1 已由舊 runtime 依 `PRAGMA table_info` 補過相同欄位，Sites deployment artifact MUST 將該 migration 轉為可稽核的 target-specific baseline，避免重複 `ADD COLUMN` 中止發布。兩個 target 的 artifact 差異 MUST 由可測試的 source script 產生，不得手動竄改已儲存版本。

#### Scenario: Sites 已有本益比 runtime 欄位
- **WHEN** Sites 保留站 D1 已存在 `provider` 等本益比欄位，但 migration journal 尚未記錄 Cloudflare migration `0018`
- **THEN** Sites archive MUST 以 `runtime_metadata` baseline marker 取代重複的 `ALTER TABLE`
- **AND** 後續 migration MUST 繼續套用，既有 version 與資料 MUST 保持可回滾

#### Scenario: Cloudflare 套用同一份 source
- **WHEN** Cloudflare workflow 建置與部署相同 commit
- **THEN** Wrangler MUST 繼續讀取未改寫的 `drizzle/0018_cloudflare_pe_runtime_columns.sql`
- **AND** Sites target-specific baseline MUST NOT 進入 Cloudflare migration artifact

### Requirement: 同一核心程式支援兩個獨立部署目標

系統 MUST 以同一份 `app`、Worker、資料模型與產品測試支援 Codex Sites 與使用者自管 Cloudflare Workers，部署差異 MUST 限制在設定、binding、身分 adapter 與發布流程，不得以複製應用程式碼形成長期分岔版本。

#### Scenario: 同一 commit 建置兩個目標
- **WHEN** 某 commit 準備發布 Cloudflare
- **THEN** 該 commit MUST 同時通過 Codex Sites 相容 build 與 Cloudflare production build
- **AND** 兩個目標 MUST 提供相同的核心圖表、主副圖、清單、籌碼與本益比功能契約

#### Scenario: Cloudflare 專屬設定變更
- **WHEN** 開發者調整 Cloudflare account、D1 binding、Access audience 或 `workers.dev` route
- **THEN** 變更 MUST NOT 覆蓋 `.openai/hosting.json` 的 Sites project／logical binding
- **AND** Codex Sites build MUST 不需要 Cloudflare production secret 才能完成

### Requirement: 兩個正式環境必須獨立部署與回滾

Codex Sites 與 Cloudflare MUST 使用獨立 deployment version、runtime binding 與 D1；任一環境發布或資料工作失敗，不得破壞另一環境目前可用版本。

#### Scenario: Cloudflare 部署失敗
- **WHEN** Cloudflare migration、deploy 或 smoke test 失敗
- **THEN** Cloudflare MUST 保留或回滾至前一個可用 Worker version
- **AND** 現有 Codex Sites deployment 與 D1 MUST 不受影響

#### Scenario: Codex Sites 尚未更新至相同 commit
- **WHEN** Cloudflare 已部署新 commit 而 Codex Sites 仍運行既有成功版本
- **THEN** 兩個 deployment MUST 各自持續提供其已驗證功能
- **AND** 系統 MUST 清楚記錄兩邊實際版本，不得宣稱已同步

### Requirement: 無自訂網域時使用受保護的 workers.dev

Cloudflare deployment MUST 能以 `workers.dev` 作為正式私人小群組入口，且 MUST 在開放使用前套用 Cloudflare Access；未來新增自訂網域不得要求更換應用資料 schema 或個人身分鍵。

#### Scenario: 首次建立 Cloudflare 正式站
- **WHEN** 使用者尚未申請自訂網域
- **THEN** 系統 MUST 部署到指定 `workers.dev` hostname
- **AND** 未通過 Access 身分驗證或不在 D1 active 登入名單的訪客 MUST 無法存取應用頁面與 API

#### Scenario: 日後新增自訂網域
- **WHEN** deployment 增加自訂 hostname
- **THEN** 既有 D1 使用者資料與 API contract MUST 保持相容
- **AND** 新 hostname MUST 重新套用等價 Access policy 與 JWT audience 驗證後才可使用

### Requirement: 雙目標正式驗收必須以實際網址為證據

系統 MUST 分別以已部署的 Codex Sites 與 Cloudflare URL 驗證首頁、health、核心 API、主要互動與存取邊界，不得以 localhost、build success 或另一個 deployment 的結果代替。

#### Scenario: Cloudflare production 驗收
- **WHEN** Cloudflare deployment 完成
- **THEN** 驗收 MUST 使用實際 `workers.dev` URL 取得已授權首頁及 `/api/health`
- **AND** MUST 驗證匿名／未列入 D1 active 名單使用者遭拒、owner 可管理名單、核心圖表可載入及 D1 可持久化

#### Scenario: 保留 Codex Sites 可運作版本
- **WHEN** Cloudflare production 已通過驗收
- **THEN** Codex Sites 正式 URL MUST 仍能由既有授權 session 載入首頁與核心 API
- **AND** 若本輪未發布 Sites，報告 MUST 明確標示其保留版本而非宣稱部署相同 commit
