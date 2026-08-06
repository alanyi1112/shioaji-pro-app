## MODIFIED Requirements

### Requirement: 多層副圖高度與捲動

方式 B MUST 為主圖、技術副圖及每個籌碼 pane 保留可讀高度，並讓 panel 與頁面高度依作用中的 pane 數量自然增減；當內容超過 viewport 時，系統 MUST 以 `html/body` 的瀏覽器頁面作為唯一垂直捲動容器，`.subchart-slot`、`.chip-pane-region`、`.chip-pane-stack` 與 `.chart-panel` MUST NOT 形成可獨立垂直捲動的區域。桌面寬度的方式 B MUST 採緊湊副圖版型：技術副圖總高 MUST 介於 96–120 CSS px，每個籌碼 pane 總高 MUST 介於 88–104 CSS px；籌碼 pane MUST NOT 建立浮動 tooltip，且標題列 inline readout MUST 與標題及控制項共同使用緊湊 header，不得遮住 chart 或造成水平捲動。窄螢幕可因控制項換行放寬高度，但 MUST 避免無限制等比例壓縮。方式 A MUST 只顯示單一副圖槽位且不得出現多層 stack 或因籌碼 pane 增加額外高度；4／6／8 圖與聚焦模式 MUST 維持方式 A 的固定視窗版型。方式 B MUST 依滑鼠指標命中區域分流 wheel：主圖、技術副圖與籌碼副圖的圖表區 MUST 縮放同一 panel 的時間資料區間，圖表外區域與瀏覽器原生捲軸 MUST 捲動 document；觸控垂直滑動 MUST 捲動 document，水平拖曳與 pinch MUST 操作圖表。

#### Scenario: 方式 A 顯示籌碼 pane
- **WHEN** 使用者在方式 A 選擇任一籌碼項目
- **THEN** 籌碼 pane MUST 使用原技術副圖槽位的高度與位置
- **AND** panel 不得新增副圖列、顯示多層 stack 或啟用方式 B 的長頁面版型
- **AND** 讀值 MUST 顯示在 pane 標題同一列，不得建立浮動 tooltip 或額外固定詳細列

#### Scenario: 方式 B 勾選多個籌碼項目
- **WHEN** 使用者在 1／2／3 圖的方式 B 勾選五個以上籌碼項目且總高度超過 viewport
- **THEN** 主圖、技術副圖與每個 pane MUST 依緊湊高度及固定順序全部向下展開
- **AND** document 高度 MUST 隨內容增加並由瀏覽器頁面捲軸查看所有 pane
- **AND** panel、副圖槽位與籌碼區 MUST NOT 出現獨立垂直捲軸

#### Scenario: 標題列顯示逐日讀值
- **WHEN** 籌碼 pane 已取得資料且游標未作用
- **THEN** 標題列 MUST 在名稱同一列顯示最新可用日期與讀值
- **AND** 游標作用時 MUST 原位改為游標日期讀值，離開後恢復最新值
- **AND** 不得以第二列固定明細、浮動 tooltip 或 chart 右側系列標籤重複顯示

#### Scenario: 圖表區使用滑鼠滾輪縮放
- **WHEN** 方式 B 的滑鼠指標位於主圖、技術副圖或任一籌碼 pane 的實際圖表區，且使用者未按住強制捲頁 modifier 而轉動中央滾輪
- **THEN** 系統 MUST 縮放目前 panel 的 visible logical range
- **AND** 同一 panel 的主圖、目前可見技術副圖與所有可見籌碼 pane MUST 同步到相同時間範圍
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
- **WHEN** 使用者在方式 A 或方式 B 的主圖、技術副圖或任一籌碼 pane 按住滑鼠左鍵水平拖曳
- **THEN** 系統 MUST 平移目前 panel 的時間資料範圍
- **AND** 同一 panel 的所有可見圖表 MUST 同步，其他 panel 與 document 垂直位置 MUST 保持不變

#### Scenario: 多層副圖使用觸控手勢
- **WHEN** 使用者在方式 B 的圖表區使用單指垂直滑動、水平拖曳或雙指 pinch
- **THEN** 單指垂直滑動 MUST 捲動瀏覽器 document
- **AND** 水平拖曳 MUST 平移目前 panel 的時間範圍
- **AND** pinch MUST 縮放目前 panel 並同步同一 panel 的所有可見圖表

#### Scenario: 2／3 圖與窄螢幕使用共同頁面捲軸
- **WHEN** 方式 B 在寬螢幕以 2／3 個 panel 並排，或在既定 breakpoint 以下改為單欄
- **THEN** 所有 panel MUST 使用同一個瀏覽器頁面垂直捲軸
- **AND** 每個 panel MUST 依自己的作用 pane 自然增高，不得建立各自的垂直捲動容器
- **AND** 頁面 MUST NOT 因 panel、價格軸、readout 或副圖內容產生非預期水平捲軸

#### Scenario: 取消中間的 pane
- **WHEN** 使用者從方式 B 多層 stack 取消一個非首尾 pane
- **THEN** 其後 pane MUST 依固定順序向上補位，panel 與 document 高度 MUST 自然縮短
- **AND** 不得改變其他 pane 的資料、尺度、勾選狀態、visible range、標題列讀值或 crosshair 同步

#### Scenario: 縮放與捲頁後維持共用十字線對齊
- **WHEN** 使用者在方式 B 縮放圖表或捲動 document，且 layout 已穩定
- **THEN** 同一 panel 的主圖、目前可見技術副圖與所有可見籌碼 pane MUST 保持相同日期範圍
- **AND** 相同日期於各圖表的絕對螢幕 X 座標差 MUST 小於或等於 1 CSS px
- **AND** 共用垂直線與標題列逐日讀值 MUST 繼續對應相同或最近的交易日

#### Scenario: 離開方式 B
- **WHEN** 使用者從方式 B 切到方式 A、4／6／8 圖或聚焦模式
- **THEN** 系統 MUST 移除方式 B 的長頁面與緊湊 stack 版型，恢復固定視窗與單一副圖槽位
- **AND** MUST 清理已隱藏 pane 的 listener／observer／readout／wheel routing 狀態，並正確 resize 保留的主圖與副圖
- **AND** 返回方式 B 後 MUST 恢復原本技術副圖狀態與完整籌碼勾選組合

## ADDED Requirements

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

系統 MUST 在籌碼 pane 正常可顯示資料時省略「可用」狀態文字，但 MUST 保留部分資料、資料過期、歷史不足、背景回補及來源不可用等有判斷價值的狀態。籌碼 pane 標題列 MUST NOT 顯示常駐「移除」按鈕；圖表區的右鍵功能表 MUST 提供「移除副圖」，並 MUST 在 pane 銷毀時清除功能表與 listener。持股比例、持股變化、週變化與對應座標刻度 MUST 使用 `%`，不得顯示「百分比」、「百分點」或「個百分點」。

#### Scenario: 正常資料不顯示可用狀態
- **WHEN** 籌碼 dataset 狀態為 available 且沒有其他回補或歷史警告
- **THEN** pane 標題列 MUST NOT 顯示「可用」
- **AND** 日期、讀值及資料來源 MUST 繼續正常顯示

#### Scenario: 以右鍵功能表移除籌碼副圖
- **WHEN** 使用者在籌碼 pane 圖表區按滑鼠右鍵，或以 `ContextMenu` 鍵／`Shift+F10` 開啟功能表後選擇「移除副圖」
- **THEN** 方式 B MUST 只移除該 pane，其他 pane MUST 依固定順序補位
- **AND** 方式 A MUST 恢復技術副圖槽位
- **AND** 標題列 MUST NOT 另行顯示常駐「移除」按鈕

#### Scenario: 顯示持股變化與週變化
- **WHEN** 持股變化或 TDCC 週變化具有可比較的正負數值
- **THEN** 讀值與座標刻度 MUST 以帶正負號的 `%` 顯示
- **AND** 增加值 MUST 維持紅色、減少值 MUST 維持綠色
- **AND** MUST NOT 顯示「百分比」、「百分點」或「個百分點」

#### Scenario: 移除 pane 後清理功能表
- **WHEN** pane 因取消勾選、模式切換、panel 重建或商品切換而銷毀
- **THEN** 系統 MUST 移除該 pane 的 context menu DOM、document listener 與 window listener
- **AND** 後續右鍵操作 MUST NOT 出現重複或屬於舊 pane 的功能表
