## ADDED Requirements

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

方式 B 的作用中籌碼 panes MUST 可透過 pane header 的專用拖曳把手調整上下順序，並以穩定 pane ID 將順序依 `tabId + canonical symbol` 持久化；方式 A MUST NOT 顯示或接受排序操作。系統 MUST 提供右鍵「上移」與「下移」作為鍵盤及非拖曳替代方式，且不得新增常駐排序按鈕。

#### Scenario: 拖曳中間 pane 到最上方
- **WHEN** 使用者在方式 B 從專用拖曳把手將一個中間 pane 拖到第一個 pane 之前並放開
- **THEN** DOM、共用十字線 plot 順序與保存順序 MUST 一致更新
- **AND** 系統 MUST 只為該次成功拖曳寫入一次偏好，不得重新請求該 pane 資料

#### Scenario: 從右鍵功能表移動 pane
- **WHEN** 使用者以滑鼠右鍵、`ContextMenu` 鍵或 `Shift+F10` 開啟 pane 功能表並選擇「上移」或「下移」
- **THEN** pane MUST 移動一個有效位置並保存與拖曳相同的順序
- **AND** 已在最上方的「上移」或已在最下方的「下移」 MUST 顯示 disabled

#### Scenario: 取消進行中的拖曳
- **WHEN** 使用者按下 `Escape`、發生 `pointercancel`、視窗失焦或系統偵測滑鼠按鍵已釋放而沒有合法 drop
- **THEN** 系統 MUST 回復拖曳開始前的順序並清除插入位置及拖曳樣式
- **AND** MUST NOT 寫入取消後的順序

#### Scenario: 切換商品後恢復各自順序
- **WHEN** 使用者在一個商品完成自訂排序後切換至另一個商品，再返回原商品
- **THEN** 每個商品 MUST 依自己的 `tabId + canonical symbol` 恢復已選 panes 及自訂順序
- **AND** 舊版沒有排序欄位的偏好 MUST 以有效既有選取順序起始並補入新增 pane ID，不得遺失勾選狀態

## MODIFIED Requirements

### Requirement: 籌碼副圖 A／B 顯示模式

系統 MUST 提供使用者可見的「單一副圖」與「多層副圖」兩種顯示模式，控制項文案 MUST NOT 顯示 A／B 前綴；內部 MAY 沿用方式 A／B 作為相容識別。方式 A MUST 讓每個 panel 只有一個共用副圖槽位；技術副圖與單一籌碼 pane MUST 互相替換，不得在技術副圖下方新增籌碼列。方式 B MUST 保留有實際選取項目的技術副圖，並以複選語意讓每個已勾選籌碼項目建立一個具獨立 Y 軸的 pane，依該頁籤與商品保存的自訂順序上下排列；尚未有自訂順序時 MUST 使用 registry 預設順序。

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
- **WHEN** 使用者查看全域副圖模式下拉選單
- **THEN** 選項 MUST 顯示「單一副圖」與「多層副圖」
- **AND** MUST NOT 顯示「A 單一副圖」或「B 多層副圖」

### Requirement: 法人買賣超副圖

系統 MUST 提供「外資買賣超＋持股」、投信買賣超、自營商買賣超及三大法人合計四個可獨立選取的法人 pane；選單 MUST 保留這些完整名稱，pane header MUST 分別使用「外資」、「投信」、「自營商」與「三大法人」短標題。「外資買賣超＋持股」MUST 同時顯示外資淨買賣超柱與外資及陸資持股比折線，並以獨立尺度呈現張數及百分比；其餘買賣超 pane MUST 依交易日顯示相應淨買賣超、可辨識的零軸與正負方向。自營商讀值 MUST 分辨自行買賣與避險，三大法人讀值 MUST 分列三個組成項。法人 pane header MUST NOT 顯示資料來源文字。

#### Scenario: 顯示合併外資 pane
- **WHEN** 方式 B 選取「外資買賣超＋持股」，且同一日期具有外資買賣超及外資持股資料
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
- **THEN** 使用者 MUST 可建立選單名稱為「三大法人合計」、pane header 為「三大法人」的 pane
- **AND** header 讀值 MUST 同時顯示合計張數與三個組成分項

#### Scenario: 三大法人合計不完整
- **WHEN** 任一組成分項缺漏或與來源總計驗證不一致
- **THEN** 三大法人 series MUST 在該日保留 gap 或標示部分資料
- **AND** MUST NOT 顯示以零補足的錯誤合計

### Requirement: 籌碼副圖標題列逐日讀值

同一 panel 的每個作用中籌碼 pane MUST 依共用游標日期在 pane header 顯示自己的 inline readout。readout MUST 顯示 `sessionDate`、主要 series 值、必要組成欄位與資料狀態，但 MUST NOT 顯示資料來源文字；游標未作用時 MUST 顯示最新可用讀值。當一列寬度不足時，完整 readout segments MUST 自動換到下一列並使 header／pane 自然增高，MUST NOT 以裁切、ellipsis、縮短欄位或水平捲動隱藏任何項目。籌碼 pane MUST NOT 建立浮動 tooltip，亦 MUST NOT 在 chart 內容或價格軸顯示 series title／last-value 標籤。

#### Scenario: 游標移到有完整逐日資料的交易日
- **WHEN** 使用者將游標移到具有法人、融資券或 TDCC 資料的日期
- **THEN** 每個作用中籌碼 pane 的 header MUST 顯示同一個游標日期的自身數值
- **AND** MUST NOT 顯示資料來源、資料序列最後一日的值或浮動框

#### Scenario: 游標離開 pane
- **WHEN** 游標離開 panel 或共用游標被清除
- **THEN** 每個籌碼 pane 的 header MUST 恢復最新可用日期與讀值
- **AND** MUST NOT 保留上一個游標日期或上一個商品的讀值

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

#### Scenario: TDCC 游標日期不是發布日
- **WHEN** 游標日期沒有對應 TDCC 實際週資料
- **THEN** header MUST 顯示游標日期與「當日無資料」
- **AND** MAY 顯示最近一筆較早的真實資料日期及比例作為參考，但 MUST 清楚標為最近一筆，且不得將其視為游標當日值

#### Scenario: 標題列寬度不足
- **WHEN** panel 寬度不足以在一列容納標題、完整 readout、狀態與控制項
- **THEN** readout segment MUST 依原順序完整換到下一列，header 與 pane MUST 依所需列數自然增高
- **AND** 所有日期、數值、組成欄位與狀態 MUST 仍可見，但資料來源文字 MUST NOT 出現
- **AND** MUST NOT 裁切、顯示 ellipsis、縮短次要文字、重疊控制項、遮住 chart 或造成頁面水平捲動

### Requirement: 多層副圖高度與捲動

方式 B MUST 為主圖、每個作用中的籌碼 pane，以及至少選取一項指標時的技術副圖保留可讀高度，並讓 panel 與頁面高度依實際可見 pane 數量及 header 換行列數自然增減；當內容超過 viewport 時，系統 MUST 以 `html/body` 的瀏覽器頁面作為唯一垂直捲動容器，`.subchart-slot`、`.chip-pane-region`、`.chip-pane-stack` 與 `.chart-panel` MUST NOT 形成可獨立垂直捲動的區域。桌面寬度的方式 B MUST 採緊湊副圖版型：有作用的技術副圖總高 MUST 介於 96–120 CSS px；籌碼 pane 在 header 單列時總高 MUST 介於 88–104 CSS px，header 換行時 MUST 只按實際新增列數自然增加且 chart 區至少保留 64 CSS px。沒有選取任何技術指標時 MUST 完全移除技術副圖列及其最小高度。籌碼 pane MUST NOT 建立浮動 tooltip，且 inline readout MUST 與標題及控制項共同使用緊湊 header，不得遮住 chart、裁切資訊或造成水平捲動。方式 A MUST 只顯示至多一個作用中的副圖槽位且不得出現多層 stack 或因籌碼 pane 增加額外列；4／6／8 圖與聚焦模式 MUST 維持方式 A 的固定視窗版型。方式 B MUST 依滑鼠指標命中區域分流 wheel：主圖、實際可見的技術副圖與籌碼副圖的圖表區 MUST 縮放同一 panel 的時間資料區間，圖表外區域與瀏覽器原生捲軸 MUST 捲動 document；觸控垂直滑動 MUST 捲動 document，水平拖曳與 pinch MUST 操作圖表。

#### Scenario: 方式 A 顯示籌碼 pane
- **WHEN** 使用者在方式 A 選擇任一籌碼項目
- **THEN** 籌碼 pane MUST 使用原技術副圖槽位的高度與位置
- **AND** panel 不得新增副圖列、顯示多層 stack 或啟用方式 B 的長頁面版型
- **AND** 讀值 MUST 在 pane header 內安全換行，不得建立浮動 tooltip 或額外固定詳細列

#### Scenario: 方式 B 勾選多個籌碼項目
- **WHEN** 使用者在 1／2／3 圖的方式 B 勾選五個以上籌碼項目且總高度超過 viewport
- **THEN** 主圖、實際有作用的技術副圖與每個 pane MUST 依緊湊高度及目前保存順序全部向下展開
- **AND** document 高度 MUST 隨內容與 header 換行增加並由瀏覽器頁面捲軸查看所有 pane
- **AND** panel、副圖槽位與籌碼區 MUST NOT 出現獨立垂直捲軸

#### Scenario: 標題列顯示逐日讀值
- **WHEN** 籌碼 pane 已取得資料且游標未作用
- **THEN** header MUST 顯示最新可用日期與完整讀值，空間不足時依原順序換到下一列
- **AND** 游標作用時 MUST 原位改為游標日期讀值，離開後恢復最新值
- **AND** 不得以第二個固定明細區、浮動 tooltip 或 chart 右側系列標籤重複顯示

#### Scenario: 圖表區使用滑鼠滾輪縮放
- **WHEN** 方式 B 的滑鼠指標位於主圖、實際可見的技術副圖或任一籌碼 pane 的實際圖表區，且使用者未按住強制捲頁 modifier 而轉動中央滾輪
- **THEN** 系統 MUST 縮放目前 panel 的 visible logical range
- **AND** 同一 panel 的主圖與所有可見副圖 MUST 同步到相同時間範圍
- **AND** 本次手勢不得改變 `window.scrollY` 或其他 panel 的時間範圍

#### Scenario: 圖表外使用滑鼠滾輪捲頁
- **WHEN** 方式 B 的滑鼠指標位於圖表標題列、panel 工具列、控制區、頁面空白或瀏覽器原生捲軸並轉動中央滾輪
- **THEN** 瀏覽器 document MUST 依手勢方向垂直捲動
- **AND** 任一 panel 的 visible logical range MUST NOT 因該手勢改變
- **AND** 頁面 MUST NOT 被單一 chart、pane 或內層捲動區困住

#### Scenario: 從圖表區強制捲動頁面
- **WHEN** 方式 B 的滑鼠指標位於任一圖表區並以 `Option/Alt + wheel` 操作
- **THEN** 系統 MUST 捲動瀏覽器 document，且 MUST NOT 縮放或平移任何圖表
- **AND** 系統不得增加永久提示列、工具列按鈕或新的互動模式

#### Scenario: 從任一圖表按住左鍵拖曳
- **WHEN** 使用者在方式 A 或方式 B 的主圖、技術副圖或任一籌碼 pane 圖表區按住滑鼠左鍵水平拖曳
- **THEN** 系統 MUST 平移目前 panel 的時間資料範圍
- **AND** 同一 panel 的所有可見圖表 MUST 同步，其他 panel 與 document 垂直位置 MUST 保持不變
- **AND** 只有 pane header 的專用排序把手 MAY 啟動 pane 重排

#### Scenario: 多層副圖使用觸控手勢
- **WHEN** 使用者在方式 B 的圖表區使用單指垂直滑動、水平拖曳或雙指 pinch
- **THEN** 單指垂直滑動 MUST 捲動瀏覽器 document
- **AND** 水平拖曳 MUST 平移目前 panel 的時間範圍
- **AND** pinch MUST 縮放目前 panel 並同步同一 panel 的所有可見圖表

#### Scenario: 2／3 圖與窄螢幕使用共同頁面捲軸
- **WHEN** 方式 B 在寬螢幕以 2／3 個 panel 並排，或在既定 breakpoint 以下改為單欄
- **THEN** 所有 panel MUST 使用同一個瀏覽器頁面垂直捲軸
- **AND** 每個 panel MUST 依自己的作用 pane 與 header 換行自然增高，不得建立各自的垂直捲動容器
- **AND** 頁面 MUST NOT 因 panel、價格軸、readout 或副圖內容產生非預期水平捲軸

#### Scenario: 取消中間的 pane
- **WHEN** 使用者從方式 B 多層 stack 取消一個非首尾 pane
- **THEN** 其後 pane MUST 依目前保存順序向上補位，panel 與 document 高度 MUST 自然縮短
- **AND** 不得改變其他 pane 的資料、尺度、勾選狀態、visible range、header 讀值或 crosshair 同步

#### Scenario: 縮放與捲頁後維持共用十字線對齊
- **WHEN** 使用者在方式 B 縮放圖表或捲動 document，且 layout 已穩定
- **THEN** 同一 panel 的主圖與所有可見副圖 MUST 保持相同日期範圍
- **AND** 相同日期於各圖表的絕對螢幕 X 座標差 MUST 小於或等於 1 CSS px
- **AND** 共用垂直線與 header 逐日讀值 MUST 繼續對應相同或最近的交易日

#### Scenario: 離開方式 B
- **WHEN** 使用者從方式 B 切到方式 A、4／6／8 圖或聚焦模式
- **THEN** 系統 MUST 移除方式 B 的長頁面與緊湊 stack 版型，恢復固定視窗與至多一個作用中的副圖槽位
- **AND** MUST 清理已隱藏 pane 的 listener／observer／readout／wheel routing 狀態，並正確 resize 保留的主圖與副圖
- **AND** 返回方式 B 後 MUST 恢復原本技術副圖狀態、完整籌碼勾選組合與自訂順序

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
