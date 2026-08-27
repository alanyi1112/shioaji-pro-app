## Context

`HudHeader` 的 `Menu` 目前以按鈕為錨點，使用絕對定位的共用 popover。popover 只有固定寬度，沒有依 viewport 限制最大高度，也沒有垂直捲動；應用程式 shell 固定為可視高度，實際內容改由 grid 容器捲動，因此超出 viewport 的 popover 內容不會因捲動主畫面而重新出現。

「版面」選單目前先顯示 MultiView 與 12 組預設版面，之後才顯示「儲存目前版面」、具名版面列表與重設操作。在較短視窗或較大字級下，核心操作會落到可視區之外。現行 workspace 每次變更都會自動寫入 `sj-pro-workspace-v2`，具名版面則寫入 `sj-pro-profiles-v1`；這次不需要改變資料模型。

## Goals / Non-Goals

**Goals:**

- 讓頂部所有 popover 在目前 viewport 內保持可達，內容過長時由 popover 自身捲動。
- 讓使用者開啟「版面」選單後，不必先越過完整預設版面清單即可看見具名儲存入口。
- 區分新增具名版面與更新同名版面的操作語意，避免無提示覆寫。
- 保留目前 workspace 自動保存、具名版面與預設版面的既有資料格式與操作結果。
- 以元件測試及實際瀏覽器在短 viewport、不同字級與長清單情境驗證可達性。

**Non-Goals:**

- 不新增版面雲端同步、匯入／匯出、跨瀏覽器同步、版本歷程或復原站。
- 不改變 grid 排版演算法、panel 尺寸格式、預設版面內容或 MultiView runtime。
- 不改變 Shioaji session、行情、帳務、委託或 production／simulation 控制。
- 不以第三方 floating UI 套件重做所有選單定位。

## Decisions

### 1. 共用 popover 採 viewport 上限與內部捲動

在共用 `popover` 樣式加入以 dynamic viewport 為基準的 `max-height`／`max-block-size`、`overflow-y: auto`、`overscroll-behavior: contain` 與穩定 scrollbar 空間。選單仍固定由 header 按鈕向下、右側對齊，不改為 portal 或 JavaScript 幾何定位。

選擇共用修正而非只替 `ProfilesMenu` 加例外，是因為 Theme、Risk、Flash 等選單在短 viewport 或放大字級下也可能超高；共用邊界可一次建立一致契約。相較引入 floating-positioning dependency，CSS dynamic viewport 足以處理目前所有選單都位於頂部 header 的限制，風險與改動較小。

### 2. 將具名儲存入口移到預設版面清單之前

「版面」選單維持 MultiView 入口最先出現，其後立即顯示「儲存目前版面」；具名版面列表接在儲存入口之後，預設版面與重設操作放在後段。這讓新建與更新版面成為開啟選單即可辨識的主要工作，不需要依賴使用者知道選單可以捲動。

不採只縮小字級、減少間距或將 12 個 presets 改成雙欄，因為這些做法只能延後溢出，無法處理特大字級、短 viewport 或未來增加具名版面的情境。

### 3. 同名儲存先呈現「更新」語意

輸入名稱會沿用現有 `trim()` 正規化。若正規化後的名稱與既有具名版面完全相同，介面必須在提交前顯示「更新／覆寫既有版面」語意；若不存在則顯示「另存／新增」語意。Enter 與按鈕必須遵循相同判定，不得有其中一條路徑仍靜默覆寫。

這次不改成大小寫不敏感比對，也不新增額外 modal；明確的按鈕與輔助文字即可避免把同名操作誤認為新增。底層仍維持單一同名 profile，不建立重複項目。

### 4. 儲存格式與現有行為保持相容

目前 workspace 繼續在每次 `updateWorkspace` 後寫入 `sj-pro-workspace-v2`。具名版面仍以目前 `Profile[]` 結構寫入 `sj-pro-profiles-v1`，載入時使用 clone，刪除只影響指定 profile，重設只重設目前 workspace，不清除具名版面。

不新增 storage migration 或版本 key，避免既有使用者保存的版面消失，也使變更可直接回退前端程式碼。

### 5. 驗收以可見與可操作結果為準

自動化測試需覆蓋 popover 樣式契約、版面選單順序、新增／同名更新與 Enter 路徑。browser-visible 驗收需在至少 600、768、900 CSS px 高度，以及標準與特大字級下，實際打開選單、捲到末端、儲存、載入、刪除與重設，並確認所有控制項 bounding box 位於 viewport 或可由選單捲動抵達。

僅檢查 class 或原始碼字串存在不足以證明問題已解決。

## Risks / Trade-offs

- [共用 popover 加入捲動可能改變 Risk／Theme 等選單的 wheel 行為] → 使用 `overscroll-behavior: contain`，並逐一快速驗證既有頂部選單可開啟、操作及關閉。
- [特大字級或大量具名版面仍需要捲動] → 目標是所有操作可達而非強迫全部同時可見；儲存入口前移以保證主要操作容易發現。
- [同名判定提示與實際保存邏輯不一致] → 將正規化與是否存在的判定集中為同一 UI 狀態，Enter 與 click 共用同一提交函式並以測試鎖定。
- [瀏覽器對 dynamic viewport unit 支援差異] → 保留 `vh` fallback，再以 `dvh` 覆蓋；本機 Chrome 需完成實際驗收。

## Migration Plan

1. 先加入測試，重現短 viewport 下儲存與末端操作不可達。
2. 套用共用 popover 邊界與選單順序調整，再補齊同名更新提示。
3. 驗證既有 `localStorage` 內容可直接讀取，且存取後 key 與資料結構不變。
4. 完成元件、完整測試、lint、build 與實際瀏覽器驗收後再交付。

回退時只需還原前端元件與樣式；沒有 schema 或資料 migration 需要逆轉。

## Open Questions

無。若未來需要跨裝置版面同步、匯出或版本歷程，另立 change 處理。
