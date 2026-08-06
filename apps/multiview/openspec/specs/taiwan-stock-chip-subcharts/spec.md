# taiwan-stock-chip-subcharts Specification

## Purpose
TBD - created by archiving change add-taiwan-stock-chip-subcharts. Update Purpose after archive.
## Requirements
### Requirement: 籌碼副圖 A／B 顯示模式

系統 MUST 在「主副圖」全域控制中提供使用者可見的「單一副圖」與「多層副圖」子模式，控制項文案 MUST NOT 顯示 A／B 前綴；實作 MUST 僅在相容邊界沿用方式 A／B 作為內部識別。方式 A MUST 讓每個 panel 只有一個共用副圖槽位；技術副圖與單一籌碼 pane MUST 互相替換，不得在技術副圖下方新增籌碼列。方式 B MUST 保留有實際選取項目的技術副圖，並以複選語意讓每個已勾選籌碼項目建立一個具獨立 Y 軸的 pane，依該頁籤與商品保存的自訂順序上下排列；尚未有自訂順序時 MUST 使用 registry 預設順序。主圖模式 MUST 暫停 A／B 可見 lifecycle，但不得清除兩者偏好。

#### Scenario: 方式 A 由技術副圖替換為籌碼 pane
- **WHEN** 方式 A 正顯示 KD／RSI／MACD／ATR 技術副圖，使用者從「副圖」選單選擇「三大法人合計」
- **THEN** 三大法人 pane MUST 顯示在原技術副圖的同一槽位
- **AND** 技術副圖 MUST 隱藏且主圖下方不得新增另一列
- **AND** 主 K 線與 candles MUST NOT 重新建立或重新請求

#### Scenario: 方式 A 由籌碼 pane 替換回技術副圖
- **WHEN** 方式 A 正顯示籌碼 pane，使用者操作任一技術指標選項
- **THEN** 系統 MUST 銷毀或停用目前籌碼 pane，並在相同槽位恢復技術副圖
- **AND** MUST 恢復保存的技術指標複選組合及最後籌碼作用項目

#### Scenario: 方式 A 替換籌碼作用 pane
- **WHEN** 使用者在方式 A 的同一 panel 從「三大法人合計」選擇「外資買賣超＋持股」
- **THEN** 系統移除三大法人 pane 並在同一共用槽位建立外資 pane
- **AND** 主圖不需重新載入，技術副圖選項也不得被清除

#### Scenario: 方式 B 增加多個 pane
- **WHEN** 使用者在方式 B 依序勾選三大法人合計、融資、融券、大戶持股與散戶持股
- **THEN** 系統 MUST 在有作用時的技術副圖下建立五個獨立 pane，並依目前保存順序排列
- **AND** 相同 dataset 的 pane MUST 共用已取得的 response 與 request，不得重複抓取相同 `symbol + dataset + range`

#### Scenario: 方式 B 取消單一項目
- **WHEN** 使用者在方式 B 取消勾選「融券」
- **THEN** 系統 MUST 只銷毀融券 pane 的 chart、series、讀值、listener 與 observer
- **AND** 其他籌碼 pane、主圖與有作用的技術副圖 MUST 保持作用且依保存順序補位

#### Scenario: A 與 B 保留各自選擇
- **WHEN** 使用者在方式 B 已選取多個 pane 並調整順序，切到方式 A 改用技術副圖或另一個籌碼 pane，再切回方式 B
- **THEN** 系統 MUST 恢復原本 B 的技術副圖狀態、完整籌碼勾選組合與自訂順序
- **AND** MUST NOT 以 A 的作用種類或單一籌碼項目覆寫 B 的保存清單

#### Scenario: 模式控制顯示語意名稱
- **WHEN** 使用者查看全域主副圖模式下拉選單
- **THEN** 選項 MUST 顯示「主圖」、「單一副圖」與「多層副圖」
- **AND** MUST NOT 顯示「A 單一副圖」或「B 多層副圖」

### Requirement: 圖表數量與副圖模式政策

系統 MUST 支援 1、2、3、4、6、8 圖。主圖與方式 A 必須適用所有市場；目前頁籤具有一個以上商品，且所有商品皆為台股 `.TW`／`.TWO` 或明確 allowlist 內的台灣市場基準指數時，1／2／3／4 圖 MUST 開放方式 B；6／8 圖 MUST 固定方式 A。台股單一商品頁只依目標商品判斷方式 B 資格。裝置沒有任何新舊模式偏好時 MUST 首次預設方式 A。方式控制 MUST 是全域設定，但每個 panel MUST 依自身 symbol 採符合資格的 effective mode；台灣市場基準指數 MAY 讓同頁台股商品使用方式 B，但其自身 panel MUST 採方式 A 且不得建立籌碼資料生命週期。方式 A 的任何圖數都 MUST 套用同一個共用副圖槽位規則；方式 B 的支援圖數都 MUST 讓 panel 依作用中的 pane 自然增高並由 document 捲動。工具列 MUST NOT 以常駐說明列顯示圖數或市場限制文案。

#### Scenario: 首次使用任一頁籤
- **WHEN** 裝置尚未保存新呈現模式或既有 A／B 偏好，且使用者選擇 1、2、3、4、6 或 8 圖
- **THEN** 系統 MUST 啟用方式 A 的單一副圖
- **AND** 主副圖下拉選單 MUST 可操作
- **AND** eligible 台股 MUST NOT 自動建立方式 B 的十二個籌碼 pane

#### Scenario: 台股 1／2／3／4 圖可切換 A 或 B
- **WHEN** 使用者在相容台股頁籤選擇 1、2、3 或 4 圖
- **THEN** 主圖、單一副圖與多層副圖選項 MUST 全部可用
- **AND** 使用者選擇 A 時每個 panel MUST 只保留一個共用副圖槽位
- **AND** 使用者選擇 B 時 eligible 台股 panel MUST 依已選 pane 自然增高，並使用瀏覽器 document 的垂直捲軸
- **AND** 圖數切換 MUST NOT 覆寫使用者保存的呈現模式偏好

#### Scenario: 台灣市場指數不封鎖同頁台股多層副圖
- **WHEN** 「台股」頁籤同時包含 allowlist 內的 `^TWII` 與至少一支 `.TW`／`.TWO` 商品，且圖表數量為 1、2、3 或 4
- **THEN** 主圖、單一副圖與多層副圖選項 MUST 全部可用
- **AND** 使用者選擇多層副圖時，`^TWII` panel MUST 採單一技術副圖且不得建立或請求籌碼 pane
- **AND** `.TW`／`.TWO` panel MUST 依保存狀態採多層副圖

#### Scenario: 6／8 圖固定單一副圖
- **WHEN** 使用者選擇 6 或 8 圖
- **THEN** 系統 MUST 使用方式 A 的單一副圖
- **AND** 主圖與多層副圖選項 MUST disabled
- **AND** 切回 1、2、3 或 4 圖後 MUST 恢復切換前保存且符合市場資格的主副圖偏好

#### Scenario: 從多圖開啟台股單一商品頁
- **WHEN** 使用者從多圖雙擊台股 `.TW`／`.TWO` 商品並以有效 `view=single` URL 開啟單一商品頁
- **THEN** 多層副圖資格 MUST 只依該目標商品判斷，不得因來源頁籤另含非台股商品而停用
- **AND** 主圖、單一副圖與多層副圖選項 MUST 可操作並可保存偏好
- **AND** 單一商品頁 MUST 只建立目標商品的一個 panel lifecycle

#### Scenario: 從多圖開啟非台股單一商品頁
- **WHEN** 使用者以有效 `view=single` URL 開啟非台股商品
- **THEN** 主副圖下拉選單 MUST 保持可操作，主圖與單一副圖 MUST 可選，多層副圖 MUST disabled
- **AND** 保存偏好為主圖時 MUST 只呈現主圖，其他不適用偏好 MUST 暫時採方式 A
- **AND** MUST NOT 因來源頁籤另含台股商品而短暫建立多層籌碼 pane

#### Scenario: 非台股頁籤限制多層副圖
- **WHEN** 目前頁籤是美股、匯率債券、期貨期指、加密資產或其他只含非台股商品的頁籤
- **THEN** 主副圖下拉選單 MUST 保持可操作，主圖與單一副圖 MUST 可選
- **AND** 多層副圖 option MUST disabled 並以可存取狀態說明只有台股商品可使用
- **AND** 偏好為 multi 時 effective mode MUST 暫時採方式 A，但不得覆寫保存偏好

#### Scenario: 真正跨市場的混合頁籤限制多層副圖
- **WHEN** 自訂頁籤同時包含台股相容商品與至少一個非台股且不在台灣市場基準指數 allowlist 的商品
- **THEN** 主圖與單一副圖 MUST 可選，多層副圖 option MUST disabled
- **AND** 每個 panel MUST 採相同的主圖或方式 A effective mode
- **AND** 非台股 panel 不得在切換或載入期間短暫建立多層籌碼 pane

#### Scenario: 從台股 B 切到受限頁籤後返回
- **WHEN** 使用者從 1／2／3／4 圖的相容台股方式 B 切換至非台股或真正跨市場的混合頁籤，再返回原本符合條件的台股頁籤與圖數
- **THEN** 受限期間 MUST 只顯示方式 A 最後作用的技術副圖或單一籌碼 pane
- **AND** 系統 MUST NOT 覆寫裝置端保存的 multi 偏好或台股 pane 選擇
- **AND** 返回後 MUST 恢復原本方式 B、技術副圖狀態與完整籌碼勾選組合，多層副圖 option MUST 恢復可操作

#### Scenario: 顯示台股 3 圖方式 B 版面
- **WHEN** 使用者在寬螢幕的相容台股頁籤選擇 3 圖方式 B
- **THEN** 系統 MUST 以三欄一列呈現三個等寬 panel
- **AND** 低於多圖可讀性 breakpoint 時 MUST 改為單欄，不得使用不對稱的二加一版面

#### Scenario: 顯示 4 圖方式 A 版面
- **WHEN** 使用者在寬螢幕選擇 4 圖方式 A
- **THEN** 系統 MUST 維持既有 2×2 panel 版面與固定視窗配置
- **AND** 每個 panel MUST 只顯示至多一個共用副圖槽位

#### Scenario: 顯示台股 4 圖方式 B 版面
- **WHEN** 使用者在寬螢幕的相容台股頁籤選擇 4 圖方式 B
- **THEN** 系統 MUST 以一列四欄呈現四個等寬 panel，不得改為 2×2
- **AND** 每個 eligible 台股 panel MUST 依可見副圖內容自然增高，由整個瀏覽器 document 垂直捲動
- **AND** 低於多圖可讀性 breakpoint 時 MUST 改為單欄

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

### Requirement: 融資融券副圖

系統 MUST 將融資、融券與估算融資維持率提供為三個可獨立選取的 pane。融資與融券分別顯示餘額，並在標題列逐日讀值提供對應的當日變化、買進／賣出／償還及資券互抵；估算融資維持率以折線顯示百分比，標題列逐日顯示維持率及融資增減張。三個 pane MUST 共用相同相容的 `margin-short` response，不同來源單位 MUST 在進入圖表前正規化。當日變化 MUST 以明確 `+` 或 `-` 顯示，正值為紅色、負值為綠色、零值為中性色，MUST NOT 同時顯示含混的「增減」文字。

#### Scenario: 顯示融資融券餘額
- **WHEN** 方式 B 同時勾選融資與融券，且某交易日有完整餘額
- **THEN** 系統 MUST 建立兩個具獨立 Y 軸的 pane
- **AND** 各 pane 標題列 MUST 顯示今日餘額與相對前日的明確正負變化
- **AND** `+` 變化 MUST 為紅色，`-` 變化 MUST 為綠色

#### Scenario: 顯示估算融資維持率
- **WHEN** 方式 B 勾選估算融資維持率且某交易日有合法估算結果
- **THEN** 系統 MUST 建立百分比折線 pane
- **AND** 標題列 MUST 顯示同日估算維持率及融資增減張，並保留「估算」名稱

#### Scenario: 商品當日不可融券或沒有融券資料
- **WHEN** 融資資料有效但融券欄位為 `null`
- **THEN** 系統仍顯示融資 series
- **AND** 融券讀值顯示「無資料」，不得畫零線誤導

### Requirement: 借券副圖

借券副圖 MUST 只呈現來源實際提供的借券成交、借券餘額或借券賣出餘額，並 MUST 在 label 與讀值中使用正確名稱，不得與融券互換。

#### Scenario: 只有借券成交量
- **WHEN** 某來源只提供單一個股每日借券成交量
- **THEN** 副圖只顯示「借券成交」series
- **AND** 不顯示不存在的借券賣出餘額

#### Scenario: 同時有借券及借券賣出餘額
- **WHEN** 來源提供兩種餘額
- **THEN** 系統以不同 label／線型呈現
- **AND** 標題列逐日讀值清楚區分兩者

### Requirement: 大戶與散戶獨立副圖

系統 MUST 將大戶持股與散戶持股提供為兩個可獨立選取的週頻複合 pane；每個 pane MUST 預設以比例線顯示持股比例、以正負柱顯示相較前一筆實際發布週資料的百分點變化，股東人數線則 MUST 預設關閉並可由右鍵「線圖項目」獨立開啟。持股比例線與股東人數線 MUST 使用和主圖一致的線寬與資料點半徑。pane 的預設標題列 MUST 顯示精簡名稱、實際資料日期、持股比例、週變化、持股增減張數、股東人數、人數變化與級距選單，且級距選單 MUST 靠可用列最右側；級距精確範圍、持股總張數、來源、資料頻率與投資人身分提醒 MUST 由右鍵「詳細資料」以表格提供。方式 B 同時勾選時 MUST 上下排列且共用相同 TDCC response；方式 A MUST 只顯示目前選取的一個 pane。TDCC 值 MUST 只屬於其實際 `dataDate`，其他交易日不得 forward-fill、插值或視為 0。

#### Scenario: 顯示預設大戶持股
- **WHEN** 大戶持股 pane 建立且有至少一筆 TDCC 分級 15 資料
- **THEN** pane MUST 以百分比線圖顯示分級 15 的持股比例與週變化柱，且預設不顯示股東人數線
- **AND** 預設標題列 MUST 依序顯示「大戶持股」、實際資料日期、持股比例「持股」、週變化、張數變化「持股」、股東人數與人數變化，並將「1,000 張以上」級距選單靠最右側
- **AND** 預設標題列 MUST NOT 顯示官方精確級距、持股總張數、來源、資料頻率或投資人身分提醒

#### Scenario: 顯示預設散戶持股
- **WHEN** 散戶持股 pane 建立且具有 TDCC 分級 1 至 3 資料
- **THEN** pane MUST 以百分比線圖顯示三個分級加總比例與週變化柱，且預設不顯示股東人數線
- **AND** 預設標題列 MUST 依序顯示「散戶持股」、實際資料日期、持股比例「持股」、週變化、張數變化「持股」、股東人數與人數變化，並將「10 張以下」級距選單靠最右側
- **AND** 精簡方式與可查看的詳細欄位 MUST 與大戶持股一致

#### Scenario: 顯示週變化柱
- **WHEN** 某週加總持股比例高於、低於或等於前一筆實際發布週資料
- **THEN** pane MUST 以本週比例減前週比例的百分點顯示柱值
- **AND** 增加柱使用台股紅色、減少柱使用綠色、零值使用中性色，標題列逐日讀值 MUST 同時顯示正負方向

#### Scenario: 顯示持股增減張數
- **WHEN** 某週具有前一筆實際發布週資料
- **THEN** 標題列 MUST 以本週聚合持股張數減前週聚合持股張數顯示「持股」與帶正負號的張數，不另寫「增減」文字
- **AND** 增加 MUST 顯示正號與台股紅色，減少 MUST 顯示負號與綠色，零值 MUST 使用中性色
- **AND** 右鍵詳細資料表 MUST 顯示相同的持股增減張數

#### Scenario: 顯示股東人數與變化
- **WHEN** 使用者由右鍵「線圖項目」開啟股東人數，且某週與前一筆實際發布週資料具有完整級距人數
- **THEN** pane MUST 以獨立尺度的人數線顯示當週股東人數
- **AND** 該人數線 MUST 使用和主圖一致的線寬與資料點半徑
- **AND** 標題列與詳細資料 MUST 顯示當週人數及「當週人數減前週人數」的帶正負號變化

#### Scenario: 舊預設與客製偏好升級
- **WHEN** 既有偏好的大戶或散戶 series 組合仍完整等於上一版預設值
- **THEN** 系統 MUST 升級為不含股東人數線的新預設組合
- **AND** 非上一版完整預設組合的客製選擇 MUST 保留

#### Scenario: 只有一筆 TDCC 快照
- **WHEN** 查詢範圍只有一筆合法股權分散資料
- **THEN** pane MUST 顯示該筆比例資料點；若使用者已開啟股東人數線，也 MUST 顯示該筆人數資料點，且該 `dataDate` 的標題列週變化、持股增減及人數變化 MUST 顯示「首筆／無前週比較」
- **AND** MUST NOT 畫出週變化柱、假的水平趨勢或每日補值

#### Scenario: 同一週某個分級缺漏
- **WHEN** 大戶或散戶計算所需的任一持股分級為缺漏或驗證失敗
- **THEN** 該 pane MUST 將該週標示為部分或無資料
- **AND** MUST NOT 將缺少分級視為零後繼續加總

#### Scenario: 游標停在 TDCC 未發布日
- **WHEN** 游標 `sessionDate` 不是任何一筆 TDCC 的實際 `dataDate`
- **THEN** 大戶／散戶標題列逐日讀值 MUST 明示「當日無資料」
- **AND** MUST NOT 把前一週比例、週增減、股東人數或人數變化顯示成游標當日資料
- **AND** 詳細資料表若另列最近一筆資料作為參考，MUST 明確標示其實際 `dataDate` 並與當日缺值狀態區分

### Requirement: 大戶散戶級距控制

系統 MUST 讓使用者從 TDCC 官方持股級距可精確組成的選項調整大戶下界與散戶上界；大戶選單 MUST 包含以分級 12 至 15 組成的「400 張以上」選項。級距選單 MUST 使用精簡市場慣稱並在 holder 標題列靠右，實際股數範圍 MUST 由右鍵「詳細資料」表格清楚說明。

#### Scenario: 調整為支援的官方級距
- **WHEN** 使用者從選單選擇另一個支援的持股級距門檻
- **THEN** 前端 MUST 使用已載入的 levels 重新加總比例、股數及人數
- **AND** 精簡標題與已開啟的詳細資料表 MUST 同步更新，且 MUST NOT 因門檻切換再次呼叫 TDCC 上游

#### Scenario: 選擇 400 張以上
- **WHEN** 使用者在大戶 pane 選擇「400 張以上」
- **THEN** 前端 MUST 加總分級 13、14、15 的比例、股數及人數，並同步重算週變化、張數變化及人數變化
- **AND** 右鍵詳細資料 MUST 顯示實際範圍為 `400,001 股以上`

#### Scenario: 門檻包含無法切開的邊界
- **WHEN** 市場慣稱門檻與 TDCC 級距的精確下界不同，例如「1,000 張以上」對應 `1,000,001 股以上`
- **THEN** 級距選單 MUST 顯示精簡市場慣稱，詳細資料表 MUST 顯示實際官方範圍
- **AND** MUST NOT 隱藏、四捨五入或推估該邊界差異

### Requirement: 籌碼副圖時間軸與十字線同步

所有實際顯示的籌碼 pane MUST 以 `sessionDate`／`dataDate` 與主 K 線及目前可見的技術副圖同步 visible range、crosshair、resize 及向左載入；沒有資料的交易日 MUST 保留 gap。每個 pane MUST 使用完整 candle 日期的 time anchor，使日頻與週頻資料共用相同 X 座標。方式 A 被替換而隱藏的副圖 MUST NOT 參與同步或以零尺寸更新。同一 panel MUST 只顯示一條由主圖 plot 頂端連續延伸至最後一個可見副圖底端的共用垂直線，各 chart 原生垂直 crosshair MUST NOT 形成重複或錯位線段；在 layout 穩定後，相同日期於主圖、技術副圖及每個可見籌碼 pane 的絕對螢幕 X 座標差 MUST 小於或等於 1 CSS px。

#### Scenario: 主圖平移與縮放
- **WHEN** 使用者平移或縮放主 K 線
- **THEN** 所有實際顯示的副圖 MUST 顯示相同交易日期範圍
- **AND** 同步過程不得形成循環更新或跳動
- **AND** 共用垂直線與各 pane 同日期資料點 MUST 維持對齊

#### Scenario: 籌碼副圖移動十字線
- **WHEN** 使用者在任一籌碼 pane 移動十字線
- **THEN** 主圖、目前可見的技術副圖及其他作用中的籌碼 pane MUST 同步到相同或最近的交易日
- **AND** 所有籌碼 pane 的標題列逐日讀值 MUST 使用同一個 `sessionDate`，TDCC 值則只在相符的實際 `dataDate` 顯示
- **AND** panel MUST 呈現一條連續且不左右錯位的共用垂直線

#### Scenario: 方式 A 切換共用槽位內容
- **WHEN** 使用者在技術副圖與籌碼 pane 間替換作用內容
- **THEN** 新顯示的 chart MUST 立即套用主圖目前 visible range、共用 plot geometry、cursor state 與可用尺寸
- **AND** 已隱藏 chart MUST NOT 接收 crosshair、逐日讀值或 resize 更新

#### Scenario: 向左載入更早歷史
- **WHEN** 主 K 線載入更早 candles 且籌碼副圖已啟用
- **THEN** 前端只查詢新增的日期缺口
- **AND** 合併後的籌碼 rows 不重複、不改變既有日期值的順序
- **AND** 共用垂直線及標題列逐日讀值 MUST 在合併後仍對應同一日期

#### Scenario: 對齊每週股權分散資料
- **WHEN** 大戶／散戶副圖顯示於日 K 面板
- **THEN** 每個比例線資料點與週變化柱 MUST 只對齊 TDCC 回傳的實際 `dataDate`
- **AND** 其他交易日 MUST 保留 gap，不得 forward-fill、插值或複製前一週比例
- **AND** 游標位於其他交易日時標題列逐日讀值 MUST 顯示當日無發布資料，而不是把最近一筆 `dataDate` 移到共用垂直線位置

#### Scenario: 驗收 1px 日期對齊
- **WHEN** 在桌面寬度的 1／2／3／4 圖方式 B，分別對 visible range 左側、中央及右側交易日量測主圖、技術副圖與至少五個籌碼 pane 的 `element left + timeToCoordinate(date)`
- **THEN** 每個測試日期的最大與最小絕對螢幕 X 座標差 MUST 小於或等於 1 CSS px
- **AND** 在平移、縮放、panel resize、增減 pane 及 TDCC 級距切換後的穩定畫面仍 MUST 通過相同門檻

#### Scenario: document 捲動時共用垂直線保持連續
- **WHEN** 方式 B 有多個 pane 且使用者捲動瀏覽器 document，使部分主圖或副圖進出 viewport
- **THEN** 共用垂直線 MUST 依 panel 實際位置更新且在可見區段維持同一螢幕 X 座標
- **AND** overlay MUST NOT 攔截垂直捲動、水平拖曳、縮放或 pane 控制操作

### Requirement: Panel lifecycle 與舊請求隔離

籌碼 pane manager MUST 跟隨 panel 的 symbol、interval、頁籤、排序、建立與銷毀 lifecycle；切換後的舊 request MUST 被取消或忽略，不能覆蓋目前 panel。A 的作用種類與最後籌碼項目、B 的技術指標與籌碼選擇 MUST 在 panel 重建前以 `tabId + canonical symbol` 保存，不能只依畫面 index；舊版沒有作用種類欄位的偏好 MUST 相容讀取且不得清除 B 清單。以 `view=single` 開啟的新分頁 MUST 只建立目標商品的單一 panel lifecycle，不得修改原分頁或共用圖表數量偏好。

#### Scenario: 快速切換兩個台股個股
- **WHEN** 使用者在第一個籌碼 request 完成前從 `2330.TW` 切換到 `8069.TWO`
- **THEN** 舊 request 的 response MUST NOT 畫到新商品
- **AND** 新 panel 只顯示 `8069.TWO` 的來源與資料

#### Scenario: 方式 A 切到技術副圖時隔離舊請求
- **WHEN** 籌碼 request 尚未完成且使用者把方式 A 共用槽位切為技術副圖
- **THEN** 舊籌碼 request MUST 被取消或其 response 被忽略
- **AND** 技術副圖不得被舊 response 替換或在下方新增籌碼列

#### Scenario: 變更圖表數量
- **WHEN** 使用者在 1／2／3／4／6／8 圖之間切換
- **THEN** 已移除 panel 的籌碼 listener、observer 與 request MUST 被清理
- **AND** 新 panel MUST 依穩定鍵恢復適用的 A／B 偏好、作用種類與 pane 選擇

#### Scenario: 新分頁建立單一商品 lifecycle
- **WHEN** 有效的 `view=single` URL 完成初始化
- **THEN** 系統 MUST 只建立 URL 指定商品的單一 panel、技術副圖及籌碼 pane controllers
- **AND** 關閉或重新載入新分頁 MUST 依既有 lifecycle 清理 listener、observer 與 request
- **AND** MUST NOT 將 page-scoped 的 1 圖狀態保存成其他分頁的全域圖數

### Requirement: 多層副圖高度與捲動

方式 B MUST 為主圖、每個作用中的籌碼 pane，以及至少選取一項指標時的技術副圖保留可讀高度，並讓 panel 與頁面高度依實際可見 pane 數量及目前 layout signature 的穩定 header 保留高度增減；共用游標在同一 layout signature 內更新 readout 時，MUST NOT 改變 header、pane、後續 pane 或 panel 的幾何高度。當內容超過 viewport 時，系統 MUST 以 `html/body` 的瀏覽器頁面作為唯一垂直捲動容器，`.subchart-slot`、`.chip-pane-region`、`.chip-pane-stack` 與 `.chart-panel` MUST NOT 形成可獨立垂直捲動的區域。桌面寬度的方式 B MUST 採緊湊副圖版型：有作用的技術副圖總高 MUST 介於 96–120 CSS px；籌碼 pane 在 header 單列時總高 MUST 介於 88–104 CSS px，需要多列時 MUST 依目前 panel 寬度、series、資料狀態族群、holder 級距及控制項預先保留足以顯示完整 readout 的高度，且 chart 區至少保留 64 CSS px。沒有選取任何技術指標時 MUST 完全移除技術副圖列及其最小高度。籌碼 pane MUST NOT 建立浮動 tooltip，且 inline readout MUST 與標題及控制項共同使用緊湊 header，不得遮住 chart、裁切資訊或造成水平捲動。方式 A MUST 只顯示至多一個作用中的副圖槽位且不得出現多層 stack 或因籌碼 pane 增加額外列；當同一個 1／2／3／4 圖 page-scroll grid 另有方式 B panel，使無籌碼資格 panel 回退至方式 A 技術副圖時，已選取技術指標的方式 A panel MUST 仍保留 96–120 CSS px 的可見技術副圖高度。方式 B MUST 依滑鼠 modifier 分流 wheel：主圖、實際可見的技術副圖與籌碼副圖圖表區的一般垂直 wheel MUST 捲動 document 並保持目前 panel 的時間資料區間；只有 `Option/Alt + wheel` MUST 縮放目前 panel。圖表外區域與瀏覽器原生捲軸 MUST 維持捲動 document；觸控垂直滑動 MUST 捲動 document，水平拖曳與 pinch MUST 操作圖表。

#### Scenario: 方式 A 顯示籌碼 pane
- **WHEN** 使用者在方式 A 選擇任一籌碼項目
- **THEN** 籌碼 pane MUST 使用原技術副圖槽位的高度與位置
- **AND** panel 不得新增副圖列、顯示多層 stack 或啟用方式 B 的長頁面版型
- **AND** 讀值 MUST 在 pane header 內安全換行，不得建立浮動 tooltip 或額外固定詳細列
- **AND** 共用游標在完整、部分或缺值日期間移動時 MUST NOT 改變原副圖槽位高度

#### Scenario: 方式 B 勾選多個籌碼項目
- **WHEN** 使用者在 1／2／3／4 圖的方式 B 勾選五個以上籌碼項目且總高度超過 viewport
- **THEN** 主圖、實際有作用的技術副圖與每個 pane MUST 依緊湊高度、穩定 header 保留高度及目前保存順序全部向下展開
- **AND** document 高度 MUST 隨可見 pane 與合法 layout 變更增加並由瀏覽器頁面捲軸查看所有 pane
- **AND** panel、副圖槽位與籌碼區 MUST NOT 出現獨立垂直捲軸
- **AND** 只移動共用游標 MUST NOT 改變 document 高度

#### Scenario: 4 圖方式 B 使用共同頁面捲軸
- **WHEN** 桌面寬度的 4 圖方式 B 在一列四欄顯示，且任一 panel 的多層副圖超過 viewport
- **THEN** 四個 panel MUST 保持同列等寬，並各自依可見 pane 與穩定 header 保留高度增高
- **AND** 副圖配置、順序前綴與控制狀態相容的 panel，MUST 對相同 pane identity 套用同列 cohort 的最大保留高度，使對應 pane 邊界保持對齊
- **AND** 配置不相容的 panel MUST 各自保持游標期間幾何穩定，不得為強制對齊而插入不存在的 pane 或改變順序
- **AND** 頁面 MUST 只使用瀏覽器 document 的垂直捲軸，不得把較長 panel 壓縮成內層捲動區
- **AND** panel、價格軸、readout、工具列或副圖內容 MUST NOT 產生非預期水平捲軸或裁切必要控制項

#### Scenario: 4 圖混合台灣市場指數與 eligible 台股
- **WHEN** 桌面寬度的 4 圖多層副圖頁面同時包含不建立籌碼 pane 的台灣市場指數與建立方式 B 籌碼 pane 的 eligible 台股商品，且指數已選取至少一項技術指標
- **THEN** 台灣市場指數 panel MUST 以方式 A 顯示 96–120 CSS px 的技術副圖，不得因 grid 的 page-scroll `auto` row 被壓成 0 高
- **AND** 指數技術副圖 MUST 顯示已選取 series，並與主圖維持相同 visible range 及小於或等於 1 CSS px 的 X 座標差
- **AND** 指數沒有選取任何技術指標時 MUST 繼續完全收合副圖列

#### Scenario: 標題列顯示逐日讀值
- **WHEN** 籌碼 pane 已取得資料且游標未作用
- **THEN** header MUST 顯示最新可用日期與完整讀值，空間不足時依原順序換到預先保留的下一列
- **AND** 游標作用時 MUST 原位改為游標日期讀值，離開後恢復最新值
- **AND** 完整資料、部分資料、無資料與最近一筆狀態往返時，header height、pane height、下一個 pane top 與 panel height 的差異 MUST 各小於或等於 1 CSS px
- **AND** 不得以第二個固定明細區、浮動 tooltip 或 chart 右側系列標籤重複顯示

#### Scenario: 圖表區使用一般滑鼠滾輪捲頁
- **WHEN** 方式 B 的滑鼠指標位於主圖、實際可見的技術副圖或任一籌碼 pane 的實際圖表區，且使用者未按住 `Option/Alt`、`Ctrl` 或 `Meta` 而轉動垂直滾輪
- **THEN** 瀏覽器 document MUST 依手勢方向垂直捲動
- **AND** 目前 panel 的 visible logical range、bar spacing、首末 K 棒座標與其他 panel 的時間範圍 MUST NOT 改變
- **AND** 同一 panel 的主圖與所有可見副圖 MUST 維持相同時間範圍與小於或等於 1 CSS px 的 X 座標對齊

#### Scenario: 圖表外使用滑鼠滾輪捲頁
- **WHEN** 方式 B 的滑鼠指標位於圖表標題列、panel 工具列、控制區、頁面空白或瀏覽器原生捲軸並轉動中央滾輪
- **THEN** 瀏覽器 document MUST 依手勢方向垂直捲動
- **AND** 任一 panel 的 visible logical range MUST NOT 因該手勢改變
- **AND** 頁面 MUST NOT 被單一 chart、pane 或內層捲動區困住

#### Scenario: 從圖表區明確縮放圖表
- **WHEN** 方式 B 的滑鼠指標位於任一圖表區並以 `Option/Alt + wheel` 操作
- **THEN** 系統 MUST 縮放目前 panel 的 visible logical range，且 MUST NOT 捲動瀏覽器 document
- **AND** 同一 panel 的主圖與所有可見副圖 MUST 同步到相同時間範圍
- **AND** 系統不得增加永久提示列、工具列按鈕或新的互動模式

#### Scenario: 從任一圖表按住左鍵拖曳
- **WHEN** 使用者在方式 A 或方式 B 的主圖、技術副圖或任一籌碼 pane 圖表區按住滑鼠左鍵水平拖曳
- **THEN** 系統 MUST 平移目前 panel 的時間資料範圍
- **AND** 同一 panel 的所有可見圖表 MUST 同步，其他 panel 與 document 垂直位置 MUST 保持不變
- **AND** 只有群組 header 的允許拖曳區 MAY 啟動群組重排

#### Scenario: 多層副圖使用觸控手勢
- **WHEN** 使用者在方式 B 的圖表區使用單指垂直滑動、水平拖曳或雙指 pinch
- **THEN** 單指垂直滑動 MUST 捲動瀏覽器 document
- **AND** 水平拖曳 MUST 平移目前 panel 的時間範圍
- **AND** pinch MUST 縮放目前 panel 並同步同一 panel 的所有可見圖表

#### Scenario: 多圖與窄螢幕使用共同頁面捲軸
- **WHEN** 方式 B 在寬螢幕以 2／3／4 個 panel 並排，或在既定 breakpoint 以下改為單欄
- **THEN** 所有 panel MUST 使用同一個瀏覽器頁面垂直捲軸
- **AND** 每個 panel MUST 依自己的作用 pane 與穩定 header 保留高度增高，不得建立各自的垂直捲動容器
- **AND** 頁面 MUST NOT 因 panel、價格軸、readout 或副圖內容產生非預期水平捲軸
- **AND** 6／8 圖 MUST 維持固定單一副圖，不得啟用方式 B 高度協調

#### Scenario: 取消中間的 pane
- **WHEN** 使用者從方式 B 多層 stack 取消一個非首尾 pane
- **THEN** 其後 pane MUST 依目前保存順序向上補位，panel 與 document 高度 MUST 依新的可見 pane 組合縮短
- **AND** 不得改變其他 pane 的資料、尺度、勾選狀態、visible range、header 讀值或 crosshair 同步

#### Scenario: layout-affecting 狀態改變
- **WHEN** payload、圖數、panel 寬度、responsive breakpoint、字型尺寸、series 選取、holder 級距或可見 pane 組合改變
- **THEN** 系統 MUST 使舊 layout signature 失效，並在單一排程 layout 階段重新計算本地與相容 cohort 的保留高度
- **AND** 重算完成後的共用游標移動 MUST 再次符合 1 CSS px 幾何穩定門檻
- **AND** 一般 pointer move、crosshair frame 或 readout 內容置換 MUST NOT 執行高度量測、chart resize 或 cohort 重算

#### Scenario: 縮放與捲頁後維持共用十字線對齊
- **WHEN** 使用者在方式 B 以 `Option/Alt + wheel` 縮放圖表或以一般 wheel 捲動 document，且 layout 已穩定
- **THEN** 同一 panel 的主圖與所有可見副圖 MUST 保持相同日期範圍
- **AND** 相同日期於各圖表的絕對螢幕 X 座標差 MUST 小於或等於 1 CSS px
- **AND** 共用垂直線與 header 逐日讀值 MUST 繼續對應相同或最近的交易日

#### Scenario: 離開方式 B
- **WHEN** 使用者從方式 B 切到方式 A、6 圖或 8 圖
- **THEN** 系統 MUST 移除方式 B 的長頁面、緊湊 stack 版型、cohort registration 與保留高度 override，恢復固定視窗與至多一個作用中的副圖槽位
- **AND** MUST 清理已隱藏 pane 的 listener／observer／readout／wheel routing 狀態，並正確 resize 保留的主圖與副圖
- **AND** 返回支援方式 B 的圖數後 MUST 恢復原本技術副圖狀態、完整籌碼勾選組合與自訂順序，並依新 layout signature 重建保留高度

### Requirement: 籌碼資料狀態與可及性

系統 MUST 在籌碼副圖顯示載入中、部分資料、資料過期、尚未發布、等待背景回補、背景回補中、回補未完成、來源阻擋、不適用與來源不可用狀態；普通股與 ETF 的每個 dataset MUST 獨立顯示狀態，大戶／散戶 MUST 使用目前 symbol 的 coverage／queue，而非全域工作狀態。series MUST 有文字 label，讀值與操作 MUST 不只靠顏色辨識。

#### Scenario: 使用過期 D1 資料
- **WHEN** API 回傳 rows 並標示 `stale_cache`
- **THEN** 副圖仍顯示最近成功資料
- **AND** 狀態區顯示資料日期與「資料可能過期」

#### Scenario: ETF 部分資料可用
- **WHEN** ETF 的法人與融資券可用，但借券或外資持股沒有來源紀錄
- **THEN** 可用 pane MUST 正常顯示，缺資料 pane MUST 顯示自己的安全原因
- **AND** MUST NOT 把整個 ETF 或所有籌碼選項標示為不適用

#### Scenario: 新增台股等待背景回補
- **WHEN** 目前 symbol 已建立 continuous-backfill queue 但尚未開始處理
- **THEN** 大戶／散戶 pane MUST 顯示「等待背景回補」與實際可用 coverage
- **AND** MUST NOT 顯示另一個 symbol 或全域 job 的進度

#### Scenario: 目前台股正在背景回補
- **WHEN** API 回傳目前 symbol 的 backfill status 為 running
- **THEN** pane MUST 顯示「背景回補中（x/y 週）」及既有資料
- **AND** 已完成週的比例線與週增減柱 MUST 保持可用

#### Scenario: 股權分散歷史尚未完整
- **WHEN** 大戶／散戶查詢範圍早於 D1 或免費官方來源可用的最早 TDCC 資料日期
- **THEN** 狀態區 MUST 顯示實際可用起日、missing weeks 與目前 symbol 的 partial／blocked 狀態
- **AND** MUST NOT 以空白日資料、外資持股或其他籌碼 series 補足

#### Scenario: 只有最新週快照但已排程
- **WHEN** API 只有一筆合法 `distributionRows` 且目前 symbol 為 queued 或 running
- **THEN** pane MUST 顯示實際排程狀態，不得只顯示「目前僅 1 期」
- **AND** 比例資料點 MUST 可辨識，週變化柱 MUST 保持空白直到有前一筆實際發布週

#### Scenario: 只有最新週快照且沒有工作
- **WHEN** API 只有一筆合法 `distributionRows` 且目前 symbol 沒有 queued／running 工作
- **THEN** pane MUST 顯示「目前僅 1 期／尚無前週比較」
- **AND** MUST NOT 以「累積中」暗示背景工作正在執行

#### Scenario: 歷史來源阻擋
- **WHEN** 目前 symbol 因 CAPTCHA、封鎖、格式漂移或不允許背景操作而設為 blocked
- **THEN** pane MUST 保留並顯示已成功資料及安全原因
- **AND** MUST NOT 顯示「回補中」或清除既有 series

#### Scenario: 完全沒有可用資料
- **WHEN** eligible 商品的指定 dataset 在請求範圍內沒有 D1 或上游資料
- **THEN** 該 pane 顯示安全且可理解的原因
- **AND** 不保留上一個商品的 series 或讀值

#### Scenario: 鍵盤與輔助辨識
- **WHEN** 使用者以鍵盤操作副圖選單或以非彩色方式閱讀圖表
- **THEN** 每個選項具有可聚焦 label 與狀態
- **AND** series 以名稱、線型／標記及文字讀值共同辨識

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

### Requirement: 籌碼副圖標題列逐日讀值

同一 panel 的每個作用中籌碼 pane MUST 依共用游標日期在 pane header 顯示自己的 inline readout。readout MUST 顯示 `sessionDate`、主要 series 值、必要組成欄位與資料狀態，但 MUST NOT 顯示資料來源文字；游標未作用時 MUST 顯示最新可用讀值。系統 MUST 依目前 layout signature，使用完整資料、部分資料、無資料、首筆比較及 TDCC 非發布日／最近一筆等 readout 狀態建立足以完整容納內容的穩定高度保留區。當一列寬度不足時，完整 readout segments MUST 自動換到保留區內的下一列；共用游標更新 MUST 只置換內容與樣式，MUST NOT 改變 header 或 pane 高度。系統 MUST NOT 以裁切、ellipsis、縮短欄位或水平捲動隱藏任何項目。籌碼 pane MUST NOT 建立浮動 tooltip，亦 MUST NOT 在 chart 內容或價格軸顯示 series title／last-value 標籤。

#### Scenario: 游標移到有完整逐日資料的交易日
- **WHEN** 使用者將游標移到具有法人、融資券或 TDCC 資料的日期
- **THEN** 每個作用中籌碼 pane 的 header MUST 顯示同一個游標日期的自身數值
- **AND** MUST NOT 顯示資料來源、資料序列最後一日的值或浮動框
- **AND** readout 更新前後的 header、pane 與後續 pane 垂直幾何差異 MUST 小於或等於 1 CSS px

#### Scenario: 游標離開 pane
- **WHEN** 游標離開 panel 或共用游標被清除
- **THEN** 每個籌碼 pane 的 header MUST 恢復最新可用日期與讀值
- **AND** MUST NOT 保留上一個游標日期或上一個商品的讀值
- **AND** 從游標值恢復最新值 MUST NOT 改變 header、pane、後續 pane 或 panel 高度

#### Scenario: 方向性數值套用正負號與顏色
- **WHEN** 買賣超、相對前日變化或週增減為正值、負值或零
- **THEN** 正值 MUST 顯示 `+` 且為紅色，負值 MUST 顯示 `-` 且為綠色，零值 MUST 使用中性色
- **AND** 融資融券變化 MUST NOT 顯示「增減」兩字取代確定方向

#### Scenario: 欄位名稱固定使用線圖項目色
- **WHEN** header 顯示具有右鍵「線圖項目」對應系列的讀值欄位
- **THEN** 欄位名稱 MUST 使用該線圖項目色票，且不得因數值為正、負或零而改變顏色
- **AND** 只有數值本身與方向箭頭 MUST 依正負方向顯示紅色、綠色或中性色
- **AND** 名稱色票 MUST 與右鍵功能表共用同一份 series 定義，不得維護互相漂移的重複色票

#### Scenario: 游標日期欄位缺漏
- **WHEN** 作用中的籌碼 pane 在游標日期只有部分欄位或指定欄位為 `null`
- **THEN** header MUST 將欄位標示為「部分資料」或「無資料」
- **AND** MUST NOT 將缺值轉成 0 或沿用其他日期數值
- **AND** 完整與缺漏狀態往返 MUST 使用同一 layout signature 的保留高度

#### Scenario: TDCC 游標日期不是發布日
- **WHEN** 游標日期沒有對應 TDCC 實際週資料
- **THEN** header MUST 顯示游標日期與「當日無資料」
- **AND** MAY 顯示最近一筆較早的真實資料日期及比例作為參考，但 MUST 清楚標為最近一筆，且不得將其視為游標當日值
- **AND** 從完整週資料移到非發布日再移回完整週資料時，大戶持股、散戶持股與集保戶數 pane 的 header height、pane height 及後續 pane top 差異 MUST 各小於或等於 1 CSS px

#### Scenario: 標題列寬度不足
- **WHEN** panel 寬度不足以在一列容納標題、完整 readout、狀態與控制項
- **THEN** 系統 MUST 在該寬度成為穩定 layout signature 時，預先建立可容納所有合法 readout 狀態的保留高度
- **AND** readout segment MUST 依原順序完整換到保留區內的下一列，且游標移動期間不得增減列區高度
- **AND** 所有日期、數值、組成欄位與狀態 MUST 仍可見，但資料來源文字 MUST NOT 出現
- **AND** MUST NOT 裁切、顯示 ellipsis、縮短次要文字、重疊控制項、遮住 chart 或造成頁面水平捲動

#### Scenario: pointer 熱路徑不得重新量測版面
- **WHEN** 同一 layout signature 下的 pointer move 或 crosshair requestAnimationFrame 更新任一籌碼 readout
- **THEN** 更新路徑 MUST NOT 讀取 header／pane 幾何以重新決定高度，也 MUST NOT 呼叫 chart resize、panel layout refresh 或跨 panel reservation coordinator
- **AND** 資料 request、stream subscription、pane controller 數量及 chart render generation MUST 保持不變

### Requirement: 主圖與技術副圖逐日讀值呈現

系統 MUST 讓 K 線主圖浮動框顯示目前指向 K 棒的完整日資料日期，並 MUST 讓技術副圖以不遮擋圖形的緊湊標題列顯示日期與已勾選指標數值。日期 MUST 使用 `YYYY-MM-DD`，並取自對應 candle／交易日，不得以瀏覽器目前日期、行情更新時間或 TDCC 資料日期代替。技術副圖標題列 MUST 在游標作用時顯示游標日期讀值，游標離開後恢復最新 candle 日期與最新可用值；方式 A 與方式 B MUST 使用相同規則。

#### Scenario: K 線浮動框顯示日資料日期
- **WHEN** 使用者將共用十字線移到一根有資料的 K 棒
- **THEN** 主圖浮動框 MUST 在 OHLC 與已勾選主圖指標數值前顯示該 K 棒的 `YYYY-MM-DD` 日期
- **AND** 日期 MUST 與共用十字線及所有副圖目前顯示的交易日相同
- **AND** 主圖浮動框 MUST 保留既有左右避讓與不超出繪圖區的行為

#### Scenario: 技術副圖以標題列顯示逐日讀值
- **WHEN** 技術副圖顯示 RSI、KD、MACD 或 ATR，且游標指向一個有 candle 的交易日
- **THEN** 技術副圖 MUST 在圖表上方的單一緊湊標題列先顯示該日 `YYYY-MM-DD`，再顯示目前已勾選指標的該日數值
- **AND** 未勾選的技術指標 MUST NOT 佔用標題列空間
- **AND** 技術副圖 MUST NOT 顯示跟隨游標移動的浮動背景框或遮住圖形

#### Scenario: 游標離開後恢復技術副圖最新值
- **WHEN** 技術副圖已載入資料且使用者未將游標停在主圖、技術副圖或籌碼 pane 的有效交易日
- **THEN** 技術副圖標題列 MUST 顯示最新 candle 的 `YYYY-MM-DD` 日期與目前已勾選指標的最新可用值
- **AND** 不得隱藏整列、顯示上一個游標日期或回復為無日期的數值

#### Scenario: 技術副圖維持緊湊高度
- **WHEN** 方式 A 或方式 B 顯示技術副圖標題列
- **THEN** 標題列與圖表 MUST 共用原技術副圖槽位，不得新增另一個副圖 pane
- **AND** 方式 B 的技術副圖總高 MUST 維持 96–120 CSS px
- **AND** 標題與讀值在窄 panel 可截斷或安全換行，但 MUST NOT 遮住圖表、控制項或造成水平捲軸

### Requirement: 籌碼副圖精簡狀態、移除操作與百分比格式

系統 MUST 在籌碼 pane 正常可顯示資料時省略「可用」狀態文字，但 MUST 保留部分資料、資料過期、歷史不足、背景回補及來源不可用等有判斷價值的狀態。籌碼 pane header MUST NOT 顯示常駐「移除」或排序按鈕；圖表區的右鍵功能表 MUST 提供「移除副圖」，方式 B 另 MUST 提供「上移」與「下移」，並 MUST 在 pane 銷毀時清除功能表與 listener。持股比例、持股變化、週變化與對應座標刻度 MUST 使用 `%`，不得顯示「百分比」、「百分點」或「個百分點」。

#### Scenario: 正常資料不顯示可用狀態
- **WHEN** 籌碼 dataset 狀態為 available 且沒有其他回補或歷史警告
- **THEN** pane header MUST NOT 顯示「可用」或資料來源文字
- **AND** 日期及讀值 MUST 繼續正常顯示

#### Scenario: 以右鍵功能表移除籌碼副圖
- **WHEN** 使用者在籌碼 pane 圖表區按滑鼠右鍵，或以 `ContextMenu` 鍵／`Shift+F10` 開啟功能表後選擇「移除副圖」
- **THEN** 方式 B MUST 只移除該 pane，其他 pane MUST 依目前保存順序補位
- **AND** 方式 A MUST 恢復技術副圖作用種類；若沒有選取技術指標則副圖槽位 MUST 收合
- **AND** header MUST NOT 另行顯示常駐「移除」按鈕

#### Scenario: 顯示持股變化與週變化
- **WHEN** 持股變化或 TDCC 週變化具有可比較的正負數值
- **THEN** 讀值與座標刻度 MUST 以帶正負號的 `%` 顯示
- **AND** 增加值 MUST 維持紅色、減少值 MUST 維持綠色
- **AND** MUST NOT 顯示「百分比」、「百分點」或「個百分點」

#### Scenario: 移除 pane 後清理功能表
- **WHEN** pane 因取消勾選、模式切換、panel 重建或商品切換而銷毀
- **THEN** 系統 MUST 移除該 pane 的 context menu DOM、document listener、window listener 與排序拖曳狀態
- **AND** 後續右鍵或拖曳操作 MUST NOT 出現重複或屬於舊 pane 的功能表及處理器

### Requirement: 法人買賣細項讀值與 series

外資與投信 pane MUST 在逐日讀值中分列買進、賣出及淨買賣超，並 MUST 讓使用者在 pane 內選擇可見 series；淨買賣超、買進與賣出屬於每日流量，MUST 使用柱狀 series，外資持股股數與持股比例屬於存量，MUST 使用折線及各自相容的尺度。

#### Scenario: 顯示外資完整細項
- **WHEN** 某交易日具有外資買進、賣出、淨買賣超、持股股數與持股比例
- **THEN** 外資 pane 讀值 MUST 分列五個欄位及來源
- **AND** 預設 MUST 維持淨買賣超柱與持股比例線，使用者 MUST 可另行啟用買進柱、賣出柱及持股股數線

#### Scenario: 顯示投信完整細項
- **WHEN** 某交易日具有投信買進、賣出與淨買賣超
- **THEN** 投信 pane 讀值 MUST 分列三個欄位及來源
- **AND** 預設 MUST 維持淨買賣超柱，使用者 MUST 可另行啟用買進柱與賣出柱

#### Scenario: 投信沒有持股來源
- **WHEN** 系統沒有可靠來源發布投信持股股數或比例
- **THEN** 投信 pane MUST NOT 建立投信持股折線
- **AND** 若介面列出參考畫面的對應欄位，MUST 顯示「無資料」且不得由買賣超累積推算

#### Scenario: 法人 gross 部分缺漏
- **WHEN** 某交易日只有淨買賣超而買進或賣出為 `null`
- **THEN** pane MUST 繪製可用的淨額並逐項標示缺少的 gross 欄位為「無資料」
- **AND** MUST NOT 以 0 補出買進柱或賣出柱

### Requirement: 融資融券詳細 series 與使用率

融資與融券 pane MUST 分別提供餘額、日變化、買進、賣出、現金／現券償還、使用率與資券互抵逐日讀值；餘額與使用率 MUST 使用折線，日變化、買進、賣出與償還 MUST 使用柱狀 series，張數存量、張數流量與百分比 MUST 使用不互相壓縮的尺度。

#### Scenario: 顯示融資詳細資料
- **WHEN** 某交易日具有完整融資餘額、變化、買進、賣出、現金償還與使用率
- **THEN** 融資 pane 讀值 MUST 分列所有可用欄位及資券互抵
- **AND** 預設 MUST 維持餘額線與日變化柱，使用者 MUST 可啟用買進柱、賣出柱、現金償還柱與使用率線

#### Scenario: 顯示融券詳細資料
- **WHEN** 某交易日具有完整融券餘額、變化、買進、賣出、現券償還與使用率
- **THEN** 融券 pane 讀值 MUST 分列所有可用欄位及資券互抵
- **AND** 預設 MUST 維持餘額線與日變化柱，使用者 MUST 可啟用買進柱、賣出柱、現券償還柱與使用率線

#### Scenario: 使用率缺漏
- **WHEN** 某交易日餘額有效但限額或使用率為 `null`
- **THEN** pane MUST 維持餘額及其他可用 series，並將使用率標示為「無資料」
- **AND** MUST NOT 畫出 0% 折線或沿用前一日使用率

### Requirement: 細項方向、選擇狀態與缺值

系統 MUST 對成交量與籌碼逐日讀值中的各欄位，以該欄位前一筆實際非 `null` 資料判定增加、減少或持平；新增 series 的可見選擇 MUST 以 panel 所屬 tab、symbol 與 pane 區隔保存，格式失效時 MUST 回復精簡預設而不影響既有 pane 選擇。

#### Scenario: 比較前一筆實際資料
- **WHEN** 目前日期某欄位有效，但前一交易日該欄位缺漏且更早日期存在有效值
- **THEN** 方向 MUST 與該欄位更早的前一筆有效值比較
- **AND** MUST NOT 將中間缺漏視為 0 或比較同日其他欄位

#### Scenario: 保存不同商品的 series 選擇
- **WHEN** 使用者為某 tab 內的 `2330.TW` 融資 pane 啟用使用率線，之後切換其他 symbol 再返回
- **THEN** 系統 MUST 恢復該 tab、symbol 與 pane 的 series 選擇
- **AND** MUST NOT 把選擇套用到其他 symbol 或覆寫 A／B 模式的 pane 清單

#### Scenario: 舊偏好沒有 series 設定
- **WHEN** 使用者的本機偏好只含既有 pane 選擇或新版 payload 無法解析
- **THEN** 系統 MUST 使用各 pane 的既有主要 series 預設
- **AND** MUST NOT 因偏好 migration 失敗而隱藏 pane、清除其他選擇或重新請求 candles

### Requirement: 副圖 series 右鍵選單與右側數值軸

系統 MUST 將籌碼副圖的 series 選項整合至該副圖既有的滑鼠右鍵功能表，MUST NOT 在副圖標題列新增「項目」按鈕或其他 series 控制鈕；每個具有可見資料的 pane MUST 顯示對應目前主要可見資料群組的右側數值軸。

#### Scenario: 從滑鼠右鍵功能表切換 series
- **WHEN** 使用者在具有可選 series 的籌碼副圖按滑鼠右鍵
- **THEN** 同一功能表 MUST 顯示具可存取名稱、勾選狀態與色彩提示的線圖項目
- **AND** 功能表 MUST 同時保留既有「移除副圖」，副圖標題列 MUST NOT 顯示「項目」按鈕

#### Scenario: 以鍵盤開啟 series 功能表
- **WHEN** 焦點位於副圖且使用者按 Context Menu 鍵或 `Shift+F10`
- **THEN** 系統 MUST 開啟與滑鼠右鍵相同的功能表並將焦點移入第一個可操作項目
- **AND** Escape MUST 關閉功能表並將焦點還給原副圖

#### Scenario: 顯示主要 series 的右側數值軸
- **WHEN** pane 至少有一個目前選取且具有實際資料的 series
- **THEN** 系統 MUST 在右側顯示該 pane 目前主要可見資料群組的數值刻度與單位 formatter
- **AND** 其他不同單位的 series MUST 維持獨立尺度，不得因共用右軸而壓縮主要 series

#### Scenario: 取消預設主要 series
- **WHEN** 使用者取消預設主要 series 並只保留另一個具有資料的群組
- **THEN** 右側數值軸 MUST 改為該剩餘群組的尺度並維持可見
- **AND** MUST NOT 留下無資料的空白右軸或讓數值軸消失

### Requirement: 缺資料 pane 的右鍵回補操作

籌碼 pane MUST 在既有滑鼠右鍵功能表中，依目前 symbol、pane datasets、availability、coverage 與 backfill 狀態決定是否顯示回補操作。TDCC holder 未達至少 51 週的一年歷史時 MUST 顯示「立即回補歷史資料」，並在 runtime dispatch 設定可用時立即要求既有 runner 啟動；功能 MUST NOT 在 pane header、工具列或圖表右上角增加按鈕。完整資料不得顯示不必要的回補項目，blocked／retry-waiting MUST 以不可操作狀態說明原因。

#### Scenario: 日籌碼 pane 有缺口
- **WHEN** 法人、外資持股、融資券或借券 pane 的相關 dataset 未完整涵蓋目前要求範圍
- **THEN** 右鍵功能表 MUST 顯示「立即回補缺少資料」並只要求該 pane 相關 datasets
- **AND** 操作中 MUST disabled，response 後 MUST 顯示回補已開始或等待重試的真實狀態

#### Scenario: TDCC holder 歷史不足
- **WHEN** 大戶或散戶 pane 只有少量快照、availability 為 `history_not_archived`、逐 symbol backfill 未完成，或 `completedWeeks === expectedWeeks` 但 target 少於 51 週
- **THEN** 右鍵功能表 MUST 顯示「立即回補歷史資料」
- **AND** 操作後 MUST 依 dispatch 結果顯示「立即回補啟動中」、已在執行、冷卻中或不可用的真實狀態，不得只顯示「已排入回補」或宣稱歷史已同步下載完成

#### Scenario: pane 資料已完整
- **WHEN** 目前 pane 相關 datasets availability、coverage 與 backfill 都完整且新鮮，且 TDCC holder target 已達至少 51 週
- **THEN** 右鍵功能表 MUST NOT 顯示回補項目
- **AND** 既有 series 選項與「移除副圖」 MUST 保持原行為

#### Scenario: pane lifecycle 清理
- **WHEN** pane 因取消勾選、模式切換、商品切換或 panel 銷毀
- **THEN** 系統 MUST 清除回補 menuitem listener、延遲 reload、in-flight UI 狀態與 context menu DOM
- **AND** 舊 pane 的 response MUST NOT 重新繪製到新商品

### Requirement: 券資比獨立副圖

系統 MUST 提供可獨立選取的「券資比」籌碼 pane，並 MUST 只以同一交易日、同一筆正規化 `margin-short` row 的融券餘額除以融資餘額後乘以 100 計算百分比。券資比 pane MUST 預設繪製百分比線，MUST 允許使用者從既有右鍵「線圖項目」另行顯示相對前一個合法交易日的日變化柱，並 MUST 沿用 `margin-short` 的 availability、provenance、request cache、回補操作、共用時間軸、右側數值軸與 pane lifecycle。

#### Scenario: 同日融資融券餘額有效
- **WHEN** 某交易日的 `shortTodayBalanceLots` 為 250 張，`marginTodayBalanceLots` 為 10,000 張
- **THEN** 券資比 MUST 計算為 2.50%，並在該交易日繪製百分比線資料點
- **AND** 標題列 MUST 顯示日期、券資比 2.50%、融券餘額 250 張、融資餘額 10,000 張與 `margin-short` 來源

#### Scenario: 融券餘額為零
- **WHEN** 同日融券餘額為 0 且融資餘額為合法正數
- **THEN** 券資比 MUST 顯示並繪製為 0.00%
- **AND** MUST NOT 將合法零值標示為無資料

#### Scenario: 分母為零或任一餘額不合法
- **WHEN** 同日融資餘額為 0，或融資／融券任一餘額缺漏、為負值或非有限值
- **THEN** 券資比 MUST 為 `null` 並在該交易日保留 gap，標題列 MUST 顯示「無資料」
- **AND** MUST NOT 產生無限值、補成 0、沿用其他日期或以不同日期的兩個餘額交叉計算

#### Scenario: 計算券資比日變化
- **WHEN** 目前交易日與前一個具有合法券資比的交易日分別為 2.80% 與 2.50%
- **THEN** 日變化 MUST 顯示為 +0.30%，並在已選取日變化 series 時繪製正值柱
- **AND** 正值 MUST 使用台股紅色、負值 MUST 使用綠色、零值 MUST 使用中性色
- **AND** 查詢範圍內第一個合法券資比 MUST 顯示「首筆／無前日比較」且不得繪製假的日變化柱

#### Scenario: 右鍵選擇券資比線與日變化柱
- **WHEN** 使用者開啟券資比 pane 的既有右鍵功能表
- **THEN** 「線圖項目」MUST 提供「券資比」與「日變化」，預設只勾選券資比
- **AND** 券資比名稱與百分比線 MUST 共用同一系列色，日變化名稱 MUST 使用其項目色，只有數值與柱體依正負方向變色
- **AND** 取消或重新勾選任一 series MUST 原地更新 pane，不得重新請求 `margin-short`

#### Scenario: 方式 A 與方式 B 選取券資比
- **WHEN** 使用者在方式 A 選擇券資比，或在方式 B 將券資比加入既有 pane 組合
- **THEN** 方式 A MUST 在共用副圖槽位顯示券資比，方式 B MUST 依固定 registry 順序建立獨立 pane
- **AND** 券資比 MUST 預設不加入首次方式 B 清單，不得改變既有使用者的預設頁面高度
- **AND** 與融資或融券 pane 同時顯示時 MUST 共用相同 `symbol + margin-short + range` response

#### Scenario: 游標日期與缺資料狀態
- **WHEN** 共用游標移到具有合法券資比的交易日、缺少合法比值的交易日，或游標離開 panel
- **THEN** 標題列 MUST 分別顯示該日真實比值、該日「無資料」，或恢復最新合法日期讀值
- **AND** pane MUST 保持與主圖及其他副圖相同 visible range、共用垂直線與小於等於 1 CSS px 的日期對齊
- **AND** `margin-short` 為 partial、stale、rate-limited 或等待回補時 MUST 顯示既有安全狀態與相同回補操作，不得建立券資比專用上游請求

### Requirement: TDCC holder 右鍵詳細資料表

全部十二個籌碼 pane MUST 在既有滑鼠右鍵與鍵盤功能表顯示「詳細資料」，且 MUST NOT 在標題列新增詳細資料按鈕。點選後 MUST 以結構化比較表顯示右鍵指向日期的資料；欄序 MUST 為「項目」、「前一期日期」、「當期日期」、「變化」，其中前一期與當期的欄位標題 MUST 只顯示實際日期，不得加上「前一筆」或「指向值」前綴。詳細資料浮層與表格 MUST 依實際內容寬度收縮，不得以固定桌面寬度、`width: 100%` 或表格最小寬度製造空白欄距；同時 MUST 保持項目靠左、數值靠右、長數字與單位可讀。viewport 寬度不足時 MUST 可捲動而不得截斷內容。RSI、KD、MACD、ATR 技術副圖 MUST NOT 顯示本詳細資料功能。

#### Scenario: daily pane 顯示指向交易日比較
- **WHEN** 使用者在法人、融資、融券、借券、券資比或估算融資維持率 pane 的某交易日位置按滑鼠右鍵並選擇「詳細資料」
- **THEN** 系統 MUST 以該 pane 的 X 座標解析指向交易日，並在指向交易日前尋找最近一筆有效資料
- **AND** 每個適用資料項目 MUST 依序顯示前一筆值、指向值及 `指向值 - 前一筆值`
- **AND** 前一期與當期欄位標題 MUST 只顯示對應的 ISO 日期，不得顯示「前一筆」或「指向值」文字
- **AND** 增加 MUST 為紅色、減少 MUST 為綠色、持平 MUST 為中性色

#### Scenario: 詳細資料項目沿用 series 色票
- **WHEN** 詳細資料表列出線圖已定義的資料項目
- **THEN** 項目標題 MUST 與該 pane 圖形、標題列讀值及右鍵「線圖項目」共用相同 canonical series 色票
- **AND** 來源、頻率、官方級距與提醒等非數值 metadata MUST 使用中性色且不得製造變化值

#### Scenario: TDCC holder 比較前一期與當期
- **WHEN** 使用者在大戶、散戶或集保戶數 pane 的某個 candle 日期開啟詳細資料
- **THEN** 系統 MUST 顯示指向日期、小於或等於該日的最近當期 TDCC `dataDate`，以及該當期前一筆實際發布 `dataDate`
- **AND** 表格 MUST 先列前一期值，再列指向日期對應的當期值，並以當期減前期計算變化
- **AND** MUST NOT 將週資料 forward-fill 成指向交易日的每日資料

#### Scenario: 首筆或缺值
- **WHEN** 指向資料是首筆合法資料，或某項目前一筆值缺漏
- **THEN** 前一筆與變化欄 MUST 顯示「首筆／無前期比較」或「無資料」
- **AND** MUST NOT 以 0、日曆前一天或其他欄位補值

#### Scenario: 緊湊版面維持可讀
- **WHEN** 詳細資料表顯示法人合計、融資、估算融資維持率或 TDCC holder 的完整數值與 metadata
- **THEN** 浮層與四欄 MUST 依最長實際內容收縮，項目、前期、當期、變化及 metadata 標題後方不得保留固定欄寬造成的大面積空白
- **AND** 不同資料列數與內容長度 MUST 套用相同的內容收縮原則，不得為個別 pane 設定特例寬度
- **AND** 項目、兩期數值、變化、單位與 metadata MUST 完整可讀，不得因窄化被裁切

#### Scenario: 以鍵盤開啟詳細資料
- **WHEN** 使用者在籌碼 pane 以 `ContextMenu` 鍵或 `Shift+F10` 開啟功能表後選取「詳細資料」
- **THEN** 系統 MUST 優先使用目前共用游標日期，沒有游標時使用最新合法日期，並將焦點移入同一份比較表
- **AND** Escape 或點擊表格外 MUST 關閉表格並保留副圖可操作性

#### Scenario: 技術副圖不顯示詳細資料
- **WHEN** 使用者在 RSI、KD、MACD 或 ATR 技術副圖開啟右鍵功能表
- **THEN** 系統 MUST NOT 顯示籌碼「詳細資料」項目或前期比較表
- **AND** 技術副圖既有計算、讀值、同步與 panel 截圖操作 MUST 維持不變

#### Scenario: pane 移除或切換商品
- **WHEN** 詳細資料開啟期間移除 pane、切換商品、切換模式或銷毀 controller
- **THEN** 系統 MUST 關閉並清理詳細資料 DOM、固定日期與事件 listener
- **AND** MUST NOT 留下浮層、舊商品明細或失效焦點

### Requirement: 主圖與副圖選單外部點擊收合

每個圖表 panel 的「主圖」與「副圖」選單 MUST 在使用者於已開啟選單外按滑鼠左鍵後收合，且 MUST 保留選單內 checkbox 連續複選、同 panel 選單互斥、鍵盤關閉與 panel lifecycle 清理行為。

#### Scenario: 點擊選單外的圖表區
- **WHEN** 主圖或副圖選單已開啟，使用者在該選單外的圖表、工具列其他控制項或頁面空白按滑鼠左鍵
- **THEN** 已開啟的選單 MUST 立即收合
- **AND** 該次點擊原本的圖表或控制項行為 MUST 繼續執行

#### Scenario: 在副圖選單內連續複選
- **WHEN** 副圖選單已開啟，使用者在選單內依序勾選或取消多個技術指標或籌碼項目
- **THEN** 選單 MUST 保持開啟，直到使用者點擊外部、按下 `Escape` 或展開同 panel 的另一個選單
- **AND** 每次選取 MUST 立即反映在目前 panel

#### Scenario: panel 重建後不重複處理
- **WHEN** panel 因圖數、頁籤或商品生命週期而銷毀並重建
- **THEN** 舊 panel 的 document listener MUST 被移除
- **AND** 一次外部點擊 MUST NOT 觸發重複收合、錯誤或已銷毀 panel 的處理器

### Requirement: K 線橫軸顯示共用游標日期

系統 MUST 在共用垂直游標對應有效 K 棒時，於主 K 線橫軸顯示該 K 棒的 `YYYY-MM-DD` 日期；標籤 MUST 與共用垂直線使用相同 candle time，MUST NOT 顯示「日期」前綴，也 MUST NOT 在技術或籌碼副圖重複建立日期軸標籤。

#### Scenario: 游標指向有效 K 棒
- **WHEN** 使用者在主圖、技術副圖或籌碼 pane 移動共用游標至有效 K 棒
- **THEN** 主 K 線橫軸 MUST 在共用垂直線位置顯示該 K 棒的 `YYYY-MM-DD`
- **AND** 標籤日期 MUST 與主圖及各副圖 inline readout 的游標日期一致

#### Scenario: 游標接近圖表左右邊界
- **WHEN** 共用游標位於主圖 plot 最左或最右側，且完整日期標籤若置中會超出可用區域
- **THEN** 日期標籤 MUST 在扣除價格軸後的橫軸範圍內安全偏移
- **AND** 標籤 MUST NOT 遮住價格軸、造成水平捲動或與共用垂直線失去可辨識的對應

#### Scenario: 游標離開或商品切換
- **WHEN** 游標離開 panel、沒有對應 candle、商品切換或 panel 被銷毀
- **THEN** 橫軸日期標籤 MUST 隱藏並清除舊日期
- **AND** MUST NOT 留下上一個商品或上一根 K 棒的標籤

### Requirement: 未選技術指標時釋放副圖空間

技術副圖的可見性 MUST 由目前實際選取的 RSI、KD、MACD 或 ATR 決定；未選取任何技術指標時，系統 MUST 隱藏技術副圖 header、chart 與其 layout row，不得保留最小高度、空白圖表或不可見互動區域。重新選取任一技術指標後 MUST 恢復原本緊湊高度及時間軸同步。

#### Scenario: 方式 B 取消最後一個技術指標
- **WHEN** 方式 B 仍有一個以上籌碼 pane，且使用者取消最後一個技術指標
- **THEN** 技術副圖列 MUST 完全收合，第一個籌碼 pane MUST 向上補位
- **AND** panel 與 document 高度 MUST 減少，不得保留技術副圖最小高度

#### Scenario: 方式 A 沒有技術或籌碼副圖
- **WHEN** 方式 A 的作用種類為技術副圖，但沒有選取任何技術指標且沒有作用中的籌碼 pane
- **THEN** 整個副圖槽位 MUST 收合並把空間讓回主圖版面
- **AND** 不可見 indicator chart MUST NOT 接收 resize、wheel、crosshair 或 readout 更新

#### Scenario: 重新選取技術指標
- **WHEN** 技術副圖已收合且使用者勾選任一技術指標
- **THEN** 系統 MUST 恢復技術副圖與符合目前模式的緊湊高度
- **AND** MUST 立即套用主圖 visible range、共用游標日期與可用尺寸，不得重新請求 candles

### Requirement: 多層籌碼副圖自訂排序

方式 B 的作用中籌碼 panes MUST 依「法人」、「融資券」與「大戶持股」資料群組形成相鄰 group wrapper，並透過群組專用把手及同一群組 header 的允許拖曳區整組調整上下順序；checkbox、按鈕、連結、選單與 pane chart 區 MUST NOT 啟動排序。群組內目前可見 panes MUST 使用 canonical child order，不得拆散排序。群組順序 MUST 依 `tabId + canonical symbol` 持久化；方式 A MUST NOT 顯示或接受群組排序。拖曳接近 viewport 上下邊緣時 MUST 自動捲動 document 並持續更新可到達的 drop 位置。系統 MUST 提供右鍵「上移資料群組」與「下移資料群組」作為鍵盤及非拖曳替代方式。

#### Scenario: 從擴大後的群組 header 開始拖曳
- **WHEN** 使用者從群組專用把手，或同一 header 的非互動標題／空白區按住並移動超過 drag threshold
- **THEN** 系統 MUST 啟動整個 group wrapper 的排序，並顯示涵蓋完整群組的選取外框、輕量 ghost 與等高放置框
- **AND** 從 checkbox、按鈕、連結、選單或 pane chart 區開始的手勢 MUST 執行原本操作，不得啟動群組排序

#### Scenario: 拖曳中間群組到最上方
- **WHEN** 使用者在方式 B 將一個中間資料群組拖到第一個群組之前並放開
- **THEN** 系統 MUST 顯示涵蓋完整群組的選取外框、輕量 ghost 與等高放置框，讓拖曳範圍與目標位置可清楚辨識
- **AND** 放開後 group wrapper DOM、共用十字線 plot 順序與保存順序 MUST 一致更新
- **AND** 系統 MUST 只寫入一次偏好、執行一次必要 layout refresh，且不得重新請求 pane 資料

#### Scenario: 拖曳到 viewport 外的下方群組
- **WHEN** 使用者拖曳群組並把 pointer 保持在 viewport 下方 edge zone，且 document 下方仍有內容
- **THEN** 系統 MUST 以有上限的速度向下自動捲動 document，並在捲動後重新量測 group wrappers 與 drop threshold
- **AND** 使用者 MUST 能將群組放到拖曳開始時不可見的較下方合法位置
- **AND** pointer 離開 edge zone、到達 document 底部、取消或 drop 時 MUST 立即停止自動捲動

#### Scenario: 拖曳到 viewport 外的上方群組
- **WHEN** 使用者拖曳群組並把 pointer 保持在 viewport 上方 edge zone，且 document 上方仍有內容
- **THEN** 系統 MUST 以有上限的速度向上自動捲動 document，並在捲動後重新量測 group wrappers 與 drop threshold
- **AND** 使用者 MUST 能將群組放到拖曳開始時不可見的較上方合法位置
- **AND** pointer 離開 edge zone、到達 document 頂部、取消或 drop 時 MUST 立即停止自動捲動

#### Scenario: 拖曳移動期間不搬動 Canvas
- **WHEN** 使用者持續移動群組拖曳 pointer、跨越其他群組或觸發邊緣自動捲動
- **THEN** 系統 MUST 以單一 `requestAnimationFrame` loop 更新 document 捲動、ghost 與 placeholder
- **AND** 在合法 drop 前 MUST NOT 搬動實際 pane／Canvas DOM、執行 chart resize、量測右側軸、寫入偏好或呼叫資料 load

#### Scenario: 部分選取群組整組拖曳
- **WHEN** 某群組只有部分子項目可見且使用者拖曳該群組
- **THEN** 所有目前可見的同群組 panes MUST 作為一個單位移動
- **AND** 未選子項目 MUST NOT 因拖曳被建立或改變勾選狀態

#### Scenario: 從右鍵功能表移動群組
- **WHEN** 使用者在任一籌碼 pane 以滑鼠右鍵、`ContextMenu` 鍵或 `Shift+F10` 選擇「上移資料群組」或「下移資料群組」
- **THEN** 該 pane 所在群組 MUST 移動一個有效群組位置並保存與拖曳相同的順序
- **AND** 已在最上方或最下方群組的對應操作 MUST 顯示 disabled

#### Scenario: 取消進行中的群組拖曳
- **WHEN** 使用者按下 Escape、發生 `pointercancel`、視窗失焦、document 隱藏、視窗 resize、切換商品／模式，或系統偵測按鍵已釋放而沒有合法 drop
- **THEN** 系統 MUST 停止自動捲動、取消 pending animation frame，並移除 ghost、放置框與拖曳樣式
- **AND** 系統 MUST 保留拖曳開始前的實際 DOM 與順序，不得寫入偏好或觸發資料重新載入

#### Scenario: 遷移既有單 pane 順序
- **WHEN** 既有偏好只有 `modeBPaneOrder` 而沒有群組順序
- **THEN** 系統 MUST 以每個群組第一個已選 pane 在舊順序的位置決定群組相對順序，再以 canonical child order 排列群組內 panes
- **AND** 重複、未知或未選 pane IDs MUST 安全忽略，未出現群組 MUST 依 registry 順序補入

#### Scenario: 切換商品後恢復各自群組順序
- **WHEN** 使用者在一個商品完成群組排序後切換至另一個商品，再返回原商品
- **THEN** 每個商品 MUST 依自己的 `tabId + canonical symbol` 恢復子項目勾選及群組順序
- **AND** A 模式的單一作用 pane MUST NOT 覆寫 B 模式的群組選擇與順序

### Requirement: 籌碼資料群組階層選取

系統 MUST 在方式 B 的「籌碼資料」選單把十二個籌碼副圖整理為三個具有大項目與子項目的資料群組：「法人」包含外資買賣超＋持股、投信買賣超、自營商買賣超、三大法人合計；「融資券」包含融資、融券、借券、券資比、估算融資維持率；既有群組 ID 的顯示名稱 MUST 從「大戶持股」更新為「持股比」，並包含大戶持股、散戶持股、集保戶數。大項目 MUST 依子項目呈現 checked、unchecked 或 indeterminate，子項目 MUST 可獨立勾選或取消。

#### Scenario: 勾選未全選的大項目
- **WHEN** 方式 B 的某群組目前為 unchecked 或 indeterminate，使用者勾選大項目
- **THEN** 系統 MUST 一次勾選該群組全部子項目並建立各自獨立 pane
- **AND** 同群組 panes MUST 依群組 canonical child order 相鄰排列，共用相同 dataset response 時不得重複請求

#### Scenario: 取消已全選的大項目
- **WHEN** 方式 B 的某群組全部子項目均已勾選，使用者取消大項目
- **THEN** 系統 MUST 一次取消該群組全部子項目並銷毀對應 controllers
- **AND** 其他群組、技術副圖、主圖與 candles MUST 保持作用

#### Scenario: 個別取消子項目
- **WHEN** 使用者取消已全選群組中的一個子項目
- **THEN** 系統 MUST 只移除該 pane，並將大項目設為 indeterminate
- **AND** 其餘可見子項目 MUST 保持相鄰且依 canonical child order 排列

#### Scenario: 方式 A
- **WHEN** panel 使用方式 A
- **THEN** 使用者 MUST 仍可在群組結構中選取一個子項目作為單一籌碼 pane
- **AND** 大項目整組選取 MUST 不可操作並以可存取狀態說明只有多層副圖可整組顯示

#### Scenario: 全選首次預設並保留使用者選擇
- **WHEN** 使用者首次進入方式 B，或既有偏好尚未包含群組欄位
- **THEN** 尚無 `modeBSelectedPaneIds` 時系統 MUST 依 registry 順序預設勾選全部十二個籌碼副圖，再由子項目推導三個群組皆為 checked
- **AND** 已有 `modeBSelectedPaneIds` 時 MUST 原樣保留其部分選取或空陣列，不得因升級自動開啟新增的籌碼副圖

#### Scenario: 群組改名保持偏好相容
- **WHEN** 使用者從舊版「大戶持股」群組升級至顯示名稱「持股比」
- **THEN** 系統 MUST 保留既有 stable group ID、群組順序、置底狀態及子項目選取
- **AND** MUST NOT 因顯示名稱改變建立重複群組或重設偏好

### Requirement: 籌碼資料提示必須位於副圖尾端且可關閉

系統 MUST 將籌碼資料 warnings 顯示在目前 panel 的所有已選籌碼副圖群組之後，不得插在技術指標與第一個籌碼副圖之間。提示 MUST 提供鍵盤可操作且有明確 accessible name 的關閉按鈕。

#### Scenario: 多層副圖顯示資料提示
- **WHEN** 多層副圖已載入一個以上的籌碼群組且 API 回傳 warnings
- **THEN** 提示 MUST 出現在最後一個籌碼群組之後
- **AND** 提示 MUST NOT 覆蓋副圖內容或阻擋副圖互動

#### Scenario: 使用者關閉目前提示
- **WHEN** 使用者啟動提示的關閉按鈕
- **THEN** 目前 panel 的提示 MUST 立即隱藏
- **AND** 相同商品、週期與完全相同 warning 內容重新載入時 MUST 維持隱藏

#### Scenario: 提示內容或圖表身分改變
- **WHEN** 使用者已關閉提示，之後商品、週期或 warning 內容改變
- **THEN** 新提示 MUST 重新顯示
- **AND** 關閉狀態 MUST NOT 永久隱藏後續不同資料狀態

### Requirement: 籌碼資料群組一鍵置頂

每個籌碼副圖既有的右鍵功能表 MUST 固定提供「置頂」操作；在方式 B 可排序狀態下，系統 MUST 將該 pane 所在的完整資料群組移到籌碼副圖區第一個群組位置，並維持群組內 canonical child order。置頂 MUST 沿用既有 `tabId + canonical symbol` 群組順序保存，且不得重新請求 pane 資料。

#### Scenario: 將中間群組一鍵置頂
- **WHEN** 使用者在方式 B 對非第一個群組內任一籌碼 pane 開啟右鍵功能表並選擇「置頂」
- **THEN** 該 pane 所在的完整 group wrapper MUST 一次移到籌碼副圖區第一個群組位置
- **AND** 群組內目前可見 panes MUST 維持 canonical child order，其他群組 MUST 依原相對順序向後補位
- **AND** 系統 MUST 只保存一次偏好、執行一次必要 layout refresh，且不得重新請求資料

#### Scenario: 已在最上方的群組
- **WHEN** 使用者開啟目前第一個資料群組內任一籌碼 pane 的右鍵功能表
- **THEN** 功能表 MUST 顯示「置頂」但設為 disabled
- **AND** 選擇狀態、DOM 順序、偏好與資料請求 MUST 保持不變

#### Scenario: 單層副圖模式顯示置頂狀態
- **WHEN** 使用者在方式 A 的籌碼 pane 開啟右鍵功能表
- **THEN** 功能表 MUST 顯示「置頂」但設為 disabled
- **AND** 系統 MUST NOT 改變方式 A 的作用種類、技術副圖或籌碼 pane 選擇

#### Scenario: 重新載入後恢復置頂順序
- **WHEN** 使用者完成群組置頂後重新載入頁面，或切換商品後再返回原商品
- **THEN** 系統 MUST 依該 `tabId + canonical symbol` 保存狀態恢復群組順序
- **AND** MUST NOT 將置頂順序套用到其他 tab 或 symbol

### Requirement: 自營商組成項目選擇

自營商副圖的既有右鍵「線圖項目」MUST 提供「自行」、「避險」與「合計」三個可見 series，分別使用來源資料的 `dealerSelfNetShares`、`dealerHedgingNetShares` 與 `dealerTotalNetShares`；首次使用或既有偏好沒有自營商設定時 MUST 預設只顯示「自行」。自營商至少 MUST 保留一個可見項目，圖形、逐日讀值與右側數值軸 MUST 依目前選取項目同步更新。

#### Scenario: 首次顯示自營商副圖
- **WHEN** 目前 tab 與 symbol 沒有保存 `dealer-flow` 的 series 選擇
- **THEN** 自營商副圖 MUST 預設只繪製「自行」柱狀 series
- **AND** 右鍵功能表 MUST 將「自行」顯示為已勾選，將「避險」與「合計」顯示為未勾選

#### Scenario: 切換自營商顯示項目
- **WHEN** 使用者從自營商右鍵功能表選取「避險」、「合計」或多個項目
- **THEN** pane MUST 只繪製目前選取且具有實際資料的 series
- **AND** header 逐日讀值 MUST 只顯示目前選取項目的同日數值與各自方向
- **AND** 右側數值軸 MUST 依目前可見的第一個有效自營商 series 維持可讀

#### Scenario: 取消最後一個自營商項目
- **WHEN** 使用者嘗試取消自營商目前最後一個已勾選項目
- **THEN** 系統 MUST 保留該項目的勾選與圖形
- **AND** MUST NOT 保存空的 `dealer-flow` series 選擇或顯示空白 pane

#### Scenario: 保留既有自營商選擇
- **WHEN** 既有 `seriesByPane['dealer-flow']` 含一個以上合法項目
- **THEN** 系統 MUST 恢復該 tab、symbol 與 pane 的合法選擇
- **AND** MUST NOT 因新預設為「自行」而覆寫既有選擇，未知項目則 MUST 安全忽略

#### Scenario: 自營商組成資料缺漏
- **WHEN** 某交易日的已選自營商項目為 `null`，但其他未選項目或合計仍有資料
- **THEN** 系統 MUST 將該已選項目標示為「無資料」並保留 series gap
- **AND** MUST NOT 以合計反推自行或避險，也不得以 0 或其他項目補值

### Requirement: 籌碼資料群組一鍵置底

每個籌碼副圖既有的右鍵功能表 MUST 固定提供「置底」操作；在方式 B 可排序狀態下，系統 MUST 將該 pane 所在的完整資料群組移到籌碼副圖區最後一個群組位置，並維持群組內 canonical child order。置底 MUST 沿用既有 `tabId + canonical symbol` 群組順序保存，且不得重新請求 pane 資料。

#### Scenario: 將中間群組一鍵置底
- **WHEN** 使用者在方式 B 對非最後一個群組內任一籌碼 pane 開啟右鍵功能表並選擇「置底」
- **THEN** 該 pane 所在的完整 group wrapper MUST 一次移到籌碼副圖區最後一個群組位置
- **AND** 群組內目前可見 panes MUST 維持 canonical child order，其他群組 MUST 依原相對順序向前補位
- **AND** 系統 MUST 只保存一次偏好、執行一次必要 layout refresh，且不得重新請求資料

#### Scenario: 已在最下方的群組
- **WHEN** 使用者開啟目前最後一個資料群組內任一籌碼 pane 的右鍵功能表
- **THEN** 功能表 MUST 顯示「置底」但設為 disabled
- **AND** 選擇狀態、DOM 順序、偏好與資料請求 MUST 保持不變

#### Scenario: 單層副圖模式顯示置底狀態
- **WHEN** 使用者在方式 A 的籌碼 pane 開啟右鍵功能表
- **THEN** 功能表 MUST 顯示「置底」但設為 disabled
- **AND** 系統 MUST NOT 改變方式 A 的作用種類、技術副圖或籌碼 pane 選擇

#### Scenario: 重新載入後恢復置底順序
- **WHEN** 使用者完成群組置底後重新載入頁面，或切換商品後再返回原商品
- **THEN** 系統 MUST 依該 `tabId + canonical symbol` 保存狀態恢復群組順序
- **AND** MUST NOT 將置底順序套用到其他 tab 或 symbol

### Requirement: 集保戶數副圖

系統 MUST 在「持股比」群組提供可獨立選取的「集保戶數」週頻柱狀 pane，以柱狀圖呈現 TDCC 分級 17 總戶數；標題列 MUST 顯示實際 `dataDate`、總戶數及相對前一筆實際發布資料的戶數變化。該 pane MUST 沿用大戶／散戶的 TDCC response、方式 A／B、週資料 gap、共同游標、群組排序、右鍵線圖項目、詳細資料、截圖及 lifecycle 規劃。

#### Scenario: 顯示集保戶數
- **WHEN** 使用者勾選「集保戶數」且某週具有合法 TDCC 分級 17 合計
- **THEN** pane MUST 在實際 `dataDate` 畫出總戶數柱
- **AND** 標題列 MUST 顯示總戶數及帶正負號的戶數變化，增加為紅色、減少為綠色、持平為中性色

#### Scenario: 首筆或未發布日期
- **WHEN** 該筆是首筆合法 TDCC 快照，或游標日期不是實際 `dataDate`
- **THEN** 標題列 MUST 分別顯示「首筆／無前期比較」或「當日無資料」
- **AND** MUST NOT forward-fill、內插或以零值補出每日柱

### Requirement: 新增持股與融資 pane 的右鍵內容

「集保戶數」、「估算融資維持率」及大戶／散戶新增的股東人數 series MUST 沿用既有籌碼 pane 右鍵功能表。右鍵「線圖項目」MUST 提供各 series 獨立顯示切換；「詳細資料」MUST 以指向日期及前一筆有效資料顯示項目、兩期日期／值、變化、單位與必要 metadata，並共用 canonical series 色票。

#### Scenario: 開啟集保戶數詳細資料
- **WHEN** 使用者在集保戶數 pane 的某個 candle 日期開啟「詳細資料」
- **THEN** 表格 MUST 顯示小於或等於指向日期的最近當期 TDCC `dataDate`、前一筆實際 `dataDate`、兩期總戶數與戶數變化
- **AND** MUST 明確區分指向 candle 日期與週資料實際日期

#### Scenario: 切換大戶散戶的人數線
- **WHEN** 使用者在大戶或散戶 pane 的右鍵「線圖項目」關閉或開啟股東人數
- **THEN** 系統 MUST 只改變該 series 可見性並保存偏好
- **AND** 持股比例、比例變化柱、資料快取及其他 pane MUST 不受影響

#### Scenario: 查看估算融資維持率詳細資料
- **WHEN** 使用者在估算融資維持率 pane 開啟「詳細資料」
- **THEN** 表格 MUST 顯示前一期與當期的估算維持率、融資餘額、融資增減張、估算成本、融資成數及 formula metadata
- **AND** 缺值原因與 seeded／partial 狀態 MUST 使用中性色，不得製造變化值

### Requirement: 副圖群組重排後保留 viewport 與游標座標

系統 MUST 在副圖資料群組執行「置頂」、「置底」或拖曳排序前保存時間錨點式 viewport snapshot，並在 DOM 重排及 chart resize 完成後還原同一個資料時間範圍與右側貼齊狀態。重排後共用游標對同一根 K 棒的 X 座標偏差 MUST 不超過 1 CSS px。

#### Scenario: 副圖置頂不產生左側空白
- **WHEN** 使用者在多層副圖以右鍵將非第一個資料群組「置頂」
- **THEN** 主圖與所有資料副圖仍顯示原本的時間範圍，不因暫時 logical range 或 canvas 尺寸變化在左側產生額外空白

#### Scenario: 副圖置頂後游標維持對齊
- **WHEN** 使用者在重排前已將游標放在一根可見 K 棒，且完成群組置頂
- **THEN** 主圖、技術副圖與籌碼副圖的共用游標仍指向同一根 K 棒，任兩個可見 plot 的 X 座標差異不超過 1 CSS px

### Requirement: 籌碼資料提示依資料集使用可辨識色彩

系統 MUST 保留 API `warnings[]` 的逐筆邊界，並將已知資料集的提示以穩定且互不混淆的色彩呈現；跨資料集或未知 warning MUST 使用中性色。提示文字 MUST 以純文字渲染，且關閉按鈕 MUST 只關閉目前相同內容與 context 的提示。

#### Scenario: 多筆資料集提示不再全部使用橘黃色
- **WHEN** API 回傳外資持股、融資融券及借券等兩筆以上 warning
- **THEN** 畫面以多個獨立文字片段呈現，已知資料集片段具有不同的資料集色彩，且每筆完整說明仍可閱讀

#### Scenario: 使用者關閉提示後不影響其他資料集
- **WHEN** 使用者關閉目前 warning 提示，之後資料內容或 symbol context 改變
- **THEN** 新的 warning signature 仍可重新顯示，且關閉不會刪除或改寫任何資料列

### Requirement: 籌碼資料不得超前於最近已完成交易日

籌碼 API MUST 只以資料來源 payload 內可驗證的實際日期決定 row 日期與最新 coverage；三大法人、融資券及其他日籌碼資料只要取得合法 requested end row 就 MUST 立即顯示，不得等待固定發布時間。來源尚未發布 requested end 時，服務 MUST 保留前一筆實際 source date 與 availability 狀態，不得以 K 棒日期、requested end、無日期快照或前一日數值補造任何籌碼資料。

#### Scenario: 任一時間取得今日融資券資料
- **WHEN** requested end 是今日，且來源回傳可驗證日期為今日的 `margin-short` row
- **THEN** API 與副圖 MUST 立即顯示今日融資券資料，不得等待 22:00 或其他固定時間

#### Scenario: 今日融資券尚未發布
- **WHEN** requested end 是今日，但來源最新可驗證融資券日期仍為前一交易日
- **THEN** 副圖 MUST 只將前一交易日資料標示為前一交易日，今日位置 MUST 顯示「當日無資料」
- **AND** MUST NOT 複製前一交易日數值形成今日 row，或讓連續兩日顯示相同的偽造資料

#### Scenario: 官方已發布今日三大法人資料
- **WHEN** requested end 是今日，且 TWSE 或 TPEx 官方來源已發布可驗證日期為今日的資料
- **THEN** API MUST 保存並回傳今日 `institutional-flow`，三大法人副圖 MUST 顯示今日實際數值與來源日期
- **AND** 顯示時機 MUST 不受融資券或其他資料集狀態影響

#### Scenario: 游標落在尚未發布的今日 K 棒
- **WHEN** K 線已有今日盤中資料，但某籌碼資料集尚未有今日 row
- **THEN** 該資料集 readout 顯示游標日期的「當日無資料」狀態，最近一筆資料若存在則另標示其真實日期，不將最近一筆數值標成今日

### Requirement: 修正維持既有資料與部署邊界

本變更 MUST 不新增 D1 schema、不改變資料來源授權、不提交秘密資料，並 MUST 維持 6／8 圖單一副圖與既有多層副圖 eligible context 政策。

#### Scenario: 修正不改變未相關的圖表政策
- **WHEN** 使用者在非台股、非日 K、6 圖或 8 圖模式載入頁面
- **THEN** 系統維持既有不可用或單一副圖行為，且不啟用本變更的多層重排協調

### Requirement: 副圖滑鼠位置必須以主 K 線解析共用交易日

系統 MUST 將主圖、技術副圖與籌碼副圖內的滑鼠絕對螢幕 X 座標映射到主 K 線 plot，並以主圖對應的 candle time 作為共用垂直線、日期標籤、技術讀值及所有籌碼 readout 的唯一交易日。系統 MUST NOT 直接採用可能已漂移副圖的 logical index 或 `crosshairMove.param.time` 覆蓋主圖交易日。

#### Scenario: 在任一籌碼副圖移動滑鼠

- **WHEN** 使用者把滑鼠移到任一可見籌碼 pane 的 plot 左側、中央或右側
- **THEN** 系統 MUST 以該螢幕 X 在主圖解析出同一根 K 棒
- **AND** 共用垂直線、主圖日期、技術指標 readout 與所有籌碼 readout MUST 使用該 K 棒交易日
- **AND** 垂直線與該交易日於每個可見 pane 的資料點 X 座標差 MUST 小於或等於 1 CSS px

#### Scenario: 滑鼠位於副圖價格軸或 plot 外

- **WHEN** 副圖 pointer 的絕對螢幕 X 不在主圖可繪製 plot 範圍內
- **THEN** 系統 MUST 清除或維持未作用的共用游標狀態
- **AND** MUST NOT 以價格軸位置推算另一個交易日或顯示錯誤資料

### Requirement: 技術指標時間域與可見 series 必須跟隨目前 candles

系統 MUST 在圖表套用前將 RSI、KD、MACD、ATR、成交量及主圖衍生線的可視資料限制於目前 canonical candles 的 time domain。當使用者已選取技術指標且 payload 對目前 candles 含合法資料時，商品切換、快取前景更新、快速換頁、resize、捲動或多層副圖重建後 MUST 建立並顯示對應 series；不得因游離時間點、舊 generation 或先移除後失敗而留下空白技術副圖。

#### Scenario: 指標 payload 含顯示 candles 以外的時間

- **WHEN** 技術指標 line 或 histogram 含早於、晚於或不存在於目前 candles 的時間點
- **THEN** 系統 MUST 在呼叫 Lightweight Charts 前移除該游離時間點
- **AND** MUST 保留目前 candle time domain 內的合法指標資料
- **AND** 主圖、技術副圖與籌碼 time anchor 的相同 logical index MUST 代表相同交易日

#### Scenario: 多商品重建已選取技術指標

- **WHEN** 1／2／3／4 圖的商品在快取更新、快速換頁或 layout resize 後重建，且 KD、RSI、MACD 或 ATR 已選取並有合法資料
- **THEN** 每個 panel MUST 顯示所有已選取且有合法資料的技術 series
- **AND** debug／驗收資料 MUST 能區分 series 沒有合法資料與 series 未建立
- **AND** browser Console 與 panel 狀態 MUST NOT 出現圖表重建錯誤

#### Scenario: 技術指標與主圖同步縮放平移

- **WHEN** 使用者在主圖或任一作用中的副圖縮放、平移、捲頁後返回可見區域
- **THEN** 系統 MUST 優先以主圖真實 visible time range 同步所有已建立 time anchor 的副圖
- **AND** logical range fallback MUST NOT 改變同一交易日的 X 座標對齊
- **AND** layout 穩定後左中右測試交易日的跨 pane 最大偏差 MUST 小於或等於 1 CSS px

### Requirement: 多層籌碼副圖首次預設不勾選集保戶數

系統 MUST 在尚無該頁籤與商品保存選擇的多層副圖首次狀態，預設選取既有籌碼 pane，但 MUST 將 `tdcc-holder-count`「集保戶數」保持未勾選。系統 MUST 保留使用者手動勾選、持股比群組全選及既有已保存選擇，不得以預設調整強制清除客製狀態。

#### Scenario: 新商品首次進入多層副圖
- **WHEN** 使用者首次在 eligible 台股商品進入多層副圖，且該頁籤與商品沒有保存 pane 選擇
- **THEN** 「集保戶數」checkbox MUST 未勾選，且畫面 MUST NOT 建立集保戶數 pane
- **AND** 大戶持股與散戶持股 MUST 維持既有預設選取

#### Scenario: 既有使用者已勾選集保戶數
- **WHEN** 該頁籤與商品的保存選擇已包含 `tdcc-holder-count`
- **THEN** 系統 MUST 保留該選擇並建立集保戶數 pane

#### Scenario: 使用持股比群組全選
- **WHEN** 使用者明確勾選持股比群組主項
- **THEN** 系統 MUST 同時選取大戶持股、散戶持股與集保戶數

### Requirement: 籌碼副圖數值軸必須使用精簡刻度

系統 MUST 僅在籌碼副圖右側數值軸精簡張數與百分比刻度；張數絕對值達千位時 MUST 使用 `K張`，百分比 MUST 移除尾端無意義的零，同時保留必要的小數、正負號與單位。圖例、游標讀值、詳細資料及原始數值 MUST 維持既有完整格式與精度。

#### Scenario: 千位張數使用 K 縮寫
- **WHEN** 籌碼副圖右側數值軸需要顯示 `50,000` 張或 `1,500` 張
- **THEN** 刻度 MUST 分別顯示為 `50K張` 與 `1.5K張`
- **AND** 刻度 MUST NOT 顯示為 `50,000張` 或補上無意義的小數

#### Scenario: 小於千位張數維持張單位
- **WHEN** 籌碼副圖右側數值軸需要顯示 `500` 張
- **THEN** 刻度 MUST 顯示為 `500張`
- **AND** 系統 MUST NOT 將其誤寫為 `0.5K張`

#### Scenario: 百分比移除尾端零
- **WHEN** 籌碼副圖右側數值軸需要顯示 `2.00%`、`2.50%` 或 `-0.25%`
- **THEN** 刻度 MUST 分別顯示為 `2%`、`2.5%` 與 `-0.25%`
- **AND** 必要的非零小數與負號 MUST 保留

#### Scenario: 精簡格式不影響讀值
- **WHEN** 同一籌碼 series 同時顯示右側數值軸與 header 或游標 readout
- **THEN** 只有數值軸 MUST 使用精簡刻度 formatter
- **AND** header、游標 readout 與詳細資料 MUST 維持既有完整格式
