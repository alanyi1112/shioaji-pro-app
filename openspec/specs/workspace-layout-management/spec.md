# workspace-layout-management Specification

## Purpose
規範主交易畫面版面選單的 viewport-safe 可達性、目前 workspace 自動保存，以及具名版面的另存、更新、載入、刪除與預設重設行為。
## Requirements
### Requirement: 頂部 popover 必須在目前 viewport 內保持可達
主交易畫面所有由 header 開啟的 popover MUST 依目前 viewport 限制最大高度；當內容超過可用高度時，popover MUST 提供自身的垂直捲動，且 MUST NOT 將任何必要控制項永久裁切在可視畫面之外。popover 捲動 MUST 與主工作區捲動分離，且不得因 wheel 或 touch overscroll 意外拖動底層工作區。

#### Scenario: 短 viewport 開啟長版面選單
- **WHEN** 使用者在 600 CSS px 高的 viewport 開啟包含完整預設版面與具名版面清單的「版面」選單
- **THEN** popover MUST 保持在 viewport 內，並可由內部捲動抵達儲存、載入、刪除與重設控制項

#### Scenario: 開啟期間改變視窗高度
- **WHEN** popover 開啟期間 viewport 高度縮小或字級切換為特大
- **THEN** popover MUST 依新的可用高度重新受限，且目前內容不得因固定像素高度而永久不可達

#### Scenario: 鍵盤走訪長選單
- **WHEN** 使用者以鍵盤依序移動焦點至目前可視區外的 popover 控制項
- **THEN** popover MUST 捲動使焦點控制項可見，且 MUST NOT 把焦點留在不可見的裁切區域

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

### Requirement: 目前 workspace 與具名版面必須使用不同保存語意
系統 MUST 在 workspace 發生合法版面變更時自動保存目前 workspace。具名版面 MUST 僅在使用者輸入非空白名稱並明確提交時建立或更新；具名保存 MUST 快照提交當下的 workspace，不得與後續目前 workspace 變更共享可變參照。

#### Scenario: 調整目前版面後重新載入
- **WHEN** 使用者移動、縮放、新增或移除面板後重新載入同一 origin
- **THEN** 系統 MUST 從既有目前 workspace storage 恢復最後合法版面，不要求使用者另外按下具名儲存

#### Scenario: 以新名稱另存版面
- **WHEN** 使用者輸入正規化後不存在的非空白名稱並按下儲存或 Enter
- **THEN** 系統 MUST 建立一筆具名版面快照、顯示新增成功訊息，並在版面列表提供載入與刪除操作

#### Scenario: 空白名稱不得提交
- **WHEN** 版面名稱為空字串或僅包含空白
- **THEN** 儲存控制 MUST 保持停用，且 Enter MUST NOT 建立或更新任何具名版面

### Requirement: 同名版面更新不得靜默覆寫
當正規化後的輸入名稱與既有具名版面完全相同時，系統 MUST 在提交前清楚呈現「更新」或「覆寫既有版面」語意。click 與 Enter MUST 使用相同判定與提交路徑；成功後 MUST 只保留一筆同名版面，並以目前 workspace 快照取代舊內容。

#### Scenario: 輸入既有版面名稱
- **WHEN** 使用者輸入與既有具名版面完全相同的名稱
- **THEN** 提交控制 MUST 在寫入前顯示更新語意，不得仍顯示為新增版面

#### Scenario: 以按鈕更新同名版面
- **WHEN** 使用者在更新語意已可見時按下提交按鈕
- **THEN** 系統 MUST 以目前 workspace 更新該具名版面、維持單一同名項目並顯示更新成功訊息

#### Scenario: 以 Enter 更新同名版面
- **WHEN** 使用者在更新語意已可見時於名稱欄按下 Enter
- **THEN** 系統 MUST 執行與提交按鈕相同的更新流程，不得繞過更新提示或建立重複項目

### Requirement: 載入、刪除與重設不得破壞其他保存資料
載入具名版面 MUST 原子套用該快照並更新目前 workspace；刪除 MUST 只移除指定具名版面；重設為預設版面 MUST 只取代目前 workspace。套用預設版面、刪除或重設 MUST NOT 清除其他具名版面。

#### Scenario: 載入具名版面
- **WHEN** 使用者從版面列表選取一筆合法具名版面
- **THEN** 系統 MUST 套用該版面快照、保存為目前 workspace 並顯示已載入訊息

#### Scenario: 刪除單一具名版面
- **WHEN** 使用者刪除一筆具名版面
- **THEN** 系統 MUST 只移除該筆資料，且目前 workspace 與其他具名版面 MUST 保持不變

#### Scenario: 重設目前版面
- **WHEN** 使用者啟用「重設為預設版面」
- **THEN** 系統 MUST 將目前 workspace 恢復為預設配置，且 MUST NOT 刪除任何具名版面

### Requirement: 版面管理必須維持本機相容儲存邊界
目前 workspace 與具名版面 MUST 繼續使用既有同 origin `localStorage` key 與資料結構，不得因此次 UI 修正要求 migration、雲端帳號、行情服務或 broker session。版面資料 MUST NOT 包含帳號、密碼、API key、token 或其他機密值。

#### Scenario: 升級前已有保存版面
- **WHEN** 瀏覽器已存在合法的 `sj-pro-workspace-v2` 與 `sj-pro-profiles-v1` 資料
- **THEN** 更新後系統 MUST 直接載入既有目前 workspace 與具名版面，不得清除、改名或要求 migration

#### Scenario: 行情服務離線時管理版面
- **WHEN** Shioaji business session 或本機行情 listener 不可用
- **THEN** 使用者 MUST 仍可開啟、捲動、儲存、載入、刪除及重設本機版面，且操作不得嘗試 broker write

### Requirement: 專用選股 workspace 必須先於自選清單完成而呈現

版面路由為 `layout=stock-screener` 或 `layout=intraday-stock-selection` 時，系統 MUST 將專用 workspace 的可見性與 server-backed watchlist 初始完成狀態分離。只要 React root 與 grid 容器已就緒，系統 MUST 渲染該 workspace，並只在背景載入 watchlist metadata；一般交易 workspace MUST 保留既有完整啟動政策。

#### Scenario: 從版面選單開啟且 watchlist 尚未完成

- **WHEN** 使用者啟用「版面 → 選股篩選」，新頁已進入 `layout=stock-screener` 但 watchlist 初始化尚未完成
- **THEN** 新頁 MUST 顯示選股與 K 線兩個專用 block
- **AND** MUST NOT 以全頁 loading 遮蔽已可使用的選股功能

#### Scenario: 直接開啟且 watchlist 無回應

- **WHEN** 使用者直接開啟合法的 `?layout=stock-screener` URL，且 watchlist 請求沒有在初始期間回應
- **THEN** 專用 workspace MUST 仍可渲染及操作不依賴 watchlist 的控制

#### Scenario: 盤中選股作用中清單行情持續等待

- **WHEN** 使用者開啟 `layout=intraday-stock-selection`，且作用中自選清單的合約解析或行情訂閱未完成
- **THEN** 新頁 MUST 先顯示盤中監控與 K 線兩個專用 block，不得持續只顯示「載入交易終端…」
- **AND** 開頁 MUST NOT 因作用中清單內容建立 Tick、BidAsk 或 Quote 訂閱
- **AND** watchlist metadata 完成後 MUST 仍可供監控名單匯入使用

#### Scenario: 一般 workspace 維持原啟動契約

- **WHEN** 使用者開啟一般交易 workspace
- **THEN** 系統 MUST 繼續使用其既有 initial loading、watchlist hydrate 與行情啟動政策
