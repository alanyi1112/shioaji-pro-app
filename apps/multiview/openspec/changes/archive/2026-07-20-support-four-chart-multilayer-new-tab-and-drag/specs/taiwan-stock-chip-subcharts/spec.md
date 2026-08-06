## MODIFIED Requirements

### Requirement: 圖表數量與副圖模式政策

系統 MUST 支援 1、2、3、4、6、8 圖。1、2、3、4 圖 MUST 可使用 A 或 B 且首次預設 B；6、8 圖 MUST 固定使用 A。方式控制 MUST 是全域設定，所有目前 panel 採用相同 effective mode；使用 A 的任何圖數都 MUST 套用同一個共用副圖槽位規則。工具列 MUST NOT 以常駐說明列顯示圖數限制文案。

#### Scenario: 首次使用 1、2、3 或 4 圖
- **WHEN** 裝置尚未保存籌碼副圖偏好且使用者選擇 1、2、3 或 4 圖
- **THEN** 系統 MUST 啟用方式 B
- **AND** MUST 預設勾選全部十個籌碼副圖
- **AND** 模式下拉選單 MUST 可操作

#### Scenario: 6、8 圖固定方式 A
- **WHEN** 使用者選擇 6 或 8 圖
- **THEN** 系統 MUST 套用方式 A
- **AND** 模式下拉選單 MUST 顯示灰色 disabled 的「單一副圖」、設定原生 disabled 與 `aria-disabled="true"`，且不得接受滑鼠或鍵盤切換
- **AND** 每個 panel MUST 只保留一個共用副圖槽位
- **AND** 工具列 MUST NOT 新增另一列說明文字

#### Scenario: 從 B 切到 6、8 圖後返回
- **WHEN** 使用者從 1、2、3 或 4 圖的方式 B 切換至 6 或 8 圖，再返回 1、2、3 或 4 圖
- **THEN** 6、8 圖期間 MUST 只顯示方式 A 最後作用的技術副圖或單一籌碼 pane
- **AND** 返回後 MUST 恢復原本方式 B、技術副圖狀態與完整籌碼勾選組合
- **AND** 模式下拉選單 MUST 恢復可操作

#### Scenario: 顯示 3 圖方式 B 版面
- **WHEN** 使用者在寬螢幕選擇 3 圖方式 B
- **THEN** 系統 MUST 以三欄一列呈現三個等寬 panel
- **AND** 低於多圖可讀性 breakpoint 時 MUST 改為單欄，不得使用不對稱的二加一版面

#### Scenario: 顯示 4 圖方式 A 版面
- **WHEN** 使用者在寬螢幕選擇 4 圖方式 A
- **THEN** 系統 MUST 維持既有 2×2 panel 版面與固定視窗配置
- **AND** 每個 panel MUST 只顯示至多一個共用副圖槽位

#### Scenario: 顯示 4 圖方式 B 版面
- **WHEN** 使用者在寬螢幕選擇 4 圖方式 B
- **THEN** 系統 MUST 以一列四欄呈現四個等寬 panel，不得改為 2×2
- **AND** 每個 panel MUST 依可見副圖內容自然增高，由整個瀏覽器 document 垂直捲動
- **AND** 低於多圖可讀性 breakpoint 時 MUST 改為單欄

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

方式 B MUST 為主圖、每個作用中的籌碼 pane，以及至少選取一項指標時的技術副圖保留可讀高度，並讓 panel 與頁面高度依實際可見 pane 數量及 header 換行列數自然增減；當內容超過 viewport 時，系統 MUST 以 `html/body` 的瀏覽器頁面作為唯一垂直捲動容器，`.subchart-slot`、`.chip-pane-region`、`.chip-pane-stack` 與 `.chart-panel` MUST NOT 形成可獨立垂直捲動的區域。桌面寬度的方式 B MUST 採緊湊副圖版型：有作用的技術副圖總高 MUST 介於 96–120 CSS px；籌碼 pane 在 header 單列時總高 MUST 介於 88–104 CSS px，header 換行時 MUST 只按實際新增列數自然增加且 chart 區至少保留 64 CSS px。沒有選取任何技術指標時 MUST 完全移除技術副圖列及其最小高度。籌碼 pane MUST NOT 建立浮動 tooltip，且 inline readout MUST 與標題及控制項共同使用緊湊 header，不得遮住 chart、裁切資訊或造成水平捲動。方式 A MUST 只顯示至多一個作用中的副圖槽位且不得出現多層 stack 或因籌碼 pane 增加額外列；6／8 圖 MUST 維持方式 A 的固定視窗版型。方式 B MUST 依滑鼠指標命中區域分流 wheel：主圖、實際可見的技術副圖與籌碼副圖的圖表區 MUST 縮放同一 panel 的時間資料區間，圖表外區域與瀏覽器原生捲軸 MUST 捲動 document；觸控垂直滑動 MUST 捲動 document，水平拖曳與 pinch MUST 操作圖表。

#### Scenario: 方式 A 顯示籌碼 pane
- **WHEN** 使用者在方式 A 選擇任一籌碼項目
- **THEN** 籌碼 pane MUST 使用原技術副圖槽位的高度與位置
- **AND** panel 不得新增副圖列、顯示多層 stack 或啟用方式 B 的長頁面版型
- **AND** 讀值 MUST 在 pane header 內安全換行，不得建立浮動 tooltip 或額外固定詳細列

#### Scenario: 方式 B 勾選多個籌碼項目
- **WHEN** 使用者在 1／2／3／4 圖的方式 B 勾選五個以上籌碼項目且總高度超過 viewport
- **THEN** 主圖、實際有作用的技術副圖與每個 pane MUST 依緊湊高度及目前保存順序全部向下展開
- **AND** document 高度 MUST 隨內容與 header 換行增加並由瀏覽器頁面捲軸查看所有 pane
- **AND** panel、副圖槽位與籌碼區 MUST NOT 出現獨立垂直捲軸

#### Scenario: 4 圖方式 B 使用共同頁面捲軸
- **WHEN** 桌面寬度的 4 圖方式 B 在一列四欄顯示，且任一 panel 的多層副圖超過 viewport
- **THEN** 四個 panel MUST 保持同列等寬，並各自依可見 pane 與 header 換行自然增高
- **AND** 頁面 MUST 只使用瀏覽器 document 的垂直捲軸，不得把較長 panel 壓縮成內層捲動區
- **AND** panel、價格軸、readout、工具列或副圖內容 MUST NOT 產生非預期水平捲軸或裁切必要控制項

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
- **AND** 只有群組 header 的允許拖曳區 MAY 啟動群組重排

#### Scenario: 多層副圖使用觸控手勢
- **WHEN** 使用者在方式 B 的圖表區使用單指垂直滑動、水平拖曳或雙指 pinch
- **THEN** 單指垂直滑動 MUST 捲動瀏覽器 document
- **AND** 水平拖曳 MUST 平移目前 panel 的時間範圍
- **AND** pinch MUST 縮放目前 panel 並同步同一 panel 的所有可見圖表

#### Scenario: 2／3／4 圖與窄螢幕使用共同頁面捲軸
- **WHEN** 方式 B 在寬螢幕以 2／3／4 個 panel 並排，或在既定 breakpoint 以下改為單欄
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
- **WHEN** 使用者從方式 B 切到方式 A、6 圖或 8 圖
- **THEN** 系統 MUST 移除方式 B 的長頁面與緊湊 stack 版型，恢復固定視窗與至多一個作用中的副圖槽位
- **AND** MUST 清理已隱藏 pane 的 listener／observer／readout／wheel routing 狀態，並正確 resize 保留的主圖與副圖
- **AND** 返回支援方式 B 的圖數後 MUST 恢復原本技術副圖狀態、完整籌碼勾選組合與自訂順序

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

系統 MUST 在方式 B 的「籌碼資料」選單把十個籌碼副圖整理為三個具有大項目與子項目的資料群組：「法人」包含外資買賣超＋持股、投信買賣超、自營商買賣超、三大法人合計；「融資券」包含融資、融券、借券、券資比；「大戶持股」包含大戶持股與散戶持股。大項目 MUST 依子項目呈現 checked、unchecked 或 indeterminate，子項目 MUST 可獨立勾選或取消。

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
- **THEN** 尚無 `modeBSelectedPaneIds` 時系統 MUST 依 registry 順序預設勾選全部十個籌碼副圖，再由子項目推導三個群組皆為 checked
- **AND** 已有 `modeBSelectedPaneIds` 時 MUST 原樣保留其部分選取或空陣列，不得因升級自動開啟原本未選的籌碼副圖
