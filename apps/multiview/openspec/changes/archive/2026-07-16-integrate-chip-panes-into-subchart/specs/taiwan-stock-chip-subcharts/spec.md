## MODIFIED Requirements

### Requirement: 台股個股籌碼副圖選單

系統 MUST 在每個圖表面板的單一「副圖」選單中，以可辨識的「技術指標」與「籌碼資料」群組提供既有 RSI、KD、MACD、ATR，以及外資買賣超、投信買賣超、自營商買賣超、三大法人合計、外資持股、融資、融券、借券、大戶持股及散戶持股選項。工具列 MUST NOT 再提供獨立「籌碼」按鈕。系統 MUST 只在 eligible 台股普通股的 `1d` 週期載入籌碼資料；技術指標的計算與同圖複選行為 MUST 保持不變。

#### Scenario: 從單一副圖選單選擇三大法人合計
- **WHEN** 使用者在 `2330.TW` 日 K 面板展開「副圖」並選擇「三大法人合計」
- **THEN** 面板依目前 A／B 模式顯示對應籌碼 pane
- **AND** 只請求目前 K 線資料範圍所需的 `institutional-flow` 資料
- **AND** 工具列不顯示另一個「籌碼」入口

#### Scenario: 以鍵盤操作合併選單
- **WHEN** 使用者以鍵盤展開「副圖」選單並巡覽選項
- **THEN** 技術指標與籌碼資料群組及每個選項 MUST 具有可聚焦 label 與可辨識狀態
- **AND** 焦點順序 MUST NOT 經過已移除的獨立籌碼按鈕

#### Scenario: 切換到非日 K
- **WHEN** 籌碼副圖已選取且使用者把週期切換為 `1h`、`1wk` 或其他非 `1d` 週期
- **THEN** 系統清除舊籌碼 series 並顯示「籌碼資料僅支援日 K」
- **AND** MUST NOT 顯示先前日 K 的籌碼資料

#### Scenario: 切換到不支援商品
- **WHEN** 籌碼副圖已選取且使用者切換到 ETF、海外商品或未知商品
- **THEN** 系統顯示中性不適用狀態
- **AND** MUST NOT 發出籌碼上游請求

#### Scenario: 分別選擇大戶與散戶
- **WHEN** 使用者在 eligible 台股普通股日 K 面板選擇「大戶持股」及「散戶持股」
- **THEN** 面板 MUST 依目前模式替換單一共用槽位或建立兩個獨立週頻 pane
- **AND** 兩個顯示項目 MUST 共用 D1 中相同日期範圍的 TDCC 股權分散資料

### Requirement: 籌碼副圖 A／B 顯示模式

系統 MUST 提供「A 單一副圖」與「B 多層副圖」兩種顯示模式。方式 A MUST 讓每個 panel 只有一個共用副圖槽位；技術副圖與單一籌碼 pane MUST 互相替換，不得在技術副圖下方新增籌碼列。方式 B MUST 保留既有技術副圖，並以複選語意讓每個已勾選籌碼項目建立一個具獨立 Y 軸的 pane，依固定選單順序上下排列。

#### Scenario: 方式 A 由技術副圖替換為籌碼 pane
- **WHEN** 方式 A 正顯示 KD／RSI／MACD／ATR 技術副圖，使用者從「副圖」選單選擇「三大法人合計」
- **THEN** 三大法人合計 pane MUST 顯示在原技術副圖的同一槽位
- **AND** 技術副圖 MUST 隱藏且主圖下方不得新增另一列
- **AND** 主 K 線與 candles MUST NOT 重新建立或重新請求

#### Scenario: 方式 A 由籌碼 pane 替換回技術副圖
- **WHEN** 方式 A 正顯示籌碼 pane，使用者操作任一技術指標選項
- **THEN** 系統 MUST 銷毀或停用目前籌碼 pane，並在相同槽位恢復技術副圖
- **AND** MUST 恢復保存的技術指標複選組合及最後籌碼作用項目

#### Scenario: 方式 A 替換籌碼作用 pane
- **WHEN** 使用者在方式 A 的同一 panel 從「三大法人合計」選擇「外資持股」
- **THEN** 系統移除三大法人合計 pane並在同一共用槽位建立外資持股 pane
- **AND** 主圖不需重新載入，技術副圖選項也不得被清除

#### Scenario: 方式 B 增加多個 pane
- **WHEN** 使用者在方式 B 依序勾選三大法人合計、融資、融券、大戶持股與散戶持股
- **THEN** 系統 MUST 在既有技術副圖下建立五個獨立 pane，並依固定 registry 順序排列
- **AND** 相同 dataset 的 pane MUST 共用已取得的 response 與 request，不得重複抓取相同 `symbol + dataset + range`

#### Scenario: 方式 B 取消單一項目
- **WHEN** 使用者在方式 B 取消勾選「融券」
- **THEN** 系統 MUST 只銷毀融券 pane 的 chart、series、讀值、listener 與 observer
- **AND** 其他籌碼 pane、主圖與技術副圖 MUST 保持作用且重新排列

#### Scenario: A 與 B 保留各自選擇
- **WHEN** 使用者在方式 B 已選取多個 pane，切到方式 A 改用技術副圖或另一個籌碼 pane，再切回方式 B
- **THEN** 系統 MUST 恢復原本 B 的技術副圖狀態與完整籌碼勾選組合
- **AND** MUST NOT 以 A 的作用種類或單一籌碼項目覆寫 B 的保存清單

### Requirement: 圖表數量與副圖模式政策

系統 MUST 支援 1、2、3、4、6、8 圖。1、2、3 圖 MUST 可使用 A 或 B 且首次預設 B；4、6、8 圖 MUST 固定使用 A。方式控制 MUST 是全域設定，所有目前 panel 採用相同 effective mode；使用 A 的任何圖數都 MUST 套用同一個共用副圖槽位規則。

#### Scenario: 首次使用 1、2 或 3 圖
- **WHEN** 裝置尚未保存籌碼副圖偏好且使用者選擇 1、2 或 3 圖
- **THEN** 系統 MUST 啟用方式 B
- **AND** MUST 預設勾選三大法人合計、融資、融券、大戶持股與散戶持股

#### Scenario: 4、6、8 圖固定方式 A
- **WHEN** 使用者選擇 4、6 或 8 圖
- **THEN** 系統 MUST 套用方式 A 並停用方式 B 控制
- **AND** 每個 panel MUST 只保留一個共用副圖槽位
- **AND** 介面 MUST 顯示「4 圖以上固定單一副圖」或同等清楚說明

#### Scenario: 從 B 切到 4、6、8 圖後返回
- **WHEN** 使用者從 1、2 或 3 圖的方式 B 切換至 4、6 或 8 圖，再返回 1、2 或 3 圖
- **THEN** 4、6、8 圖期間 MUST 只顯示方式 A 最後作用的技術副圖或單一籌碼 pane
- **AND** 返回後 MUST 恢復原本方式 B、技術副圖狀態與完整籌碼勾選組合

#### Scenario: 4、6、8 圖進入聚焦模式
- **WHEN** 使用者在 4、6 或 8 圖中聚焦任一 panel
- **THEN** 聚焦 panel MUST 維持方式 A 與單一共用副圖槽位
- **AND** 聚焦動作 MUST NOT 暫時或永久啟用方式 B

#### Scenario: 顯示新增的 3 圖版面
- **WHEN** 使用者在寬螢幕選擇 3 圖
- **THEN** 系統 MUST 以三欄一列呈現三個等寬 panel
- **AND** 低於多圖可讀性 breakpoint 時 MUST 改為單欄，不得使用不對稱的二加一版面

### Requirement: 籌碼副圖時間軸與十字線同步

所有實際顯示的籌碼 pane MUST 以 `sessionDate` 與主 K 線及目前可見的技術副圖同步 visible range、crosshair、resize、聚焦模式及向左載入；沒有資料的交易日 MUST 保留 gap。每個 pane MUST 使用完整 candle 日期的 time anchor，使日頻與週頻資料共用相同 X 座標。方式 A 被替換而隱藏的副圖 MUST NOT 參與同步或以零尺寸更新。

#### Scenario: 主圖平移與縮放
- **WHEN** 使用者平移或縮放主 K 線
- **THEN** 所有實際顯示的副圖 MUST 顯示相同交易日期範圍
- **AND** 同步過程不得形成循環更新或跳動

#### Scenario: 籌碼副圖移動十字線
- **WHEN** 使用者在任一籌碼 pane 移動十字線
- **THEN** 主圖、目前可見的技術副圖及其他作用中的籌碼 pane MUST 同步到相同或最近的交易日
- **AND** 所有讀值使用同一個 `sessionDate`

#### Scenario: 方式 A 切換共用槽位內容
- **WHEN** 使用者在技術副圖與籌碼 pane 間替換作用內容
- **THEN** 新顯示的 chart MUST 立即套用主圖目前 visible range 與可用尺寸
- **AND** 已隱藏 chart MUST NOT 接收 crosshair 或 resize 更新

#### Scenario: 向左載入更早歷史
- **WHEN** 主 K 線載入更早 candles 且籌碼副圖已啟用
- **THEN** 前端只查詢新增的日期缺口
- **AND** 合併後的籌碼 rows 不重複、不改變既有日期值的順序

#### Scenario: 對齊每週股權分散資料
- **WHEN** 大戶／散戶副圖顯示於日 K 面板
- **THEN** 每根柱 MUST 只對齊 TDCC 回傳的實際 `dataDate`
- **AND** 其他交易日 MUST 保留 gap，不得 forward-fill、插值或複製前一週比例

### Requirement: Panel lifecycle 與舊請求隔離

籌碼 pane manager MUST 跟隨 panel 的 symbol、interval、頁籤、排序、focus、建立與銷毀 lifecycle；切換後的舊 request MUST 被取消或忽略，不能覆蓋目前 panel。A 的作用種類與最後籌碼項目、B 的技術指標與籌碼選擇 MUST 在 panel 重建前以 `tabId + canonical symbol` 保存，不能只依畫面 index；舊版沒有作用種類欄位的偏好 MUST 相容讀取且不得清除 B 清單。

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

### Requirement: 多層副圖高度與捲動

方式 B MUST 為主圖、技術副圖及每個籌碼 pane 保留可讀的最低高度；當副圖內容超過 panel 可用高度時 MUST 在共用副圖區域提供 panel 內垂直捲動，MUST NOT 以無限制等比例壓縮容納全部 pane。方式 A MUST 只顯示單一副圖槽位且不得出現多層 stack 或因籌碼 pane 增加額外高度。每個可見籌碼 pane 標題 MUST 顯示名稱、最新值、實際資料日期、狀態及適用模式下可操作的移除控制。

#### Scenario: 方式 A 顯示籌碼 pane
- **WHEN** 使用者在方式 A 選擇任一籌碼項目
- **THEN** 籌碼 pane MUST 使用原技術副圖槽位的高度與位置
- **AND** panel 不得新增副圖列或顯示多層 stack 捲動

#### Scenario: 勾選多個籌碼項目
- **WHEN** 使用者在方式 B 勾選五個以上籌碼項目且總高度超過 panel
- **THEN** 主圖、技術副圖與每個 pane MUST 保持規定的最低高度
- **AND** 使用者 MUST 可在該 panel 的副圖區域內垂直捲動查看所有 pane

#### Scenario: 取消中間的 pane
- **WHEN** 使用者從方式 B 多層 stack 取消一個非首尾 pane
- **THEN** 其後 pane MUST 依固定順序向上補位
- **AND** 不得改變其他 pane 的資料、尺度或勾選狀態
