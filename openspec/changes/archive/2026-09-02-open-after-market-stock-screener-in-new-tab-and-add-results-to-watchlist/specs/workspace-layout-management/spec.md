## MODIFIED Requirements

### Requirement: 版面選單必須優先顯示具名儲存入口

「版面」選單 MUST 在完整預設版面清單之前依序提供 `MultiView（開新分頁）` 與「儲存目前版面」控制項。MultiView action MUST 與具名版面、預設版面及重設操作有清楚分組，且所有操作 MUST 保持可由同一 viewport-safe popover 抵達。「預設版面 Presets」區 MUST 顯示「選股篩選」action；啟用後 MUST 以新分頁開啟完整交易終端及左側選股、右側 K 線圖的專用 workspace，不得在來源頁套用 preset。

#### Scenario: 開啟版面選單尋找儲存功能

- **WHEN** 使用者開啟「版面」選單
- **THEN** 使用者 MUST 不需先捲過完整預設版面清單即可看見 MultiView 入口、版面名稱輸入與儲存按鈕
- **AND** 使用者 MUST 可在「預設版面 Presets」區看見「選股篩選」

#### Scenario: MultiView 入口保持獨立

- **WHEN** 使用者啟用 `MultiView（開新分頁）`
- **THEN** 系統 MUST 維持既有新分頁行為，且 MUST NOT 保存、載入、重設或覆寫目前 workspace

#### Scenario: 選股篩選入口開啟完整交易版面

- **WHEN** 使用者啟用「版面 → 預設版面 Presets → 選股篩選」
- **THEN** 系統 MUST 同步開啟具 `layout=stock-screener` 識別的同源新分頁
- **AND** 新分頁 MUST 渲染完整交易終端，不得走 `popout=screener` 的單一選股根頁面
- **AND** 來源頁 MUST 不呼叫預設版面載入或新增面板流程

#### Scenario: 成功開頁不誤報為瀏覽器阻擋

- **WHEN** 瀏覽器已允許來自使用者操作的新分頁
- **THEN** 系統 MUST 以瀏覽器原生 `noopener` 切斷新分頁與來源頁的 `opener` 關係，並導向 `layout=stock-screener`
- **AND** 系統 MUST NOT 因 `noopener` 造成的空回傳而顯示「瀏覽器已阻擋」通知
- **AND** 若新分頁實際被阻擋，系統 MUST 保留瀏覽器原生阻擋指示，MUST NOT 以無法區分成功與阻擋的回傳值顯示自製 alert

#### Scenario: 選股版面不污染來源 workspace

- **WHEN** 使用者在選股版面新分頁拖拉、縮放、新增或移除面板
- **THEN** 變更 MUST 僅存在於該分頁工作階段，MUST NOT 寫入來源頁共用的目前 workspace storage key

#### Scenario: 選股版面貼合可視高度

- **WHEN** 選股版面新頁取得實際 grid 容器高度，或該高度因視窗調整而改變
- **THEN** 系統 MUST 依 row height、row gap 與容器 padding 計算可完整容納的最大 row 數
- **AND** 左側選股與右側 K 線面板 MUST 同步套用該 row 數，不得超過 grid 容器底部

#### Scenario: 短 viewport 與特大字級仍可抵達入口

- **WHEN** 使用者在 600 CSS px 高 viewport 或特大字級以鍵盤開啟並走訪「版面」選單
- **THEN** `MultiView（開新分頁）`、「選股篩選」與所有版面管理操作 MUST 保持可見或可由 popover 捲動抵達
