## ADDED Requirements

### Requirement: 版面選單必須以新分頁開啟盤中選股 workspace

RealTimeStock 本機主介面的 viewport-safe「版面」選單 MUST 提供「盤中選股」入口。啟用後 MUST 同步開啟同源完整交易終端新分頁，保留頂部工具列，並套用專用 route／workspace identity；MUST NOT 在來源主頁套用 preset、覆寫 current workspace、切換自選清單或變更選取商品。

直接開啟合法盤中選股 URL MUST 顯示相同完整 workspace。popup 被阻擋或本機監控服務不可用時 MUST 提供可操作提示，且不得把失敗誤報為已啟動監控或自行啟停服務。

#### Scenario: 從版面選單開啟盤中選股

- **WHEN** 使用者在「版面」選單啟用「盤中選股」
- **THEN** 系統 MUST 同步開啟或聚焦專用新分頁，並保留來源主頁的 workspace、自選清單與選取商品
- **AND** 新分頁 MUST 取得自己的 selection generation 與 page lease identity

#### Scenario: 直接開啟盤中選股網址

- **WHEN** 使用者從書籤或貼上合法盤中選股 URL
- **THEN** 系統 MUST 顯示完整交易終端、盤中監控、達標結果與 K 線，不得退回只有設定表單的獨立根頁面

#### Scenario: popup 或服務不可用

- **WHEN** 新分頁被瀏覽器阻擋，或盤中監控本機服務無法回應
- **THEN** 來源頁或新頁 MUST 顯示精確可操作原因，且 MUST NOT 修改來源 workspace 或自動啟動／重啟任何 runtime

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
