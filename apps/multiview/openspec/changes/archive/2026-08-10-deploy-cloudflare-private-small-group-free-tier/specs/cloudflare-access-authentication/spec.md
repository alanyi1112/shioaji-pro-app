## ADDED Requirements

### Requirement: Cloudflare 人員請求必須驗證 Access JWT

Cloudflare runtime MUST 從 `Cf-Access-Jwt-Assertion` 驗證簽章、issuer、application audience、有效期限及必要 email claim；只有驗證成功後才能建立待授權身分，且 MUST NOT 單獨信任瀏覽器可自行送出的 email header。

#### Scenario: 合法 Google 身分
- **WHEN** Access JWT 簽章有效、`iss`／`aud` 正確、尚未到期且包含可正規化的 email
- **THEN** Worker MUST 建立待授權身分並查詢應用登入名單
- **AND** MUST NOT 因為 Google 身分有效就直接提供應用內容或建立個人資料

#### Scenario: 缺少或偽造身分
- **WHEN** production request 缺少 JWT、簽章無效、audience 錯誤、token 過期或只有自訂 email header
- **THEN** Worker MUST 回傳 `401` 或 `403`
- **AND** MUST NOT fallback 至 `local-sites-user` 或其他共用帳號

### Requirement: Cloudflare 應用授權必須使用 D1 動態登入名單

Cloudflare deployment MUST 使用私有 D1 `access_users` 作為人員授權權威；只有 email 正規化後命中 active 成員的有效 Access JWT 才能存取應用。Google IdP 只證明身分，不得取代應用 allowlist。

#### Scenario: active 成員登入
- **WHEN** 已驗證 JWT 的 email 對應 active `owner` 或 `member`
- **THEN** Worker MUST 以正規化 email 建立已授權 request principal
- **AND** 應用 MUST 允許該使用者讀寫自己的頁籤與商品清單

#### Scenario: 未列名或停用帳號登入
- **WHEN** 已驗證 JWT 的 email 未存在於 `access_users` 或其狀態不是 active
- **THEN** Worker MUST fail closed 並回傳不洩漏完整名單的 `403`
- **AND** D1 MUST 不建立該帳號的頁籤、商品清單或其他個人資料

#### Scenario: 名單查詢失敗
- **WHEN** D1 暫時不可用、migration 未完成或授權記錄無法可靠判讀
- **THEN** Worker MUST 拒絕人員請求並回傳安全 reason code
- **AND** MUST NOT 使用 cached client state、JWT email 或舊 header 繞過名單檢查

### Requirement: 初始擁有者只能由私有 bootstrap 設定建立

Cloudflare runtime MUST 從 hosted secret 取得初始擁有者 email，且只有在 D1 尚無任何 active owner、已驗證 JWT email 精確相符時，才可冪等建立第一位 owner。實際 email MUST NOT 寫入 repository、OpenSpec、前端 bundle 或 log。

#### Scenario: 首次擁有者登入
- **WHEN** D1 尚無 active owner，JWT email 與 bootstrap secret 正規化後相符
- **THEN** Worker MUST 以原子方式建立或啟用該 email 的 owner 記錄
- **AND** 後續 request MUST 依一般 D1 名單流程授權

#### Scenario: 非 bootstrap 帳號搶先登入
- **WHEN** D1 尚無 active owner，但 JWT email 與 bootstrap secret 不符或 secret 缺失
- **THEN** Worker MUST 拒絕登入
- **AND** MUST NOT 建立 owner、member 或個人資料

#### Scenario: 已有 owner 後修改 secret
- **WHEN** D1 已有 active owner，而另一 JWT email 符合後來變更的 bootstrap secret
- **THEN** Worker MUST NOT 自動新增或提升該帳號
- **AND** 新成員與角色變更 MUST 由既有 owner 透過管理 API 完成

### Requirement: 擁有者可以管理登入名單

系統 MUST 提供 owner-only 管理 API 與站內管理介面，可列出、新增、修改、啟用、停用及刪除登入名單；一般 member MUST 不得讀取完整名單或執行任何管理動作。

#### Scenario: owner 新增成員
- **WHEN** active owner 提交合法且尚未存在的正規化 email、`member` 角色與 active 狀態
- **THEN** 系統 MUST 建立登入記錄並立即套用於後續 request
- **AND** MUST 保存 actor、action、target、時間與變更摘要的私人稽核紀錄

#### Scenario: 未填新增帳號仍可關閉管理介面
- **WHEN** owner 開啟登入名單管理介面但未填寫必填的 Google email
- **THEN** 點選「關閉」MUST 直接關閉管理介面
- **AND** MUST NOT 觸發新增表單驗證或送出名單變更

#### Scenario: owner 修改 email 或角色狀態
- **WHEN** active owner 修改既有記錄的 email、角色或 active 狀態
- **THEN** 系統 MUST 原子驗證 email 格式、唯一性及 owner invariant 後保存
- **AND** UI MUST 明示修改 email 不會自動移轉舊 email 的個人頁籤或商品資料

#### Scenario: owner 刪除成員
- **WHEN** active owner 刪除一般 member 或非最後一位 owner
- **THEN** 系統 MUST 移除其後續登入權限並保存稽核紀錄
- **AND** MUST 不連帶刪除該 email 既有個人資料，除非另有明確資料刪除流程

#### Scenario: member 嘗試管理名單
- **WHEN** active member 呼叫名單讀取或寫入 API，或直接開啟管理介面路徑
- **THEN** 系統 MUST 回傳 `403`
- **AND** response MUST 不包含其他成員 email、角色或狀態

### Requirement: 登入名單必須防止擁有者鎖死並保留稽核

名單變更 MUST 始終保留至少一位 active owner；系統 MUST 拒絕刪除、停用或降級最後一位 active owner。成功與被拒絕的敏感管理動作 MUST 只保存必要的私人稽核資料，且不得包含 JWT、cookie、OAuth secret 或 Access token。

#### Scenario: 嘗試移除最後一位 owner
- **WHEN** 管理動作會使 active owner 數量變成零
- **THEN** 系統 MUST 原子拒絕整筆變更並回傳可理解的衝突原因
- **AND** 原 owner 記錄 MUST 保持 active 且角色不變

#### Scenario: email 大小寫或空白重複
- **WHEN** owner 新增或修改為只在大小寫或前後空白不同的既有 email
- **THEN** 系統 MUST 以正規化唯一鍵拒絕重複
- **AND** MUST 不建立兩筆可對應同一 Google 帳號的授權記錄

#### Scenario: 取得稽核紀錄
- **WHEN** active owner 查看名單管理紀錄
- **THEN** 系統 MUST 只回傳管理所需的 actor、target、action、結果與時間
- **AND** 一般 member、未授權身分與公開 health MUST 無法取得該紀錄

### Requirement: 個人資料必須依驗證且獲准的身分隔離

所有個人頁籤、商品清單與其 metadata 的讀寫 MUST 以已驗證且獲准 principal 的 `user_id` 限縮；共享行情、籌碼與估值資料 MAY 供所有已授權使用者共用，但不得包含其他使用者清單內容。

#### Scenario: 多位使用者保存不同清單
- **WHEN** 多個已授權 Google email 分別新增、排序、隱藏或刪除頁籤與商品
- **THEN** 每位使用者重新登入後 MUST 只看到自己的變更
- **AND** 任一使用者不得以 API 參數指定或讀寫另一位使用者的 `user_id`

#### Scenario: 共享市場資料
- **WHEN** 不同使用者請求相同 symbol 的 K 線、籌碼或本益比資料
- **THEN** 系統 MAY 共用相同 market-data cache／rows
- **AND** response MUST 不包含任何使用者 email、個人頁籤或清單 membership

#### Scenario: 共同商品已完成歷史回補
- **WHEN** 不同使用者的個人清單包含相同 `provider + symbol + interval`，且共享 D1 已記錄該商品 full window 完成
- **THEN** 後續使用者 MUST 直接共用相同 `candle_history` 與完成狀態，不得因不同 `user_id` 或 `display_count` 重做 full-range 抓取
- **AND** 正常新交易日更新 MUST 只刷新共享 tail，不得重寫或建立帳戶專屬 K 線歷史

#### Scenario: 新清單商品尚未進入共用目錄
- **WHEN** 已授權使用者保存合資格的 `.TW`／`.TWO` 普通股或 ETF，該商品尚未存在於內建 setup 或 `instrument_catalog`
- **THEN** 系統 MUST 以該使用者已保存且由伺服器讀取的商品 metadata 判定資格，立即啟動日籌碼預熱並冪等登錄 TDCC continuous target
- **AND** 後續帳戶加入相同 symbol 時 MUST 共用 canonical 籌碼與 TDCC rows，不得依 `user_id` 重複保存市場資料
- **AND** eligibility response 與共享市場資料 MUST 不洩漏任何帳戶的清單 membership 或 email

### Requirement: 自動化必須使用獨立機器身分

GitHub Actions 或其他非互動工作 MUST 使用 Cloudflare Access Service Token 通過 edge policy，並使用資料管線專屬 secret 通過應用層授權；人員 Google session 與 D1 人員名單不得作為排程憑證。

#### Scenario: 已授權資料排程
- **WHEN** workflow 同時提供有效 Access Service Token 與正確的 pipeline secret
- **THEN** 受保護 control／ingest endpoint MUST 接受 bounded request
- **AND** audit／health MUST 將 trigger 標示為機器工作而非某位 Google 使用者

#### Scenario: 只有其中一層授權
- **WHEN** request 只有 Access Service Token 或只有 pipeline secret
- **THEN** 系統 MUST 拒絕資料寫入或 orchestration action
- **AND** response／log MUST 不揭露哪個 secret 值或其內容

### Requirement: 舊資料遷移必須使用明確身分對應

Codex Sites 既有個人資料遷移到 Cloudflare D1，或管理者修改登入 email 後需要轉移資料時，MUST 由已驗證來源 `user_id` 明確對應至目標 Google email；無法證明對應時不得自動合併、覆蓋或轉讓個人資料。

#### Scenario: 來源與目標 email 已確認
- **WHEN** owner 明確確認 Codex Sites 身分或舊 email 與 Cloudflare Google email 的對應
- **THEN** migration MUST 以 additive／upsert-safe 方式轉移該使用者的頁籤、商品與 metadata
- **AND** MUST 以 row count 及非敏感 sample／hash 驗證結果

#### Scenario: email 不同且尚未確認
- **WHEN** 來源 `user_id` 與目標 Google email 不同且沒有明確 mapping
- **THEN** migration MUST 停止該使用者資料合併
- **AND** 來源及目標既有資料 MUST 保持不變
