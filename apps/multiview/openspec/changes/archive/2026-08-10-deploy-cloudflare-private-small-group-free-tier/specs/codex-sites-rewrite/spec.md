## MODIFIED Requirements

### Requirement: Sites 完整執行環境

系統 MUST 以同一核心程式在 Codex Sites 與使用者自管 Cloudflare Workers 相容 runtime 中提供首頁、靜態資產、同源 API、即時資料與持久化，不得把既有 Render 站當作正式依賴。Codex Sites deployment MUST 持續可獨立運作；Cloudflare deployment MUST 使用自己的 runtime bindings 與 D1，不得以停用 Sites 相容性換取部署成功。

#### Scenario: Codex Sites 正式站獨立運作

- **WHEN** 使用者開啟 Codex Sites 正式網址
- **THEN** 首頁與 `/api/health` 皆由 Sites deployment 回應
- **AND** 圖表資料請求不會導向既有 Render 或自管 Cloudflare 網域

#### Scenario: Cloudflare 正式站獨立運作

- **WHEN** 已授權使用者開啟自管 Cloudflare 正式網址
- **THEN** 首頁、靜態資產、同源 API 與 `/api/health` 皆由該 Cloudflare deployment 回應
- **AND** 圖表資料請求不會導向既有 Render 或 Codex Sites 網域

### Requirement: 使用者清單持久化

系統 MUST 使用目前 deployment 的 D1 保存使用者自訂頁籤與商品清單，並以該 runtime 驗證成功的伺服器端使用者識別隔離資料：Codex Sites 使用平台提供的可信身分，Cloudflare 使用驗證成功的 Access JWT principal。每個新加入的台股商品 MUST 同時保存伺服器判定的 `addedAt`、可選 `recommender` 及加入紀錄識別碼；既有項目缺少可信加入日期時 MUST 以 nullable 欄位與 `legacy_unknown` 向後相容，不得偽造日期。系統 MUST NOT 因這些 metadata 建立投資報酬、報酬率、理論上下限或績效追蹤資料。

#### Scenario: 儲存個人頁籤
- **WHEN** 已識別使用者新增或修改個人頁籤
- **THEN** 重新載入頁面後 MUST 取得該使用者保存的資料
- **AND** 其他使用者不得讀取或寫入這些內容

#### Scenario: 正式環境缺少可信身分
- **WHEN** Codex Sites 或 Cloudflare production request 未取得該 runtime 可驗證的使用者 principal
- **THEN** 個人清單 API MUST 回傳未授權
- **AND** MUST NOT 使用 `local-sites-user`、request body email 或任意 client header 存取資料

#### Scenario: 儲存新加入商品的 metadata
- **WHEN** 已識別使用者在個人頁籤加入台股商品並填寫推薦人
- **THEN** D1 MUST 原子保存商品、伺服器加入日期、推薦人及加入紀錄識別碼
- **AND** 重新載入或從另一裝置登入後 MUST 顯示相同資料

#### Scenario: migration 遇到既有商品
- **WHEN** D1 既有清單項目沒有 `addedAt`
- **THEN** migration MUST 保留該項目並設定 `addedAt=null` 與 `legacy_unknown`
- **AND** MUST NOT 使用 migration 執行日、檔案時間或最後修改日冒充加入日期

#### Scenario: 刪除後重新加入
- **WHEN** 使用者刪除某商品後再次加入
- **THEN** 系統 MUST 建立新的加入紀錄識別碼及新的伺服器加入日期
- **AND** MUST NOT 恢復前一筆已刪除紀錄的 metadata

#### Scenario: 不建立績效資料
- **WHEN** 系統保存、讀取或更新清單商品的加入日期與推薦人
- **THEN** D1 與 API MUST NOT 建立績效結果、交易日窗口或投資報酬欄位
- **AND** 前端 MUST NOT 因 metadata 變更觸發價格追蹤計算

### Requirement: Codex Sites 部署驗收

系統 MUST 在成功建置、API smoke 與核心互動驗證後才建立並部署 Sites 版本；新增 Cloudflare deployment path 後，Sites build 與既有 owner-only 存取行為仍 MUST 保持相容，且 Cloudflare 自動部署不得冒充 Sites 發布。

#### Scenario: Sites 部署成功

- **WHEN** Sites deployment 狀態為 `succeeded`
- **THEN** 回報正式網址
- **AND** 以 Sites 正式網址確認已登入首頁與 `/api/health` 可用
- **AND** 匿名拒絕只作為存取邊界證據，不得代替已登入應用健康

#### Scenario: 只完成 Cloudflare 自動部署

- **WHEN** 某 commit 已自動部署 Cloudflare 但尚未由 Sites 流程發布
- **THEN** 系統 MUST 將 Sites 保留版本與 Cloudflare commit 分開記錄
- **AND** MUST NOT 宣稱 Sites 已部署相同 commit
