## ADDED Requirements

### Requirement: Cloudflare 正式站恢復受控的小型私人群組登入

Cloudflare 正式站 MUST 先驗證 Cloudflare Access JWT，再以私有 D1 `access_users` allowlist 授權人員；正規化 email 對應 `active owner` 或 `active member` 時 MUST 允許使用網站，未列名、inactive、JWT 無效或 D1 不可用時 MUST fail closed。Sites 保留站 MUST 維持既有獨立身分邊界。

#### Scenario: active owner 或 member 登入
- **WHEN** 有效 Access JWT 的正規化 email 對應 D1 中的 `active owner` 或 `active member`
- **THEN** Cloudflare 正式站 MUST 建立已授權使用者 principal 並允許存取一般應用功能
- **AND** MUST 以正規化 email 隔離該使用者的個人頁籤與商品清單

#### Scenario: 未列名、停用或無效身分登入
- **WHEN** Access JWT 無效、email 未列入 D1、記錄為 inactive，或 D1 授權查詢失敗
- **THEN** Cloudflare 正式站 MUST 拒絕存取
- **AND** MUST NOT 建立登入名單、個人頁籤或商品清單資料

### Requirement: owner 可以管理多人登入名單

Cloudflare 正式站 MUST 只向 `active owner` 提供登入名單管理介面與 API，可新增、修改、啟用、停用及刪除 `owner`／`member`；一般 member MUST 不得讀取完整名單或執行管理動作，且系統 MUST 始終保留至少一位 `active owner`。

#### Scenario: owner 新增或重新加入 member
- **WHEN** active owner 提交合法、正規化且尚未存在的 email 作為 active member
- **THEN** 系統 MUST 建立 allowlist 記錄並立即套用於後續登入
- **AND** MUST 保存不含 JWT、cookie、token 或其他秘密的私人稽核紀錄

#### Scenario: member 嘗試管理名單
- **WHEN** active member 呼叫登入名單讀取或寫入 API
- **THEN** 系統 MUST 回覆 `owner_required` 或等價拒絕結果
- **AND** MUST NOT 洩漏完整名單或修改任何記錄

#### Scenario: 嘗試移除最後一位 active owner
- **WHEN** 管理動作會使 active owner 數量變成零
- **THEN** 系統 MUST 以 `last_owner_required` 或等價結果拒絕
- **AND** 原 owner 記錄 MUST 保持不變

### Requirement: 相同登入信箱重新加入後沿用保留的個人資料

個人頁籤與商品清單 MUST 繼續以正規化登入 email 作為 `user_id`，不得改以新產生的 `access_users.id` 作為個人資料鍵。重新建立相同 email 的 allowlist 記錄時，系統 MUST 讀取既有個人資料，不得另建空白身分、跨 email 合併或重寫其他使用者資料。

#### Scenario: 先前成員以相同 email 重新加入
- **WHEN** owner 將先前刪除但仍保留個人資料的相同正規化 email 重新建立為 active member
- **THEN** 該成員重新登入後 MUST 看到原有個人頁籤與商品清單
- **AND** 系統 MUST NOT 變更其他使用者的個人資料

#### Scenario: 以不同 email 新增帳號
- **WHEN** owner 新增一個與既有個人資料 `user_id` 不同的 email
- **THEN** 系統 MUST 視為獨立使用者
- **AND** MUST NOT 自動移轉或合併舊 email 的個人資料

### Requirement: 多人登入不得啟用 Cloudflare 即時行情

恢復小型私人群組登入時，Shioaji 即時行情 production feature flag MUST 維持關閉，Cloudflare runtime MUST NOT 取得 Shioaji API key、secret、憑證或登入資料；owner 與 member MUST 使用相同的既有延遲行情及官方收盤核對備援。

#### Scenario: owner 與 member 使用行情功能
- **WHEN** 任一已授權 owner 或 member 載入台股日、週、月 K 線或報價
- **THEN** 系統 MUST 使用既有非 Shioaji 行情路徑
- **AND** member 不得因 realtime 相關休眠程式取得額外 capability

### Requirement: 小型群組發布必須通過安全與額度驗證

Cloudflare 正式站 MUST 在完整測試、OpenSpec strict、Free-tier 小型群組預算、D1 安全摘要、匿名拒絕、Service Token health 與已登入 owner 驗收成立後才完成發布；實際成員登入驗收若需要不同的既有登入工作階段，MUST 明確記為待使用者完成，不得以模擬、owner session 或匿名結果冒充。

#### Scenario: 發布多人登入版本
- **WHEN** exact commit 部署至 Cloudflare 正式站
- **THEN** 部署證據 MUST 證明 owner 管理能力、member 授權單元／整合測試、個人資料鍵不變及 realtime feature-off
- **AND** 任何尚缺的真實 member session 驗收 MUST 保留為未完成 gate
