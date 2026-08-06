## ADDED Requirements

### Requirement: 雙部署必須隔離 Shioaji 即時能力

Cloudflare 正式站 MAY 透過受保護 realtime hub 使用 Shioaji；Sites 保留站 MUST 維持既有 Yahoo／官方來源或顯示即時能力不可用。任一部署缺少 realtime binding、hosted secret、gateway 或 feature flag 時 MUST fail closed 且不得阻斷既有圖表。

#### Scenario: Cloudflare 正式站完整設定

- **WHEN** Cloudflare deployment 具備 realtime binding、機器授權與已啟用 feature flag
- **THEN** 支援的台股 MAY 使用 Shioaji 即時 K 棒 overlay 與分時走勢
- **AND** `/api/health` MUST 只回傳不含秘密的 realtime enabled、gateway state、source age 與 quota 摘要

#### Scenario: Sites 保留站未接 Shioaji

- **WHEN** 使用者開啟 Sites 保留站
- **THEN** 日週月 K 線與既有功能 MUST 繼續使用現有來源
- **AND** 分時模式 MUST 隱藏、停用或顯示能力不可用
- **AND** MUST NOT 嘗試讀取 Cloudflare realtime secret 或連線

### Requirement: 瀏覽器即時連線必須以頁面為單位共用

Cloudflare 正式站 MUST 以一條 page-scoped WebSocket 或等效連線 multiplex 最多八個 panel 的支援商品；不得為每個 panel 建立一條對外 gateway 或 Shioaji 連線。

#### Scenario: 八圖台股頁面

- **WHEN** 八個 panel 顯示多個支援台股
- **THEN** 瀏覽器 MUST 只建立一條同源 realtime 連線
- **AND** subscription message MUST 只包含 canonical symbol、必要模式與不含個資的 panel routing 資訊

#### Scenario: panel 換商品或頁面關閉

- **WHEN** panel 切換商品、換頁、進入背景或頁面 unload
- **THEN** page-scoped coordinator MUST 更新或釋放不再需要的 symbol
- **AND** MUST NOT 讓 gateway subscription 因瀏覽器異常離線永久累積

### Requirement: Cloudflare 正式站必須只允許唯一 owner

Cloudflare 正式站 MUST 同時以 Cloudflare Access JWT、D1 active `owner` 與 hosted owner bootstrap 邊界限制人員登入；`member` 或其他 Google 身分 MUST fail closed。owner 身分的信箱 MUST NOT 硬編碼於 source、前端資產、OpenSpec 或日誌。Sites 保留站 MUST 維持獨立既有身分邊界。

#### Scenario: 唯一 owner 登入正式站

- **WHEN** Cloudflare Access 已驗證的人員身分對應 D1 唯一 active owner
- **THEN** Worker MUST 建立 `owner` principal 並允許既有網站功能
- **AND** 即時能力仍 MUST 另外通過 feature flag、binding 與 hosted ingest secret gate

#### Scenario: member 或其他身分嘗試登入

- **WHEN** Access JWT 對應 D1 `member`、未列名或 inactive 身分
- **THEN** Worker MUST 回覆 `403`
- **AND** MUST NOT 回傳圖表、清單、即時 capability 或建立個人狀態

#### Scenario: owner 嘗試新增登入帳號

- **WHEN** owner 呼叫站內新增登入帳號 API
- **THEN** API MUST 以 `single_owner_mode` 拒絕
- **AND** D1 MUST 維持只有一位 active owner

### Requirement: 既有市場與功能不得依賴 Shioaji

Shioaji 只可成為支援台股的可選盤中來源；美股、匯率、債券、期貨、加密貨幣、籌碼、本益比、清單與登入管理 MUST 維持既有 provider 與局部降級行為。

#### Scenario: Shioaji 整日不可用

- **WHEN** gateway 未啟動或 provider 整日不可用
- **THEN** 非台股市場與所有非行情功能 MUST 正常運作
- **AND** 台股 MUST 使用既有延遲來源與盤後官方核對
- **AND** Cloudflare deployment MUST NOT 因 realtime health 失敗而整站回滾
