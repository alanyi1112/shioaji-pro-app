## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: 籌碼副圖標題列逐日讀值

同一 panel 的每個作用中籌碼 pane MUST 依共用游標日期在 pane header 顯示自己的 inline readout。readout MUST 顯示 `sessionDate`、主要 series 值、必要組成欄位、資料狀態與來源，並以間距或分隔符避免文字擠在一起；游標未作用時 MUST 顯示最新可用讀值。當一列寬度不足時，完整 readout segments MUST 自動換到下一列並使 header／pane 自然增高，MUST NOT 以裁切、ellipsis、縮短欄位或水平捲動隱藏任何項目。籌碼 pane MUST NOT 建立浮動 tooltip，亦 MUST NOT 在 chart 內容或價格軸顯示 series title／last-value 標籤。

#### Scenario: 游標移到有完整逐日資料的交易日
- **WHEN** 使用者將游標移到具有法人、融資券或 TDCC 資料的日期
- **THEN** 每個作用中籌碼 pane 的 header MUST 顯示同一個游標日期的自身數值
- **AND** MUST NOT 顯示資料序列最後一日的值或浮動框

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
- **AND** 所有日期、數值、組成欄位、狀態與來源 MUST 仍可見
- **AND** MUST NOT 裁切、顯示 ellipsis、縮短次要文字、重疊控制項、遮住 chart 或造成頁面水平捲動

### Requirement: 多層副圖高度與捲動

方式 B MUST 為主圖、技術副圖及每個籌碼 pane 保留可讀高度，並讓 panel 與頁面高度依作用中的 pane 數量及 header 實際換行列數自然增減；當內容超過 viewport 時，系統 MUST 以 `html/body` 的瀏覽器頁面作為唯一垂直捲動容器，`.subchart-slot`、`.chip-pane-region`、`.chip-pane-stack` 與 `.chart-panel` MUST NOT 形成可獨立垂直捲動的區域。桌面寬度的方式 B MUST 採緊湊副圖版型：技術副圖總高 MUST 介於 96–120 CSS px；籌碼 pane 在 header 單列時總高 MUST 介於 88–104 CSS px，header 換行時 MUST 只按實際新增列數自然增加且 chart 區至少保留 64 CSS px。籌碼 pane MUST NOT 建立浮動 tooltip，且 inline readout MUST 與標題及控制項共同使用緊湊 header，不得遮住 chart、裁切資訊或造成水平捲動。方式 A MUST 只顯示單一副圖槽位且不得出現多層 stack 或因籌碼 pane 增加額外列；4／6／8 圖與聚焦模式 MUST 維持方式 A 的固定視窗版型。方式 B MUST 依滑鼠指標命中區域分流 wheel：主圖、技術副圖與籌碼副圖的圖表區 MUST 縮放同一 panel 的時間資料區間，圖表外區域與瀏覽器原生捲軸 MUST 捲動 document；觸控垂直滑動 MUST 捲動 document，水平拖曳與 pinch MUST 操作圖表。

#### Scenario: 方式 A 顯示籌碼 pane
- **WHEN** 使用者在方式 A 選擇任一籌碼項目
- **THEN** 籌碼 pane MUST 使用原技術副圖槽位的高度與位置
- **AND** panel 不得新增副圖列、顯示多層 stack 或啟用方式 B 的長頁面版型
- **AND** 讀值 MUST 在 pane header 內安全換行，不得建立浮動 tooltip 或額外固定詳細列

#### Scenario: 方式 B 勾選多個籌碼項目
- **WHEN** 使用者在 1／2／3 圖的方式 B 勾選五個以上籌碼項目且總高度超過 viewport
- **THEN** 主圖、技術副圖與每個 pane MUST 依緊湊高度及固定順序全部向下展開
- **AND** document 高度 MUST 隨內容與 header 換行增加並由瀏覽器頁面捲軸查看所有 pane
- **AND** panel、副圖槽位與籌碼區 MUST NOT 出現獨立垂直捲軸

#### Scenario: 標題列顯示逐日讀值
- **WHEN** 籌碼 pane 已取得資料且游標未作用
- **THEN** header MUST 顯示最新可用日期與完整讀值，空間不足時依原順序換到下一列
- **AND** 游標作用時 MUST 原位改為游標日期讀值，離開後恢復最新值
- **AND** 不得以第二個固定明細區、浮動 tooltip 或 chart 右側系列標籤重複顯示

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
- **AND** 每個 panel MUST 依自己的作用 pane 與 header 換行自然增高，不得建立各自的垂直捲動容器
- **AND** 頁面 MUST NOT 因 panel、價格軸、readout 或副圖內容產生非預期水平捲軸

#### Scenario: 取消中間的 pane
- **WHEN** 使用者從方式 B 多層 stack 取消一個非首尾 pane
- **THEN** 其後 pane MUST 依固定順序向上補位，panel 與 document 高度 MUST 自然縮短
- **AND** 不得改變其他 pane 的資料、尺度、勾選狀態、visible range、header 讀值或 crosshair 同步

#### Scenario: 縮放與捲頁後維持共用十字線對齊
- **WHEN** 使用者在方式 B 縮放圖表或捲動 document，且 layout 已穩定
- **THEN** 同一 panel 的主圖、目前可見技術副圖與所有可見籌碼 pane MUST 保持相同日期範圍
- **AND** 相同日期於各圖表的絕對螢幕 X 座標差 MUST 小於或等於 1 CSS px
- **AND** 共用垂直線與 header 逐日讀值 MUST 繼續對應相同或最近的交易日

#### Scenario: 離開方式 B
- **WHEN** 使用者從方式 B 切到方式 A、4／6／8 圖或聚焦模式
- **THEN** 系統 MUST 移除方式 B 的長頁面與緊湊 stack 版型，恢復固定視窗與單一副圖槽位
- **AND** MUST 清理已隱藏 pane 的 listener／observer／readout／wheel routing 狀態，並正確 resize 保留的主圖與副圖
- **AND** 返回方式 B 後 MUST 恢復原本技術副圖狀態與完整籌碼勾選組合
