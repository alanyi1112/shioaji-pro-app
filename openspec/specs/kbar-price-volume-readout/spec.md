# kbar-price-volume-readout Specification

## Purpose
TBD - created by archiving change add-kbar-price-volume-readout. Update Purpose after archive.
## Requirements
### Requirement: 技術指標選擇器必須提供單一 K 棒價量 readout
系統 MUST 在技術指標選擇器的「主圖疊加」提供「K 棒價量」，並允許以名稱、價量、OHLCV、開高低收及時間區間搜尋。此項目 MUST 是不建立圖線、價格軸標籤或副圖的受控 readout，且同一份 canonical indicator instances 中最多只能存在一個。

#### Scenario: 第一次加入 K 棒價量
- **WHEN** 使用者在「主圖疊加」點選尚未加入的「K 棒價量」
- **THEN** 系統 MUST 建立一個 readout instance 並顯示於適用的 K 線圖
- **AND** 系統 MUST NOT 建立 lightweight-charts series、改變 autoscale 或新增 API 請求

#### Scenario: 重複點選已加入項目
- **WHEN** canonical instances 已有 K 棒價量，使用者再次點選該項目
- **THEN** 系統 MUST NOT 建立第二個 instance
- **AND** 系統 MUST 聚焦既有設定或顯示可理解的「已加入」狀態

#### Scenario: 控制 K 棒價量
- **WHEN** 使用者操作 K 棒價量的 legend 控制
- **THEN** 系統 MUST 允許隱藏、顯示、移除及設定適用時框
- **AND** 系統 MUST NOT 提供複製、上移或下移操作

### Requirement: readout 第一欄必須顯示 K 棒時間區間
啟用 K 棒價量後，主圖 readout 的第一欄 MUST 顯示目前選取 K 棒的時間區間，且 MUST NOT 在時間區間前顯示「回報價量」或「K 棒價量」。其後 MUST 依序顯示「開、 高、低、收／最新、量」及對應數值。

#### Scenario: 顯示 5 分 K 的區間與價量
- **WHEN** 游標所在 K 棒代表台灣時間 09:45:00 至 09:49:59 且已收線
- **THEN** readout MUST 以 `09:45–09:49` 作為第一欄
- **AND** 後續 MUST 依序顯示該 candle 的開、高、低、收及量
- **AND** 可見文字 MUST NOT 包含「回報價量」或「K 棒價量」前綴

#### Scenario: 顯示 1 分 K 與 60 分 K
- **WHEN** 使用者分別查看 1m 或 60m candle
- **THEN** 1m MUST 顯示包含秒的完整一分鐘區間，例如 `09:48:00–09:48:59`
- **AND** 60m MUST 顯示起訖分鐘，例如 `09:00–09:59`

#### Scenario: 顯示跨日期或 1D K
- **WHEN** 區間起訖跨越日期或目前時框為 1D
- **THEN** 跨日期的日內區間 MUST 在起訖兩端顯示 `MM/DD`
- **AND** 1D MUST 顯示該 K 棒代表的台灣交易日期，例如 `2026/08/06`
- **AND** 系統 MUST NOT 以瀏覽器所在時區改寫圖表既有的台灣市場 wall-clock 時間

### Requirement: readout 必須回報游標所在 canonical candle
系統 MUST 以 crosshair time 查找目前圖表已載入並按目前時框聚合的 canonical candle，並從同一 candle 取得 open、high、low、close 與 volume。系統 MUST NOT 使用右上角最新行情 snapshot、滑鼠 Y 座標或其他時框 candle 代替。

#### Scenario: 游標查看歷史 K 棒
- **WHEN** crosshair time 對應一根歷史 canonical candle
- **THEN** readout MUST 顯示該 candle 的時間區間、開、高、低、收與量
- **AND** 最新行情或其他 candle 更新 MUST NOT 改寫目前歷史讀值

#### Scenario: 游標跨越副圖 pane
- **WHEN** 使用者在與主圖共用時間軸的副圖 pane 移動 crosshair
- **THEN** readout MUST 依相同 crosshair time 顯示對應主圖 candle
- **AND** 系統 MUST NOT 以副圖數值代替 OHLCV

#### Scenario: 游標離開或位於空白區
- **WHEN** crosshair 沒有 time、離開圖表或位於沒有 candle 的未來空白區
- **THEN** readout MUST 回到最新一根可用 canonical candle
- **AND** 若目前沒有 candle，時間、開、高、低、收／最新及量 MUST 顯示 `—`

### Requirement: 日內跨日邊界必須使用較粗垂直分隔線
在 1m、5m、15m 或 60m 圖中，當依時間遞增的相鄰 canonical candles 之台灣顯示日期不同時，系統 MUST 在前一日最後一根與新日期第一根 candle 之間繪製 1.2 CSS px 的亮黃色垂直跨日分隔線。分隔線 MUST 使用獨立的 day-boundary semantic color、對齊所有現存主副圖 pane，且 MUST NOT 沿用一般 grid color、改變資料、autoscale、crosshair 或圖表點擊行為。

#### Scenario: 股票日內資料跨至下一交易日
- **WHEN** 可見資料由某日最後一根日內 candle 接續至下一日期第一根 candle
- **THEN** 系統 MUST 在兩根 candle 的 X 座標中點繪製 1.2 CSS px 亮黃色分隔線
- **AND** 分隔線 MUST 位於 pane background，不得穿過任一根 candle 的中心或遮住其 OHLCV

#### Scenario: 期貨夜盤跨越午夜
- **WHEN** FUT／OPT 日內 candles 的台灣顯示日期在連續夜盤資料中改變
- **THEN** 系統 MUST 在日期改變處顯示相同的 1.2 CSS px 亮黃色垂直分隔線
- **AND** 系統 MUST NOT 因畫線而改寫 candle 的交易日歸屬、timestamp 或價量

#### Scenario: 同日內有資料缺口
- **WHEN** 相鄰 candles 雖有時間缺口但台灣顯示日期相同
- **THEN** 系統 MUST NOT 將該缺口誤畫為跨日分隔線

#### Scenario: 主圖與副圖對齊
- **WHEN** 圖表具有一個以上技術副圖 pane
- **THEN** 每條可見跨日分隔線 MUST 在主圖與所有副圖使用相同 X 座標、亮黃色語意色及 1.2 CSS px 視覺線寬
- **AND** 新增、移除或重排副圖後 MUST 重新對齊，不得留下重複或殘留線條

#### Scenario: 平移縮放、歷史補載與主題切換
- **WHEN** 使用者平移、縮放或 resize，系統 prepend 歷史 candles，或 theme 改變
- **THEN** 系統 MUST 依目前 canonical candles 與 viewport 重新定位可見分隔線，並使用目前 theme 經對比驗證的亮黃色 day-boundary semantic color
- **AND** 色彩 MUST NOT 退回一般 grid color，舊 generation 的座標或 primitive MUST NOT 寫回新商品、新時框或已銷毀 chart

#### Scenario: 日週月不套用分鐘分日線
- **WHEN** 目前時框為 1D、週或月
- **THEN** 系統 MUST NOT 因每根 candle 的日期不同而在相鄰 K 棒之間增加本 capability 的分隔線
- **AND** 既有格線與時間軸行為 MUST 維持不變

### Requirement: 形成中 K 棒必須顯示最新價語意
系統 MUST 區分 completed 與可證明仍 forming 的最新 candle。選取 forming candle 時第四個價格欄位 MUST 標示「最新」並顯示該 candle 的 current close；選取 completed candle 時 MUST 標示「收」。系統 MUST NOT 只因 candle 位於陣列尾端就判定 forming。

#### Scenario: live quote 更新目前 K 棒
- **WHEN** 合法 live quote 在目前商品與時框 bucket 內更新最新 candle
- **THEN** 該 candle MUST 標示 forming，readout MUST 顯示「最新」及更新後的 close
- **AND** open、high、low 與 volume MUST 同步反映該 canonical candle 的目前值

#### Scenario: 新 K 棒使前一根收線
- **WHEN** 新 bucket 的合法 live quote 建立下一根 candle
- **THEN** 前一根 candle MUST 轉為 completed
- **AND** 游標回到前一根時第四個價格欄位 MUST 顯示「收」

#### Scenario: 區間結束但沒有下一筆 tick
- **WHEN** 目前日內 K 棒已到達時框區間終點且沒有新 bucket tick
- **THEN** bounded boundary timer MUST 將該 candle 轉為 completed
- **AND** readout MUST NOT 在已結束區間持續冒充「最新」

#### Scenario: 無法可靠判定 1D session 狀態
- **WHEN** 現有 contract metadata 無法可靠判定某 FUT／OPT 1D candle 的 session 是否仍在形成
- **THEN** 系統 MUST 保守顯示「收」
- **AND** 系統 MUST NOT 只因其為最新資料列就標示「最新」

### Requirement: K 棒價量必須固定在顯示數值區最上方
可見的 K 棒價量 readout MUST 固定排在主圖左上角顯示數值區第一列，所有 MA、BOLL、Pivot 與其他主圖 indicator legend MUST 位於其下方。固定置頂 MUST 是 render 規則，不得改寫其他 indicator instances 的持久化順序。

#### Scenario: 已有多個主圖指標後加入 readout
- **WHEN** 主圖已有任意順序的 MA、BOLL 或其他指標，使用者加入 K 棒價量
- **THEN** K 棒價量 MUST 立即顯示於第一列
- **AND** 其他指標 MUST 保持既有相對順序

#### Scenario: 修改一般指標排序
- **WHEN** 使用者上移、下移、複製或移除一般技術指標
- **THEN** 可見 K 棒價量 MUST 仍位於第一列
- **AND** readout MUST NOT 成為一般排序陣列中的可移動項目

### Requirement: 多圖讀值與高頻更新必須隔離
K 棒價量的啟用、隱藏、移除及時框設定 MUST 依 canonical instance store 同步，但 crosshair time、fallback candle、forming 狀態及可見讀值 MUST 保持在各自 `CandleChart`。crosshair、live quote、資料載入或商品／時框切換造成的更新 MUST 使用有界 latest-wins 排程及 generation guard，且不得重建主圖 series 或副圖 pane。

#### Scenario: 多張圖使用不同游標位置
- **WHEN** 同一畫面有兩張以上不同商品或時框的圖，且使用者在其中一張移動 crosshair
- **THEN** 只有該圖的 K 棒價量 MUST 改為對應 candle
- **AND** 其他圖 MUST 維持各自的讀值或最新 candle fallback

#### Scenario: 游標停在 forming candle 接收 live update
- **WHEN** crosshair 停在 forming candle 且新 live quote 更新該 candle
- **THEN** readout MUST 在一個有界節流週期內顯示新的 high、low、最新價及量
- **AND** 使用者 MUST NOT 需要再次移動滑鼠才看到更新

#### Scenario: 快速切換商品或時框
- **WHEN** 舊商品或時框仍有已排程 readout callback，使用者切換至新 generation
- **THEN** 舊 callback MUST 被取消或丟棄
- **AND** 新圖 MUST NOT 短暫顯示前一商品、時框或 candle 的時間與 OHLCV

### Requirement: 價格與成交量格式必須符合資料語意
readout 的價格 MUST 使用目前商品／K 線既有價格精度；volume MUST 使用非負整數與千分位，不得套用價格小數精度。欄位標籤及數值 MUST 使用 tabular numbers 並保持可辨識，完整時間區間 MUST 同時提供可存取名稱或 tooltip。

#### Scenario: 顯示價格與大量成交量
- **WHEN** candle 的 open=193.5、high=199、low=189.5、close=191、volume=39053，且價格精度為二位
- **THEN** readout MUST 顯示 `開 193.50`、`高 199.00`、`低 189.50`、`收 191.00` 與 `量 39,053`
- **AND** volume MUST NOT 顯示為 `39053.00`

#### Scenario: 無障礙與狹窄版面
- **WHEN** 圖表寬度不足以在單行容納完整時間區間與 OHLCV
- **THEN** UI MUST 保留全部欄位並採可測試的換行或溢位呈現
- **AND** 完整時間區間與欄位語意 MUST 可由鍵盤焦點、accessible name 或 tooltip 取得
- **AND** crosshair 高頻更新 MUST NOT 使用會逐筆打擾使用者的 assertive live region

### Requirement: 指標 readout 必須顯示逐項標籤與指定順序
主圖左上角與 K 棒價量共用的 indicator readout MUST 對 BOLL、均量與均線顯示每個數值的語意 prefix。BOLL MUST 依「上、中軌、下」順序顯示；均量與均線 MUST 依週期由小到大顯示，並以 `5MA`、`10MA` 等週期文字置於數值前。每組 prefix 與數值 MUST 使用該 output 的既有 series 顏色。此顯示規則 MUST NOT 改變 indicator 計算結果、output key、繪圖 series 建立順序、picker 完整名稱或持久化資料。

#### Scenario: 顯示 BOLL readout
- **WHEN** 使用者啟用 BOLL(20,2)，目前 candle 的 upper、mid、lower 數值分別為 952.9、937.5、922.2
- **THEN** readout MUST 依序顯示 `上 952.9`、`中軌 937.5`、`下 922.2`
- **AND** `上`、`中軌`、`下` MUST 分別和對應數值使用相同的 upper、mid、lower series 顏色
- **AND** row label MUST 保留目前參數化名稱 `BOLL(20,2)`

#### Scenario: 顯示均量與均線 readout
- **WHEN** 使用者同時啟用成交量均線與參考均線組
- **THEN** 成交量均線的 readout 名稱 MUST 顯示為「均量」，並以 `5MA`、`10MA`、`20MA` 等 prefix 顯示數值
- **AND** 參考均線組的 readout 名稱 MUST 顯示為「均線」，並以 `5MA`、`10MA`、`20MA`、`60MA`、`120MA` 等 prefix 顯示數值
- **AND** indicator picker MUST 仍顯示既有完整名稱，既有 instance type 與偏好資料 MUST 不變

#### Scenario: 指標數值缺值
- **WHEN** 某一指標週期尚未形成或沒有有限數值
- **THEN** 該週期 MUST 保留其標籤並顯示 `—`
- **AND** 其他週期的順序與標籤 MUST NOT 位移或遺失

#### Scenario: 窄版換行與可存取名稱
- **WHEN** 圖表寬度不足以在單行容納完整均線或均量 readout
- **THEN** UI MUST 只在 output 單位之間換行，單一 `prefix + value` MUST NOT 被拆開、裁切或覆蓋價格軸
- **AND** 每個可見 output 的 tooltip 或 accessible name MUST 同時包含 prefix 與目前值
- **AND** crosshair 高頻更新 MUST NOT 新增 assertive live region

### Requirement: 主交易畫面台股整股成交量必須以張為 canonical 呈現單位
主交易畫面對 Shioaji 整股 STK Kbars、Tick `volume` 與 `total_volume` MUST 以 `common_lot`（張）解讀並呈現，不得乘除 1,000。歷史、forming candle、成交量柱、均量、readout 與 Volume Profile MUST 使用同一 canonical volume；來源單位不可信或不適用時 MUST 標示不可用，不得猜測。

#### Scenario: 由 Shioaji 1 分 K 聚合日 K
- **WHEN** 同一台北日期的合法整股 STK Kbars 成交量依序為 1、2、3 張
- **THEN** 主交易畫面日 K、成交量柱與 readout MUST 顯示 6 張的 canonical volume
- **AND** 系統 MUST NOT 顯示 6,000、將張誤稱為股或讓衍生指標使用不同數值

#### Scenario: Bootstrap 後接續即時成交量
- **WHEN** 最新 Kbars bootstrap 已包含當日累計 100 張，下一筆合法 Tick 的 `total_volume` 為 103 張
- **THEN** forming candle MUST 只增加 3 張
- **AND** 相同 Tick 重送、sequence 未前進或舊 generation 晚到時 MUST NOT 再增加成交量

#### Scenario: 累計量倒退或跨 session
- **WHEN** 相同 session 的 `total_volume` 倒退，或舊台北日期 Tick 在新 session cursor 建立後抵達
- **THEN** 系統 MUST 拒絕該次 volume 增量並保留目前 canonical candle set
- **AND** 系統 MUST NOT 以 tick volume、零值或其他來源成交量猜補

### Requirement: 主交易畫面台股整股K棒必須顯示精確成交值
主交易畫面的台股整股STK K棒價量readout MUST 在「量」之後顯示「值」，並且只採用與目前canonical candle相同來源、時間bucket及generation的精確Shioaji成交值。歷史1分K MUST 使用`KBars.Amount`；5／15／60分與日K MUST 由bucket內所有可用來源K棒的成交值完整加總。系統 MUST NOT 使用close、open、high、low、average price或volume推算成交值。

#### Scenario: 游標查看歷史1分K
- **WHEN** crosshair命中一根台股整股STK歷史1分K，且同列`KBars.Amount`為合法精確成交值
- **THEN** readout MUST 在該candle的「量」之後顯示由該`Amount`換算的「值」
- **AND** 最新Tick、其他candle或其他時框 MUST NOT 改寫這個歷史讀值

#### Scenario: 聚合5分K成交值
- **WHEN** 同一5分bucket內五根canonical 1分K的`turnoverTwd`均合法
- **THEN** 5分K的「值」 MUST 等於五個精確成交值的總和
- **AND** 系統 MUST NOT 以5分K close乘五分量取代加總

#### Scenario: 聚合來源任一成交值缺漏
- **WHEN** bucket內任一來源K棒缺少、無效或超出安全數值範圍的成交值
- **THEN** 該bucket MUST 顯示`值 —`
- **AND** 合法OHLCV、成交量柱與技術指標 MUST 繼續使用既有資料，不得因成交值不可用而消失

### Requirement: 成交量與成交值必須使用確認的文字、順序及萬元格式
台股整股STK readout MUST 依序顯示`量 <張數>張　值 <萬元>萬`。可見標籤 MUST 使用「值」，tooltip與accessible name MUST 使用完整語意`成交值 <萬元>萬元`；兩者 MUST 使用相同數字精度，且不得另顯示換算前的元金額。

#### Scenario: 顯示一般大量成交值
- **WHEN** candle的canonical volume為910張，格式化成交值為9,355萬元
- **THEN** 可見readout MUST 顯示`量 910張`後接`值 9,355萬`
- **AND** tooltip或accessible name MUST 顯示`成交值 9,355萬元`

#### Scenario: 顯示小額、零值與不可用
- **WHEN** 精確成交值分別為未滿0.1萬元的正值、零或不可用
- **THEN** readout MUST 分別顯示`值 <0.1萬`、`值 0萬`或`值 —`
- **AND** 不可用狀態 MUST NOT 顯示`0萬`或任何估算值

#### Scenario: 窄版與字級放大
- **WHEN** 圖表寬度或使用者字級不足以在單行容納時間、OHLC、量與值
- **THEN** readout MUST 只在欄位邊界換行，`量 + 張數 + 張`及`值 + 數字 + 萬`各自不得拆開、裁切、重疊或覆蓋價格軸
- **AND** 鍵盤焦點、tooltip及accessible name MUST 仍可取得完整成交值語意

### Requirement: 形成中成交值必須防止bootstrap重複與事件重放
形成中台股整股STK candle的成交值 MUST 只接受與目前商品、simulation generation、台北交易日、source time及遞增sequence一致的Tick `amount`／`total_amount`。Bootstrap後 MUST 只加入尚未包含的精確成交值增量；重送、倒退、跨session、舊generation或矛盾欄位 MUST NOT 重複增加成交值。

#### Scenario: Kbars bootstrap後收到合法累計成交值
- **WHEN** 最新Kbars已包含當日累計成交值100,000,000元，下一筆已接受Tick的`total_amount`為100,500,000元
- **THEN** forming candle MUST 只增加500,000元
- **AND** readout MUST 在既有有界更新週期內顯示更新後的萬元值

#### Scenario: 相同Tick重送或累計值倒退
- **WHEN** 相同sequence重送、source time倒退或`total_amount`小於已接受累計值
- **THEN** 成交值 MUST 不增加且該不可信chain MUST fail unavailable
- **AND** 系統 MUST NOT 改用close乘volume補算，也不得把舊值冒充目前值

#### Scenario: 成交值缺漏但價格與量合法
- **WHEN** 已接受Tick具有合法價格與成交量增量，但`amount／total_amount`缺漏或不可驗證
- **THEN** forming candle的OHLCV MUST 依既有契約更新，成交值 MUST 顯示`—`
- **AND** 成交值只有在下一次可信Kbars bootstrap或新session建立後才可恢復available

### Requirement: 成交值能力必須限定於主交易畫面文字readout
本capability MUST NOT 建立成交值價格軸、series、autoscale、圖例、設定開關或副圖，也 MUST NOT 修改MultiView、gateway／Worker payload、cache fingerprint、Volume Profile、技術指標、交易或智慧單資料流。

#### Scenario: 啟用K棒價量readout
- **WHEN** 使用者在主交易畫面顯示具有精確成交值的K棒價量readout
- **THEN** 系統 MUST 只新增「值」文字欄位
- **AND** lightweight-charts series數量、左右價格軸、autoscale及API請求數 MUST 維持原契約

#### Scenario: 開啟MultiView
- **WHEN** 使用者開啟或操作MultiView圖表
- **THEN** MultiView的「值」文字readout MUST 依`multiview-kbar-turnover-readout` capability處理，且仍不得建立成交值軸或series
- **AND** 本requirement只限制主交易畫面的資料流，MUST NOT 將主畫面的payload、cache、generation或forming cursor接入MultiView
