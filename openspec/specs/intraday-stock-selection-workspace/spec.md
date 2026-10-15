# intraday-stock-selection-workspace Specification

## Purpose
TBD - created by archiving change add-configurable-intraday-relative-volume-monitor. Update Purpose after archive.
## Requirements
### Requirement: 版面選單必須以新分頁開啟盤中選股 workspace

RealTimeStock 本機主介面的 viewport-safe「版面」選單 MUST 提供「盤中選股」入口。啟用後 MUST 同步開啟同源完整交易終端新分頁，保留頂部工具列，並套用專用 route／workspace identity；MUST NOT 在來源主頁套用 preset、覆寫 current workspace、切換自選清單或變更選取商品。

直接開啟合法盤中選股 URL MUST 顯示相同完整 workspace。開新分頁 MUST 保留 `noopener` 隔離；`window.open` 因 `noopener` 回傳 `null` 時，來源頁 MUST NOT 將其當成 popup 已被阻擋的證據並顯示自製警告。popup 真正被阻擋時 MUST 保留瀏覽器原生可操作的阻擋指示與相同入口的重試能力；本機監控服務不可用時 MUST 在新頁提供可操作原因。任何失敗都 MUST NOT 誤報為監控已啟動或自行啟停服務。

#### Scenario: 從版面選單開啟盤中選股

- **WHEN** 使用者在「版面」選單啟用「盤中選股」
- **THEN** 系統 MUST 同步開啟或聚焦專用新分頁，並保留來源主頁的 workspace、自選清單與選取商品
- **AND** 新分頁 MUST 取得自己的 selection generation 與 page lease identity

#### Scenario: `noopener` 開頁回傳空值

- **WHEN** 使用者啟用「盤中選股」，瀏覽器以 `noopener` 開啟新分頁並讓 `window.open` 回傳 `null`
- **THEN** 來源頁 MUST NOT 顯示「瀏覽器已阻擋」或其他肯定開頁失敗的自製 alert
- **AND** 來源頁 MUST NOT 變更目前版面、自選清單或選取商品

#### Scenario: 直接開啟盤中選股網址

- **WHEN** 使用者從書籤或貼上合法盤中選股 URL
- **THEN** 系統 MUST 顯示完整交易終端、盤中監控、達標結果與 K 線，不得退回只有設定表單的獨立根頁面

#### Scenario: popup 或服務不可用

- **WHEN** 新分頁被瀏覽器阻擋，或盤中監控本機服務無法回應
- **THEN** 系統 MUST 保留瀏覽器原生阻擋指示及相同入口重試能力，或在已開啟的新頁顯示精確可操作的服務錯誤原因
- **AND** 系統 MUST NOT 修改來源 workspace 或自動啟動／重啟任何 runtime

### Requirement: 專用 workspace 必須在可視區域安排監控、結果與 K 線

桌面 viewport 下，新分頁 MUST 以左側操作區與右側 K 線主面板並排；左側 MUST 包含「盤中監控」設定／狀態及「盤中選股」即時結果，右側 MUST 至少包含一個 K 線圖。左右主區 MUST 使用 grid 可視高度，內容過長時各自在面板內捲動，不得以增加整頁高度讓必要控制永久落出 viewport。

窄寬或 600 CSS px 高 viewport 下，系統 MUST 改用可操作的堆疊、分頁或可調整配置，並保持名單輸入、啟動狀態、結果、K 線、加入清單及錯誤原因可由鍵盤抵達。來源主頁與盤中選股 workspace 的拖拉、縮放或面板狀態 MUST 隔離。

#### Scenario: 桌面寬版配置

- **WHEN** viewport 足以並排顯示兩個主區
- **THEN** 左側 MUST 顯示監控與結果、右側 MUST 顯示 K 線，兩側底部不得超出 workspace 可視區域

#### Scenario: 短 viewport 與特大字級

- **WHEN** viewport 高度為 600 CSS px 或使用特大字級
- **THEN** 所有必要控制與狀態 MUST 可由捲動及鍵盤抵達，文字不得被永久裁切，列表操作不得意外拖動 workspace

#### Scenario: 修改專用 workspace

- **WHEN** 使用者在盤中選股分頁調整面板大小或位置
- **THEN** 變更 MUST 只作用於該專用 workspace identity，不得覆寫來源主頁 current workspace 或具名版面

### Requirement: 盤中監控面板必須提供完整名單與容量設定

「盤中監控」面板 MUST 支援單筆搜尋新增、批次貼上代號、從既有 RealTimeStock 自選清單匯入、從 MultiView「我的清單」頁籤匯入，以及從已保存的收盤後選股結果匯入。匯入 MUST 先解析 canonical 台股整股 STK 合約、去重並顯示可接受、重複、非法及超過 200 上限的逐項結果；未經使用者明確提交 MUST NOT 修改已保存名單。

MultiView「我的清單」匯入 MUST 只使用 5174 loopback 的唯讀個人清單模式，列出各頁籤可匯入的台股檔數並排除美股、指數、期貨、匯率及其他非台股 symbol。讀取 MUST NOT 要求 realtime watchlist 同步、修改 MultiView `user_tabs`／`user_instruments`、切換 MultiView 目前頁籤或改動既有行情連線。使用者選定頁籤並按「匯入草稿」後，每個代號仍 MUST 由當期 Shioaji 合約 API 驗證；MultiView 名稱或 suffix 不得直接成為監控合約 authority。

單筆搜尋 MUST 同時支援股票代號精確／前綴搜尋與繁體中文股名模糊搜尋。候選 MUST 顯示股名、代號及上市／上櫃市場；同名或模糊結果不得在未選定候選時自行加入。搜尋候選只具顯示與選取用途，加入草稿前仍 MUST 由當期 Shioaji 合約 API 驗證為 canonical 台股整股 STK。搜尋來源離線、逾時或資料不合法時 MUST 明示股名搜尋不可用，但 MAY 保留直接輸入合法代號的功能，不得把來源失敗顯示成「查無結果」。

面板 MUST 提供啟用／停用、刪除、穩定排序、全域門檻及逐商品覆寫，並在頂端分開顯示 configured、eligible、pilot cohort、data-active、waiting gate、waiting pilot limit、waiting baseline 與 degraded。provider physical usage、other usage 與 headroom MUST 顯示為 unknown，不得以 configured、SSE connection count 或 request 數推算。每列 MUST 顯示代碼、名稱、市場、來源、有效門檻、baseline 日期／狀態、KBar receipt 狀態、目前 completed minute、ratio、最後更新與 reason。

在桌面左欄寬度下，容量摘要的每個 label 與 value MUST 在同一列內緊湊顯示並依可用寬度自動換欄；狀態警示、通知控制與結果／名單切換 MUST 使用緊湊字級與間距，將左側剩餘可視高度優先留給監控商品設定與股名清單，但不得縮減可辨識文字、focus 或鍵盤可及性。

容量摘要中的長狀態值 MUST 完整顯示，不得因與一般數值共用固定欄寬而被省略；狀態項 MAY 跨越多欄並使用較收斂的字級層級。桌面左欄仍足以容納時，每張監控商品卡的代碼與股名、市場與來源、監控開關、個別門檻及排序／刪除操作 MUST 優先排在同一控制列，證據資訊 MUST 以緊湊換行呈現；只有真正窄寬時才可退回兩欄或多列配置。

#### Scenario: 左側監控區緊湊顯示容量與控制

- **WHEN** 桌面盤中選股 workspace 的左側面板顯示完整容量摘要、狀態警示、通知控制與頁籤
- **THEN** 每個容量指標的 label 與 value MUST 位於同一列，固定資訊區 MUST 不以過大字級或留白排擠監控商品清單
- **AND** 長狀態值 MUST 完整可見；桌面左欄中的監控商品主要控制 MUST 優先使用單列排列，避免不必要的第二控制列
- **AND** 顯示寬度不足時 MUST 自動換欄或換行，不得以水平溢出、裁掉必要控制或移除可存取名稱來壓縮高度
- **AND** 名單已有商品時 MAY 預設收合較低頻的新增／匯入工具，但必須保留可辨識、可由鍵盤展開的入口；空名單時 MUST 自動展開這些工具
- **AND** 700 CSS px 以下的短 viewport MAY 將容量指標改為可捲動的單排橫向摘要，以保留監控商品列表高度；全部指標文字與可存取名稱 MUST 仍保留

#### Scenario: 批次貼上混合輸入

- **WHEN** 使用者貼上合法代號、重複代號、非 STK 商品及無法解析內容
- **THEN** 面板 MUST 在提交前分組顯示結果，且只有使用者確認後才原子保存合法去重集合

#### Scenario: 以股名模糊搜尋並選定候選

- **WHEN** 使用者輸入完整或部分繁體中文股名，搜尋回傳多個相近商品
- **THEN** 面板 MUST 依來源排序顯示每個候選的股名、代號與上市／上櫃市場，並允許 pointer 或鍵盤明確選定其中一檔
- **AND** 只有選定候選再執行「加入草稿」後，系統才可驗證並加入該代號；不得因同名或第一筆模糊結果自動加入

#### Scenario: 股名搜尋來源暫時不可用

- **WHEN** MultiView 本機商品搜尋離線、逾時或回傳不合法資料
- **THEN** 面板 MUST 顯示股名搜尋目前不可用，MUST NOT 顯示為查無結果
- **AND** 使用者仍 MAY 直接輸入合法股票代號，交由 Shioaji 合約 API 驗證後加入草稿

#### Scenario: 監控卡片載入股名時發生暫時錯誤

- **WHEN** 已設定商品的第一次股名查詢在頁面初始化或狀態更新競速中失敗
- **THEN** 卡片 MUST 保留股票代號與市場、明示名稱仍在載入，並以有界重試取得已驗證股名
- **AND** 成功後 MUST 顯示「股票代號＋股名」，不得因先前一次失敗永久只顯示代號

#### Scenario: 從自選清單匯入

- **WHEN** 使用者選擇一個既有自選清單並明確匯入
- **THEN** 系統 MUST 只複製可驗證的台股整股 STK 合約至監控 draft，不得修改來源清單、目前作用中清單或訂閱狀態

#### Scenario: 從 MultiView 我的清單匯入台股

- **WHEN** 使用者選擇 MultiView「我的清單」中的一個頁籤並明確按下「匯入草稿」
- **THEN** 面板 MUST 顯示該頁籤的可匯入台股檔數，只將通過 Shioaji canonical 台股整股 STK 驗證的商品加入監控 draft
- **AND** 美股、指數、期貨、匯率及其他非台股商品 MUST 在送交合約驗證前排除，MultiView 清單與目前頁籤 MUST 保持不變
- **AND** 未再按下「儲存設定」前，已保存的監控設定 MUST 保持不變

#### Scenario: MultiView 我的清單不可用

- **WHEN** 5174 loopback 離線、逾時、未通過身分邊界或回傳資料不合法
- **THEN** 面板 MUST 顯示無法讀取並提供有界重新讀取操作，不得把失敗解讀為空清單或改用遠端正式站

#### Scenario: 設定 200 檔但只能啟用部分

- **WHEN** configured 為 200，但 admission 只核准 123 檔
- **THEN** 面板 MUST 同時顯示 configured 200、active 123 及其餘逐項等待原因，MUST NOT 顯示「200 檔監控中」

### Requirement: 頁面 lease 與通知狀態必須可見且受使用者控制

新分頁 MUST 在掛載時取得 lease、以有界 heartbeat 續期，並在失效時立即將監控狀態標示為 paused／reconnecting；UI MUST NOT 只因 SSE 連線存在或 health 成功就顯示即時監控正常。正常關頁 MAY best-effort release，但 lease TTL MUST 能在未執行 unload handler 時回收。

頁內結果更新 MUST 不依賴 Notification 權限。聲音與系統通知 MUST 預設關閉，只有使用者明確開啟且瀏覽器權限合法時才可使用；denied、default、不支援或 lease 不存在時 MUST 顯示狀態且不得反覆要求權限。歷史 trigger、重播、重整與 reconnect MUST NOT 補發通知。

#### Scenario: lease heartbeat 中斷

- **WHEN** 分頁仍顯示但 lease 已過期或 renew 失敗
- **THEN** 面板 MUST 顯示監控已暫停及原因，所有新結果／通知 MUST 停止，既有結果仍可作歷史檢視

#### Scenario: 使用者啟用系統通知

- **WHEN** 使用者明確啟用通知且瀏覽器權限為 granted、lease 有效並收到新的 live trigger
- **THEN** 系統 MAY 發出一筆對應 event id 的通知，並仍將結果加入頁內清單

#### Scenario: Notification 權限被拒絕

- **WHEN** 瀏覽器權限為 denied
- **THEN** 面板 MUST 顯示系統通知不可用並保留頁內結果，MUST NOT 循環彈出權限要求或把功能誤報為已開啟

### Requirement: 即時結果必須呈現可稽核 evidence 與完整狀態

「盤中選股」結果清單 MUST 以 immutable trigger event 為基礎，顯示代碼、名稱、市場、觸發時間、目前 ratio、觸發時 ratio、門檻、今日與上一交易日日期／同分鐘累積量、minute key、live／historical 類型、baseline／source 狀態及最後更新。排序 MUST 至少支援觸發時間、ratio 與代碼，並以 event id 穩定去重。

若下一交易日使用 `historical_repaired_verified` baseline，evidence 詳情 MUST 明確顯示其修復 provenance，並與 `live_full_session_verified` 區分。回補完成不得在中斷交易日新增結果列、聲音、系統通知或 retroactive trigger；UI MUST NOT 把 `baselineUsable=true` 顯示成該日 `liveCaptureAcceptance=true`。

面板 MUST 區分尚未開始、等待 bounded Gate、等待 pilot limit、等待基準、監控中、部分 degraded、服務離線、無達標及已有結果。unknown 或 stale 商品 MUST 可查閱 reason，但不得出現在達標清單或被通知。新交易日只有在 calendar／session authority 完成推進後才可把舊結果轉為歷史。

#### Scenario: live trigger 顯示完整比較

- **WHEN** 商品在 10:05 completed minute 首次達到 2 倍
- **THEN** 結果列 MUST 顯示兩個交易日、10:05 minute key、兩側累積量、門檻、觸發時 ratio、目前 ratio 與 live 標記

#### Scenario: 歷史補算結果

- **WHEN** 開頁後重播出一筆開頁前已達標事件
- **THEN** 結果 MUST 標示 historical／不補發通知，並提供最早可驗證的 trigger minute

#### Scenario: 服務離線但已有結果

- **WHEN** 本機服務中斷且 UI 已載入當日結果
- **THEN** 結果 MAY 保留供檢視，但 MUST 顯示最後合法更新、離線／stale 狀態並停用會被誤解為當期即時的操作
- **AND** K 線及其他可獨立工作的面板 MUST 不因監控服務離線而被自動關閉

### Requirement: 點選結果只能連動同頁指定且未鎖定的 K 線圖

結果內容的 pointer、touch 與 keyboard action MUST 只更新同一盤中選股 workspace 中，當下重新驗證仍存在且未鎖定的指定 K 線圖。只有一個可用目標時 MUST 自動選定；有多個時 MUST 提供可辨識的 target 選擇器。contract、Snapshot 與 chart target MUST 綁定同一 selection generation，過時回應不得覆寫較新的選取。

點選結果 MUST NOT 加入自選清單、修改來源主頁或其他分頁圖表、變更全域選取商品、下單商品、智慧單、數量、價格或交易草稿，也不得取得新的盤中監控 demand。

#### Scenario: 點選未加入自選清單的結果

- **WHEN** 使用者點選一筆合法盤中結果且同頁有指定未鎖定 K 線
- **THEN** 該 K 線 MUST 顯示相同 canonical 商品及一致標題／行情，來源主頁與所有交易狀態 MUST 保持不變

#### Scenario: 快速點選 A 再點 B

- **WHEN** A 的 contract 或 Snapshot 回應在 B 已選取後才抵達
- **THEN** A 的過時 generation MUST 被忽略，K 線 MUST 保持 B，且 UI 不得把 A 標示為連動成功

#### Scenario: 所有圖表皆鎖定

- **WHEN** 使用者點選結果但同頁沒有未鎖定 K 線
- **THEN** 系統 MUST 提示解鎖或明確新增 K 線，不得自動解鎖、改動其他分頁或把商品加入清單

### Requirement: 每筆結果必須提供互斥的加入盤中選股清單動作

每筆可操作結果右上方 MUST 提供可辨識為「加入盤中選股清單」的獨立按鈕，具清楚的 hover、focus、pending、success、already present 與 error 狀態。按鈕與結果內容 action MUST 互斥：只有明確啟用按鈕才可要求 watchlist mutation；啟用按鈕 MUST NOT 同時觸發 chart pick。

系統 MUST 將結果解析為合法台股整股 STK 合約，再尋找正規化後名稱精確為「盤中選股」的 server-backed 自選清單。清單不存在時 MUST 建立；商品已存在時 MUST 回覆 `already_present` 成功終態而不重複加入。mutation MUST NOT 切換目前作用中的清單、改寫 storage identity、加入「選股」或其他清單，亦不得影響 MultiView `user_tabs`／`user_instruments`。

#### Scenario: 第一次加入且清單不存在

- **WHEN** 使用者按下合法結果的加入按鈕，且不存在名稱精確為「盤中選股」的自選清單
- **THEN** 系統 MUST 建立該清單並只加入該商品一次，來源主頁目前作用中的清單 MUST 保持不變

#### Scenario: 商品已存在

- **WHEN** 使用者再次加入已存在於「盤中選股」清單的相同 canonical 合約
- **THEN** 系統 MUST 回覆 `already_present` 並顯示已加入，清單內不得產生重複項目

#### Scenario: 點選結果內容而非按鈕

- **WHEN** 使用者只啟用結果內容
- **THEN** 系統 MUST 只執行 K 線連動，MUST NOT 建立清單、加入商品或顯示加入成功

#### Scenario: watchlist API 失敗

- **WHEN** 建立清單或加入商品失敗、逾時或結果不明
- **THEN** UI MUST 顯示安全錯誤並重新讀取清單對帳，MUST NOT 未確認即顯示成功或自動重送非冪等 mutation

### Requirement: 多分頁與跨元件狀態必須隔離且一致

每個盤中選股分頁 MUST 擁有獨立 workspace、chart target 與 selection generation，但共用 server-side monitor session、設定 revision、capacity、trigger ledger 及 server-backed watchlist。任一分頁修改監控設定後，其他分頁 MUST 以 revision／invalidation 重新讀取，不得以較舊 local draft 覆寫；衝突 mutation MUST fail closed 並要求使用者重新載入。

自選清單 mutation 成功後 MUST 透過既有安全 invalidation 讓其他 RealTimeStock 分頁可重新讀取，但不得自動切換任何分頁的 active list。盤中監控設定或結果 MUST NOT 寫入 MultiView D1 個人清單或既有盤後選股偏好 key。

#### Scenario: 兩分頁同時修改設定

- **WHEN** 分頁 A 已提交 revision 8，而分頁 B 仍以 revision 7 提交
- **THEN** B 的 mutation MUST 被拒絕為 revision conflict，且 revision 8 MUST 保持不變

#### Scenario: 另一分頁加入自選清單

- **WHEN** 分頁 A 成功加入「盤中選股」清單，而來源主頁目前作用中的清單是「我的自選」
- **THEN** 來源主頁 MAY 重新讀取清單 metadata，但 MUST 繼續顯示「我的自選」且不變更選取商品

#### Scenario: 重整盤中選股分頁

- **WHEN** 使用者重整分頁
- **THEN** 新 client identity MUST 重新取得 lease、讀取 server-side 設定與當日 trigger ledger，並建立新的 selection generation
- **AND** 重整 MUST NOT 重複訂閱、重複通知或用舊 local result 覆寫 server evidence

### Requirement: 操作介面必須可由鍵盤使用且不得偽報即時狀態

名單輸入、匯入、門檻、啟用、排序、狀態詳情、結果、K 線 target、通知開關與加入清單 MUST 具有可辨識名稱、可見 focus 及合理 tab order。顏色 MUST NOT 是 active／waiting／matched／unknown／error 的唯一辨識方式；動態狀態 MUST 以適當 live region 呈現且不得每個 tick 洗版。

UI MUST 以 lease、Gate 0、subscription confirmation、baseline completeness、completed-minute watermark 與 source freshness 的共同狀態決定「監控中」。HTTP health、SSE heartbeat、已保存設定或 configured 數量任一單獨條件 MUST NOT 被顯示成即時監控正常。

#### Scenario: 以鍵盤完成加入清單

- **WHEN** 使用者只使用鍵盤走訪結果內容與加入按鈕
- **THEN** 兩個 action MUST 各自取得可見 focus 及可辨識名稱，啟用加入按鈕不得穿透觸發 K 線連動

#### Scenario: health 正常但 baseline 未就緒

- **WHEN** 本機 API health 成功且 SSE heartbeat 存在，但商品 baseline 缺漏
- **THEN** 該商品 MUST 顯示 `waiting_baseline` 而非監控中，且不得列入 active comparable 數量

#### Scenario: 高頻 ratio 更新

- **WHEN** 多檔商品在短時間內更新 ratio
- **THEN** UI MUST 合併視覺更新並維持列表操作與焦點，不得對每個 tick 發出 live-region 宣告或重建整個 workspace

### Requirement: 盤中選股流程不得擴大交易與服務生命週期權限

開啟、設定、監控、點選結果、通知或加入清單 MUST NOT 啟動 production、建立第二個 login、送出 broker write、修改策略／智慧單、啟停 simulation API、watchdog、5173／5174、盤後 pipeline 或既有行情連線。功能只能使用已存在且已驗證的 simulation business session；session 不可用時 MUST 顯示 paused／offline 並保留 workspace。

#### Scenario: simulation business session 不可用

- **WHEN** 使用者開啟盤中選股分頁但 simulation business session 尚未建立
- **THEN** workspace MUST 保持可用並顯示監控不可用原因，系統 MUST NOT 自動登入、切換 production 或重啟服務

#### Scenario: 使用完整盤中選股流程

- **WHEN** 使用者設定名單、等待觸發、點選 K 線並加入「盤中選股」清單
- **THEN** broker write attempt、order／position mutation、smart-order activation 與 service lifecycle mutation MUST 全部為 0

### Requirement: 收盤尾筆例外必須與原live覆蓋及盤後補算分開呈現

API／UI MUST保留原daily executionOutcome、逐檔live coverage與原失敗原因，另呈現經驗證的收盤尾筆例外產品判定、政策版本與補算時間。通過時MUST顯示「日常運作通過（收盤尾筆例外）」及「盤後補算，不通知」；補算列MUST列出商品、13:30今日／前日累積量、有效門檻與比較版本、量比或零分母原因、是否符合，不能塞入原即時trigger清單或提升通知權限。artifact缺席、損壞或不符原summary時MUST顯示待補算／未通過而非預設成功。

#### Scenario: 原live部分收尾而例外產品通過

- **WHEN** 原live為157／160而三筆盤後補算完整驗證且例外政策通過
- **THEN** 面板MUST同時顯示157／160原live及例外通過，三筆補算標為非即時；原結果、排序與門檻／名單草稿不得變動

#### Scenario: 收尾後重新載入結果超過單頁

- **WHEN** 當日已有245筆持久化結果而本機API每頁最多100筆，原通知lease已結束
- **THEN** 面板MUST沿本機cursor有界讀完三頁，不能只顯示首100筆或依賴重新開行情連線補齊
- **AND** generation或repository revision跨頁改變、cursor循環、20秒期限或32頁上限到達時MUST拒絕假稱完整並保留既有結果，不新增broker登入／訂閱／通知

### Requirement: 盤中快捷門檻必須呈現真正生效狀態

面板 MUST 提供1.5／2／3倍快捷操作，盤中只修改門檻時 MUST 可立即要求原runner安全套用，不夾帶未保存名單草稿。MUST 分列savedRevision、activeComparisonRevision、目前有效門檻、套用中／已生效／失敗／無active owner及實際effectiveAt／逐檔effectiveMinute；未取得runner與durable切換收據確認前，不得因config保存HTTP200而顯示已生效。未知schema或舊runtime MUST 明示不支援即時切換，不能靜默fallback宣稱成功。

切換後最後封閉分鐘的重新符合 MUST 標示「門檻調整後符合」，不補發聲音／系統通知；原歷史trigger的門檻、版本與時間 MUST 保留。多分頁及快速連按須使用原子revision與冪等請求，同門檻重複要求不得建立假生效或重複通知。

#### Scenario: 門檻已保存但runner尚未確認

- **WHEN** config已儲存而active comparison仍是舊版本
- **THEN** 面板 MUST 顯示「套用中」與舊有效門檻，不得把saved revision當已生效

#### Scenario: 只有名單草稿未儲存

- **WHEN** 使用者有未保存的名單草稿並點選3倍即時門檻
- **THEN** MUST 只提交已保存設定的門檻變更，保留名單草稿，且不得額外訂閱商品

### Requirement: 日常狀態必須分開呈現監控與基準完整性

長駐分頁 MUST 隨台北實際日期更新查詢範圍，並在背景暫停後復原時重新核對。跨日 MUST 隔離前日結果、cursor、盤後投影及舊非同步回應，保留使用者設定與未儲存名單草稿；同日檢查不得反覆建立頁面lease或事件連線。日期修正 MUST NOT 重啟背景owner、券商登入或訂閱。

#### Scenario: 昨日開啟的分頁在今日仍持續使用

- **WHEN** 分頁載入於10/14，而台北時間已到10/15或從背景復原
- **THEN** MUST 自動讀取10/15結果，前日cursor不得沿用，前日遲到回應不得混入今日結果
- **AND** 背景行情owner與未儲存草稿 MUST 保持，不能靠每日整頁重載作為正常跨日功能

盤中選股 API／面板 MUST 明列 schemaVersion、runtimeMode、tradeDate、設定／plan、generation，並分別呈現今日監控、逐檔 live coverage／最後有效分鐘、前日基準、下一交易日基準與選用診斷。今日 live partial 與下一日 baseline ready 可以同時成立；diagnostics disabled／not_requested 不得顯示為啟動失敗。

歷史 Stage 容量資訊 MUST 保留在可收合說明，不得標成今日 live GO。v2 品質 MUST 明列實際總量核對狀態，不使用假的 `readyForBundle=true` 或 formal acceptance 欄位；相容舊 client 的未知 schema／欄位 MUST 顯示 unknown 而非預設成功。

#### Scenario: live 尾端 partial 但盤後基準 ready

- **WHEN** 本日有單檔尾端缺口，而新版盤後基準已完整發布
- **THEN** 面板 MUST 分別呈現缺口與翌日可用，不得互相覆蓋或把歷史回補顯示成 live 成功

#### Scenario: 舊版 client 收到新基準

- **WHEN** client 無法辨識 v2 或缺少某項檢查資料
- **THEN** client MUST 顯示未知／需更新，不得把缺欄位當作零缺口或完整驗收

### Requirement: 收尾後結果與背景資料活動必須維持誠實

面板 MUST 從實際收到的資料與持久化水位呈現 data activity／freshness，不依賴圖表可見性、週期或 render commit。收尾後 MUST 保留合法唯讀結果、顯示 execution ended 與最後比較分鐘，關閉新通知權限；歷史觸發值、最後有效量比及目前資料有效性 MUST 分開標示。

每筆已接受的封閉分鐘 observation MUST 將分鐘鍵、今日累積量及可取得的前日同分鐘累積量同步保存於當日 session 的逐檔水位，供 API 投影使用；前日基準不存在時 MUST 明列 null。session 已非 current 時，API MUST NOT 將保存的舊水位顯示成當下即時資料。此投影不得額外訂閱行情或把不連續的分鐘算作可比較結果。

#### Scenario: 圖表關閉但仍收到資料

- **WHEN** 主圖不可見但背景收到合法來源事件
- **THEN** 面板 MUST 正常更新 data activity，不要求切到 1 分 K

#### Scenario: 背景已保存分鐘但逐檔 API 水位缺失

- **WHEN** 日常 runtime 接受某商品的 09:02 封閉分鐘，SQLite 已保存今日累積量與可用的前日同分鐘基準，且當日 session 仍 current
- **THEN** status API MUST 顯示該商品的 09:02、今日及前日累積量；若 session 失效則不得沿用該水位宣稱即時更新

#### Scenario: 整日結果已停止更新

- **WHEN** runtime 已正常收尾
- **THEN** 面板 MUST 保留結果並顯示已結束／資料時間，不得因沒有 capture 或圖表 commit 清空結果，也不得把舊 trigger 當作仍可即時通知

### Requirement: 盤中監控畫面必須區分原始 live 與盤後尾端復原

查詢既有舊版 v1 復原 artifact 或另經要求的 legacy diagnostic 時，盤中監控 API 與面板 MUST 分別呈現當日原始 live 資料範圍、最後連續封閉分鐘、原始收尾與正式驗收結果，以及盤後復原範圍、來源與驗證狀態。盤後補值 MUST 明示 `liveDelivered=false`，不得增加即時結果筆數、改寫觸發時間、補發通知，或以「資料已補齊」取代「正式 live 驗收未通過」。舊 client 或缺少復原欄位時 MUST 顯示未驗證，不得預設已復原。

此舊版歷史呈現契約 MUST NOT 要求 daily 建立或執行舊復原工作。現行 daily MUST 依「收盤尾筆例外必須與原live覆蓋及盤後補算分開呈現」及 `intraday-monitor-daily-runtime` 規格，分開顯示原 live partial 與新版產品例外通過；不得將舊版 4 檔／5 分鐘條件或原 Stage 資格套用至新版至多 10 檔、僅缺 13:30 的判定。

#### Scenario: 原始 live 不完整但盤後資料已核實
- **WHEN** 商品原始 live 資料只到 13:29，13:30 由盤後來源核實補齊，且正式 live 驗收未通過
- **THEN** 畫面 MUST 同時顯示盤中與盤後各自範圍、補值 provenance，以及正式 live 驗收未通過，不得把 13:30 標成即時收到

#### Scenario: 整批復原仍不具正式資格
- **WHEN** 多檔尾端缺口超過既有受限例外，盤後驗證已完成全部資料復原
- **THEN** 面板 MUST 顯示「盤後資料已核實」及「當日 live 驗收未通過」兩個獨立狀態，結果清單與通知權限 MUST 維持原始 live 判定

#### Scenario: 來源尚待發布或復原失敗
- **WHEN** verified receipt 尚不存在、來源不完整或與 live 前綴衝突
- **THEN** 面板 MUST 顯示等待或失敗原因與原始缺口，不得顯示已補齊或零成交

#### Scenario: 舊版退役但新版例外產品已通過

- **WHEN** 新版 daily 經合法 v2 與收盤尾筆 Gate 判定產品例外通過，而舊版復原案已退役
- **THEN** 面板 MUST 保留新版產品判定、原 live partial 與非即時補算各自狀態，不因缺少舊版 artifact 誤報新版失敗，也不得將歷史舊案標成 live 驗收通過

### Requirement: 面板必須分開呈現容量核准與今日監控狀態

盤中監控面板 MUST 將 durable capacity approval 與 current-session live status 分成可辨識區塊。容量核准 MUST 顯示 limit、decision、evidence trade date、reviewedAt 與 reviewer type；今日監控 MUST 顯示 authority trade date、session phase、current／stale、data active、control-plane requested、第一筆 KBar 與 freshness。歷史 `GO` MUST NOT 單獨顯示成目前功能正常。

#### Scenario: 9 月 16 日 GO 但 9 月 22 日未啟動
- **WHEN** approval 為 2026-09-16 Stage 160 `GO`，而 2026-09-22 current session 缺失
- **THEN** 面板 MUST 顯示「容量核准：160／GO／2026-09-16」與「今日監控：未啟動」
- **AND** MUST NOT 顯示今天「訂閱已接受」或讓 `GO` 被解讀為今日 live ready

#### Scenario: 今天 session 正在收資料
- **WHEN** current session identity 完整且已有 149 檔收到今日合法第一筆 KBar
- **THEN** 今日監控區 MUST 顯示 `data active 149` 與其餘逐檔狀態，容量核准區仍只呈現 durable decision

#### Scenario: 今日 session 缺失且結果為空
- **WHEN** 歷史容量核准仍為 `GO`，但今日 current session 缺失且當日結果為空
- **THEN** 空結果區 MUST 說明「今日監控未啟動」與沒有可驗證的當日達標結果
- **AND** MUST NOT 顯示「監控已啟動，目前沒有達標結果」；只有 current session、freshness、lease 與 data active 同時成立，才可使用監控已啟動的文案

### Requirement: Reviewer 文案必須符合實際 provenance

面板與 evidence 詳情 MUST 依 review artifact 顯示 `human`、`codex_delegated` 或其他規格允許的 reviewer type。只有人類 reviewer 親自簽核時才能顯示「人工核准」；Codex 依使用者委託代理審閱 MUST 顯示「Codex 代理審閱」，不得假冒使用者或人類簽核。

#### Scenario: Codex 代理審閱的 GO
- **WHEN** review artifact 的 reviewer type 為 `codex_delegated`
- **THEN** 面板 MUST 顯示「Codex 代理審閱」，不得顯示「人工核准」

### Requirement: Stale 與分類統計必須以可理解文案顯示

面板 MUST 顯示互斥 state counts 與獨立 baseline summary，並在 session stale、revision mismatch、artifact invalid、generation mismatch 或 current session missing 時顯示直接原因。provider usage、other usage、ownership、release 與 headroom 未證實時 MUST 保持「未知」，但 MUST 與今日 session 未啟動分開呈現。

#### Scenario: Provider 證據未知且今日 session 缺失
- **WHEN** provider physical evidence 全部未知，且 today current session 未建立
- **THEN** 面板 MUST 同時顯示 provider evidence unknown 與 `current_session_missing`
- **AND** MUST NOT 將 provider unknown 當成今日未啟動的唯一原因，亦不得用 configured、SSE connection count 或 request accepted 推定 capacity

#### Scenario: Waiting baseline 為零但 baseline unknown 非零
- **WHEN** `waitingBaseline=0` 且 baseline summary 的 unknown／missing 大於 0
- **THEN** 面板 MUST 顯示兩組數字及其不同語意，不得顯示「基準完整」或等效成功文案

### Requirement: 背景盤中監控不得依賴 K 線畫面是否開啟或選定週期

正式擷取、`firstKbarAt`、`dataActive`、封閉分鐘比對與收尾驗收 MUST 依背景串流收到並接受的合法 Shioaji KBar 事件及持久化 observation 判定，MUST NOT 依賴任何 K 線畫面、圖表渲染速度、選定週期、頁籤可見性或被動圖表證據檔。`firstKbarAt` 代表後端首次接受的合法 KBar，並不代表畫面已繪製 K 棒；僅收到連線或訂閱確認也不能算資料已活動。開盤資料壅塞時，MUST 將尚未收到、已收到但封閉分鐘未完成、畫面尚未更新分別呈現，不得互相替代。

主工作區 MAY 在今日 Stage 160 session `running` 期間收集既有可見 K 線的真實 visual commit 作為選用 UI 診斷。收集器 MUST 僅讀取現有圖表診斷 DOM，透過既有本機端點提交證據，且 MUST NOT 新增行情訂閱、圖表載入、broker 操作或偽造更新。若提交圖表證據，來源日 MUST 為今日 session，且同圖表後續來源時間 MUST 嚴格前進；重繪昨日 K 棒不能算今日資料。證據缺少或無效時 MUST 明記 `missing`／`invalid`／`unreadable`，不得偽造量測值，也不得使背景監控失敗。

#### Scenario: 只開標準看盤版面
- **WHEN** 今日 Stage 160 session 正在執行、標準看盤版面有可見 K 線，且監控面板未掛載
- **THEN** 真實 K 線 visual commit 推進時仍可提交被動證據
- **AND** 若沒有真實推進，僅將圖表診斷列為未觀測，不得以狀態輪詢代替圖表證據或阻擋背景擷取收尾

#### Scenario: 使用者查看日 K、其他週期或關閉圖表
- **WHEN** 背景行情串流收到並接受今日合法 KBar，且封閉分鐘 observation 可供核對
- **THEN** 盤中監控 MUST 按相同 session 與 generation 更新資料面狀態、結果及正式收尾
- **AND** MUST NOT 要求使用者切到 1 分 K 或保持看盤頁面可見

### Requirement: 大量量比結果必須保持可讀並區分來源

盤中選股面板 MUST 在結果數量超過可見高度時保持每張結果卡片的可讀高度，並由清單獨立捲動；MUST NOT 以 flex 縮小卡片至僅剩邊框。結果總數若同時含即時觸發及歷史重播，MUST 分別顯示兩者筆數，不得將總數誤標為全部即時觸發。

#### Scenario: 狹窄面板載入大量當日結果
- **WHEN** 結果清單含 97 筆，其中 32 筆即時觸發、65 筆歷史重播，且面板高度不足以一次顯示全部卡片
- **THEN** 面板 MUST 顯示分類筆數、保持卡片文字可讀並允許捲動查看後續商品
- **AND** 不得因顯示修正修改結果資料、觸發權限或背景行情訂閱

### Requirement: 今日監控狀態欄必須適應窄面板

盤中監控的今日狀態欄 MUST 在顯示「啟動來源」及長時間戳記後，仍於 480px 寬面板內排版，不得造成狀態區水平溢出。完整內容 MUST 可透過換行、可鍵盤展開的詳情或其他可見文字閱讀；title MAY 輔助但不得成為唯一完整資訊來源，也不得更改 underlying status 語意。

#### Scenario: 13 項今日狀態顯示於窄面板
- **WHEN** 面板寬度為 480px，今日監控含 13 項狀態與完整時間戳記
- **THEN** 狀態欄 MUST 留在可見寬度內，不產生水平捲動或覆蓋鄰近欄位
- **AND** 完整值 MUST 依既有可讀摘要／詳情契約保留，不能只在 title 顯示
