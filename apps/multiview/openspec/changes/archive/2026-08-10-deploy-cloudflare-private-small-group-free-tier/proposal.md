## Why

目前網站只能由 Codex Sites 管理部署與識別使用者，尚不能在使用者自己的 Cloudflare 帳戶中完整部署、讓擁有者管理的私人小群組 Google 帳號安全登入，也缺少可持續執行的 Cloudflare 自動部署與資料更新路徑。需要在保留現有 Codex Sites 正式站可獨立運作的前提下，增加第二個可驗證、可回滾且符合 Cloudflare Free 額度的正式部署目標，並讓擁有者日後可自行維護登入名單，而不必每次修改程式或 Access policy。

## What Changes

- 維持一份共用核心程式，同時支援 Codex Sites 與使用者自管 Cloudflare Workers，不複製或長期維護兩套分岔程式碼。
- 新增 runtime-aware 身分層：Codex Sites 繼續使用已驗證的 OpenAI 使用者資訊；Cloudflare 使用 Access JWT 與 Google IdP 驗證身分，再以私有 D1 動態登入名單決定應用授權，並以驗證後身分隔離個人頁籤與商品清單。
- 新增擁有者限定的登入名單管理後台與 API，可新增、修改、停用及刪除成員；一般成員不得查看或修改完整名單，且系統必須防止刪除／降級最後一位擁有者。
- 新增 Cloudflare Worker、Static Assets、D1、`workers.dev` 與 Access 的部署設定；尚未申請自訂網域時直接使用受 Access 保護的 `workers.dev`。
- 新增 GitHub Actions 自動部署流程，包含建置、測試、OpenSpec strict validation、Free-tier 預算檢查、D1 migration、部署、已授權 smoke test 與可回滾版本紀錄。
- 將 TDCC 與本益比河流圖資料工作改為可依部署目標選擇 base URL 與機器身分；Cloudflare 路徑以 Access Service Token 呼叫受保護端點，且自動更新不依賴人員登入或網站流量。
- 調整 SSE、D1 批次、寫入範圍與快取清理，使 2～3 位一般使用者在 Cloudflare Free 限制內可持續運作；正式驗收必須同時證明兩個部署目標的核心功能與資料隔離。
- 對既有 Codex Sites 個人資料提供明確遷移／保留策略；沒有可信身分對應時不得自動合併不同帳號資料。

## Capabilities

### New Capabilities

- `dual-runtime-deployment`: 同一份來源在 Codex Sites 與自管 Cloudflare Workers 的設定、相容性、驗收及回滾契約。
- `cloudflare-access-authentication`: Cloudflare Access Google 登入、D1 動態登入名單、擁有者管理、JWT 驗證、機器身分與個人資料隔離契約。
- `cloudflare-free-tier-runtime`: Cloudflare Free 的 request、CPU、D1 query／write、資產、串流與快取預算及降載行為。
- `cloudflare-automatic-operations`: GitHub Actions 自動部署、D1 migration、TDCC／本益比資料排程、health 證據與失敗復原契約。

### Modified Capabilities

- `codex-sites-rewrite`: 將既有「僅由 Codex Sites 正式部署」擴充為 Codex Sites 必須持續可運作，且同一核心程式可在自管 Cloudflare 正式部署；使用者清單隔離不再限定單一 Sites header。
- `tdcc-continuous-backfill`: 外部排程與受保護 tick 必須可針對 Codex Sites 或 Cloudflare 目標使用對應的機器授權，且不得讓兩個正式環境同時重複寫入同一權威資料庫。
- `free-pe-river-data-pipeline`: 免費本益比資料管線必須可在私人小群組 Cloudflare deployment 中排程更新，並維持 private／非商業／不提供原始資料 dump 的授權邊界。

## Impact

- 影響 `worker/` 的身分解析、D1 應用授權、管理 API、stream、D1 batch、cache retention、scheduled handler 與 health，也影響前端管理介面。
- 影響 `.github/workflows/`、資料 runner、部署設定、D1 migrations、環境變數與 secrets 管理。
- 新增自管 Cloudflare 的 Wrangler 設定與部署文件；保留 `.openai/hosting.json` 及現有 Sites 發布流程。
- 需要 Cloudflare 帳戶／Zero Trust、Google OAuth client、GitHub Environment 與 secrets 的一次性設定；實際秘密不得進入 repo、OpenSpec、log 或前端。
- 與 `move-chip-backfill-orchestration-into-sites-runtime` 的排程邊界有相依性；實作及歸檔時必須先確認其 task 5.7 終驗狀態，避免覆蓋尚未驗證的 TDCC 契約。
