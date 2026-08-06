## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: 圖表數量與副圖模式政策

系統 MUST 支援 1、2、3、4、6、8 圖。只有目前頁籤具有一個以上商品且全部為台股 `.TW`／`.TWO` 時，1、2、3、4 圖 MUST 可使用 A 或 B 且首次預設 B；6、8 圖 MUST 固定使用 A。非台股頁籤與同時含台股及非台股的混合頁籤，任何圖數都 MUST 固定使用 A。方式控制 MUST 是全域設定，所有目前 panel 採用符合市場與圖數政策的 effective mode；每個 panel MUST 再依自身 symbol 阻止非台股採用 B。使用 A 的任何圖數都 MUST 套用同一個共用副圖槽位規則。工具列 MUST NOT 以常駐說明列顯示圖數或市場限制文案。

#### Scenario: 首次使用台股 1、2、3 或 4 圖
- **WHEN** 裝置尚未保存籌碼副圖偏好，目前頁籤全部為台股，且使用者選擇 1、2、3 或 4 圖
- **THEN** 系統 MUST 啟用方式 B
- **AND** MUST 預設勾選全部十二個籌碼副圖
- **AND** 模式下拉選單 MUST 可操作

#### Scenario: 台股 6、8 圖固定方式 A
- **WHEN** 使用者在全台股頁籤選擇 6 或 8 圖
- **THEN** 系統 MUST 套用方式 A
- **AND** 模式下拉選單 MUST 顯示灰色 disabled 的「單一副圖」、設定原生 disabled 與 `aria-disabled="true"`，且不得接受滑鼠或鍵盤切換
- **AND** 每個 panel MUST 只保留一個共用副圖槽位
- **AND** 工具列 MUST NOT 新增另一列說明文字

#### Scenario: 非台股頁籤固定方式 A
- **WHEN** 目前頁籤是美股、匯率債券、期貨期指、加密資產或其他只含非台股商品的頁籤
- **THEN** 任何圖表數量都 MUST 套用方式 A
- **AND** 模式下拉選單 MUST 顯示 disabled 的「單一副圖」與 `aria-disabled="true"`
- **AND** 控制項 title MUST 說明只有台股商品可使用多層副圖

#### Scenario: 混合頁籤固定方式 A
- **WHEN** 自訂頁籤同時包含台股與至少一個非台股商品
- **THEN** 整個頁籤與每個 panel MUST 套用方式 A
- **AND** 非台股 panel 不得在切換或載入期間短暫建立多層籌碼 pane

#### Scenario: 從台股 B 切到受限頁籤後返回
- **WHEN** 使用者從 1、2、3 或 4 圖的全台股方式 B 切換至非台股、混合頁籤或台股 6／8 圖，再返回原本符合條件的台股頁籤與圖數
- **THEN** 受限期間 MUST 只顯示方式 A 最後作用的技術副圖或單一籌碼 pane
- **AND** 系統 MUST NOT 覆寫裝置端保存的方式 B 偏好或台股 pane 選擇
- **AND** 返回後 MUST 恢復原本方式 B、技術副圖狀態與完整籌碼勾選組合，模式下拉選單 MUST 恢復可操作

#### Scenario: 顯示台股 3 圖方式 B 版面
- **WHEN** 使用者在寬螢幕的全台股頁籤選擇 3 圖方式 B
- **THEN** 系統 MUST 以三欄一列呈現三個等寬 panel
- **AND** 低於多圖可讀性 breakpoint 時 MUST 改為單欄，不得使用不對稱的二加一版面

#### Scenario: 顯示 4 圖方式 A 版面
- **WHEN** 使用者在寬螢幕選擇 4 圖方式 A
- **THEN** 系統 MUST 維持既有 2×2 panel 版面與固定視窗配置
- **AND** 每個 panel MUST 只顯示至多一個共用副圖槽位

#### Scenario: 顯示台股 4 圖方式 B 版面
- **WHEN** 使用者在寬螢幕的全台股頁籤選擇 4 圖方式 B
- **THEN** 系統 MUST 以一列四欄呈現四個等寬 panel，不得改為 2×2
- **AND** 每個 panel MUST 依可見副圖內容自然增高，由整個瀏覽器 document 垂直捲動
- **AND** 低於多圖可讀性 breakpoint 時 MUST 改為單欄

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

### Requirement: 大戶與散戶獨立副圖

系統 MUST 將大戶持股與散戶持股提供為兩個可獨立選取的週頻複合 pane；每個 pane MUST 以比例線顯示持股比例、以正負柱顯示相較前一筆實際發布週資料的百分點變化，並預設以獨立尺度的人數線顯示該級距股東人數。pane 的預設標題列 MUST 顯示精簡名稱、實際資料日期、持股比例、週變化、持股增減張數、股東人數、人數變化與級距選單，且級距選單 MUST 靠可用列最右側；級距精確範圍、持股總張數、來源、資料頻率與投資人身分提醒 MUST 由右鍵「詳細資料」以表格提供。方式 B 同時勾選時 MUST 上下排列且共用相同 TDCC response；方式 A MUST 只顯示目前選取的一個 pane。TDCC 值 MUST 只屬於其實際 `dataDate`，其他交易日不得 forward-fill、插值或視為 0。

#### Scenario: 顯示預設大戶持股
- **WHEN** 大戶持股 pane 建立且有至少一筆 TDCC 分級 15 資料
- **THEN** pane MUST 以百分比線圖顯示分級 15 的持股比例，並預設顯示股東人數線
- **AND** 預設標題列 MUST 依序顯示「大戶持股」、實際資料日期、持股比例「持股」、週變化、張數變化「持股」、股東人數與人數變化，並將「1,000 張以上」級距選單靠最右側
- **AND** 預設標題列 MUST NOT 顯示官方精確級距、持股總張數、來源、資料頻率或投資人身分提醒

#### Scenario: 顯示預設散戶持股
- **WHEN** 散戶持股 pane 建立且具有 TDCC 分級 1 至 3 資料
- **THEN** pane MUST 以百分比線圖顯示三個分級加總比例，並預設顯示股東人數線
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
- **WHEN** 某週與前一筆實際發布週資料具有完整級距人數
- **THEN** pane MUST 以獨立尺度的人數線顯示當週股東人數
- **AND** 標題列與詳細資料 MUST 顯示當週人數及「當週人數減前週人數」的帶正負號變化

#### Scenario: 只有一筆 TDCC 快照
- **WHEN** 查詢範圍只有一筆合法股權分散資料
- **THEN** pane MUST 顯示該筆比例與人數資料點，且該 `dataDate` 的標題列週變化、持股增減及人數變化 MUST 顯示「首筆／無前週比較」
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

#### Scenario: 方式 A 與強制單一模式
- **WHEN** panel 使用方式 A，或因 6／8 圖強制為單一副圖
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
