## MODIFIED Requirements

### Requirement: 法人買賣超副圖

系統 MUST 提供選單顯示名稱為「外資」、「投信」、「自營商」及「合計」的四個可獨立選取法人 pane；pane header MUST 分別使用「外資」、「投信」、「自營商」與「三大法人」短標題，且 checkbox value、資料語意與既有保存狀態 MUST 維持相容。「外資」MUST 同時顯示外資淨買賣超柱與外資及陸資持股比折線，並以獨立尺度呈現張數及百分比；其餘買賣超 pane MUST 依交易日顯示相應淨買賣超、可辨識的零軸與正負方向。自營商讀值 MUST 分辨自行買賣與避險，三大法人讀值 MUST 分列三個組成項。法人 pane header MUST NOT 顯示資料來源文字。

#### Scenario: 顯示合併外資 pane
- **WHEN** 方式 B 選取「外資」，且同一日期具有外資買賣超及外資持股資料
- **THEN** 系統 MUST 在標題為「外資」的同一 pane 以正負柱顯示外資買賣超，並以折線顯示外資持股比
- **AND** 兩種數值 MUST 使用獨立 Y 軸尺度且共用同一時間軸
- **AND** header 讀值 MUST 顯示同一日期、外資買賣超、持股比及持股股數，不得顯示資料來源文字

#### Scenario: 合併 pane 只有一種資料
- **WHEN** 某交易日只有外資買賣超或外資持股其中一種資料
- **THEN** 系統 MUST 繪製可用 series，缺少的欄位顯示「無資料」
- **AND** MUST NOT 以 0 或前一日資料填補缺值

#### Scenario: 同日三大法人有正負買賣超
- **WHEN** 方式 B 同時顯示外資、投信與自營商 pane，且某交易日外資買超、投信賣超、自營商資料完整
- **THEN** 各 pane MUST 依自己的正負值畫在零軸兩側
- **AND** header 讀值 MUST 顯示同一日期、對應法人張數與自營商細項，不得顯示資料來源文字

#### Scenario: 某法人資料缺漏
- **WHEN** 某交易日只有外資與投信資料，自營商欄位為 `null`
- **THEN** 系統只畫可用 series
- **AND** 讀值將自營商標示為「無資料」，不得顯示 0 張

#### Scenario: 顯示三大法人合計
- **WHEN** 某交易日的外資、投信與自營商合計資料完整且已通過來源總計交叉驗證
- **THEN** 使用者 MUST 可建立選單名稱為「合計」、pane header 為「三大法人」的 pane
- **AND** header 讀值 MUST 同時顯示合計張數與三個組成分項

#### Scenario: 三大法人合計不完整
- **WHEN** 任一組成分項缺漏或與來源總計驗證不一致
- **THEN** 三大法人 series MUST 在該日保留 gap 或標示部分資料
- **AND** MUST NOT 顯示以零補足的錯誤合計

### Requirement: 台股籌碼副圖選單

系統 MUST 在每個圖表面板的單一「副圖」選單中，以可辨識的「技術指標」群組提供既有 RSI、KD、MACD、ATR；只有 eligible 台股普通股與 ETF 的 `1d` 週期 MUST 另外顯示「籌碼資料」群組。籌碼資料群組 MUST NOT 顯示適用範圍或投資人身分說明文字，並 MUST 以「法人買賣超」、「融資券」、「持股比」作為群組主項；法人次項 MUST 顯示「外資」、「投信」、「自營商」、「合計」，融資券次項 MUST 顯示「融資」、「融券」、「借券」、「券資比」，持股比次項 MUST 顯示「大戶」、「散戶」。一般桌面選單寬度 MUST 不超過 188 CSS px，6／8 圖窄面板 MUST 不超過 180 CSS px；選單 MUST 向左展開並讓右緣保持在所屬面板內，窄螢幕 MUST 不超出可用 viewport。技術指標與籌碼主項字級 MUST 縮小，籌碼次項 MUST 至少比主項小 1 CSS px，文字 MUST 可完整閱讀且不得產生水平捲動。選單 MUST NOT 同時保留分離的「外資買賣超」與「外資持股」選項，工具列 MUST NOT 再提供獨立「籌碼」按鈕。所有 checkbox value、群組 ID、pane ID、保存偏好與資料請求 MUST 維持既有相容行為。系統 MUST 在 eligible 台股普通股與 ETF 的 `1d` 週期依 dataset 載入籌碼資料；技術指標的計算與同圖複選行為 MUST 保持不變。

技術指標群組的 RSI、KD、MACD、ATR 選項 MUST 固定使用兩欄，並依 DOM 順序形成兩列；此布局 MUST NOT 改變 checkbox value、預設勾選、鍵盤順序或指標計算。

#### Scenario: 桌面展開緊湊副圖選單
- **WHEN** 使用者在桌面寬度展開「副圖」選單
- **THEN** 選單 MUST 不超過 188 CSS px，主項與技術指標 MUST 使用較現況縮小的字級
- **AND** 籌碼次項 MUST 比主項更小，完整標籤不得造成水平捲動

#### Scenario: 技術指標以兩欄降低選單高度
- **WHEN** 使用者展開含 RSI、KD、MACD、ATR 的「副圖」選單
- **THEN** 技術指標 MUST 依序以 `RSI／KD` 第一列、`MACD／ATR` 第二列顯示
- **AND** 最下方「持股比」、「大戶」與「散戶」MUST 完整可見，不得因技術指標單欄高度而被相鄰圖表遮住

#### Scenario: 籌碼群組不顯示水平分隔線
- **WHEN** 使用者展開包含「法人買賣超」、「融資券」與「持股比」的副圖選單
- **THEN** 三個籌碼群組上方 MUST NOT 顯示水平分隔線
- **AND** 群組間及群組內垂直留白 MUST 維持緊湊，並保留完整 checkbox label 點擊區與兩欄子項

#### Scenario: 6／8 圖窄面板展開完整選單
- **WHEN** 使用者在 6 圖或 8 圖配置的窄面板展開「副圖」選單
- **THEN** 選單 MUST 不超過 180 CSS px，並以按鈕右側為基準向左展開
- **AND** 選單左右邊界 MUST 完整位於所屬面板內，所有主項與次項文字 MUST 完整可讀且不得產生水平捲動
- **AND** 選單 MUST NOT 被所屬面板的 overflow 裁切，必要時可在展開期間覆蓋相鄰圖表

#### Scenario: 窄螢幕展開副圖選單
- **WHEN** 可用 viewport 寬度小於桌面選單寬度加安全邊距
- **THEN** 選單 MUST 限制在 viewport 內並允許次項改為單欄
- **AND** 文字 MUST 保持完整可讀且 checkbox label 仍可點擊與聚焦

#### Scenario: 顯示指定籌碼選單名稱
- **WHEN** 使用者展開 eligible 台股普通股或 ETF 日 K 面板的「副圖」選單
- **THEN** 三個主項 MUST 顯示「法人買賣超」、「融資券」、「持股比」
- **AND** 次項 MUST 顯示「外資」、「投信」、「自營商」、「合計」、「融資」、「融券」、「借券」、「券資比」、「大戶」、「散戶」
- **AND** 「籌碼資料」標題下方 MUST NOT 顯示適用範圍或投資人身分說明文字

#### Scenario: 從單一副圖選單選擇外資合併 pane
- **WHEN** 使用者在 eligible 普通股或 ETF 日 K 面板展開「副圖」並選擇「外資」
- **THEN** 面板 MUST 依目前 A／B 模式顯示單一合併 pane
- **AND** MUST 各自請求目前 K 線範圍所需的 `institutional-flow` 與 `foreign-holding` 資料
- **AND** 同一 dataset 不得因其他作用 pane 重複請求

#### Scenario: 遷移舊外資選取狀態
- **WHEN** 已保存選取狀態包含 `foreign-flow`、`foreign-holding` 或兩者
- **THEN** 系統 MUST 將其遷移成一個 `foreign-flow-holding`
- **AND** MUST 去除重複並保留其在既有 pane 順序中的第一個位置

#### Scenario: 以鍵盤操作合併選單
- **WHEN** 使用者以鍵盤展開「副圖」選單並巡覽選項
- **THEN** 技術指標與籌碼資料群組及每個選項 MUST 具有可聚焦 label 與可辨識狀態
- **AND** 焦點順序 MUST NOT 經過已移除的獨立籌碼按鈕或舊外資分離選項

#### Scenario: 切換到非日 K
- **WHEN** 籌碼副圖已選取且使用者把週期切換為 `1h`、`1wk` 或其他非 `1d` 週期
- **THEN** 系統 MUST 隱藏整個籌碼選項群組並清除畫面上的籌碼 pane
- **AND** MUST NOT 顯示先前日 K 的籌碼資料或發出籌碼資料請求
- **AND** 切回 `1d` 時 MUST 還原該商品既有的籌碼選取狀態

#### Scenario: 切換到 ETF
- **WHEN** 籌碼副圖已選取且使用者切換到商品目錄確認的 TWSE／TPEx ETF 日 K
- **THEN** 系統 MUST 請求並顯示各 dataset 的獨立 availability
- **AND** 一個 pane 無資料時其他可用 pane MUST 繼續顯示

#### Scenario: 切換到真正不支援商品
- **WHEN** 籌碼副圖已選取且使用者切換到海外商品、權證、未知或停用商品
- **THEN** 系統 MUST 隱藏整個籌碼選項群組並清除畫面上的籌碼 pane
- **AND** MUST NOT 顯示中性不適用 pane 或發出籌碼上游請求

#### Scenario: 分別選擇大戶與散戶
- **WHEN** 使用者在 eligible 台股普通股或 ETF 日 K 面板選擇「大戶」及「散戶」
- **THEN** 面板 MUST 依目前模式替換單一共用槽位或建立兩個獨立週頻 pane
- **AND** 兩個顯示項目 MUST 共用 D1 中相同日期範圍的 TDCC 股權分散資料
