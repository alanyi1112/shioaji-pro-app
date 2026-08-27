## ADDED Requirements

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
「版面」選單 MUST 先保留 `MultiView（開新分頁）` 入口，再於完整預設版面清單之前顯示「儲存目前版面」控制項。具名版面列表、預設版面與重設操作 MUST 有清楚分組，且所有操作 MUST 保持可由同一 viewport-safe popover 抵達。

#### Scenario: 開啟版面選單尋找儲存功能
- **WHEN** 使用者開啟「版面」選單
- **THEN** 使用者 MUST 不需先捲過完整預設版面清單即可看見版面名稱輸入與儲存按鈕

#### Scenario: MultiView 入口保持獨立
- **WHEN** 使用者在重整後的「版面」選單啟用 `MultiView（開新分頁）`
- **THEN** 系統 MUST 維持既有新分頁行為，且 MUST NOT 保存、載入、重設或覆寫目前 workspace

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
