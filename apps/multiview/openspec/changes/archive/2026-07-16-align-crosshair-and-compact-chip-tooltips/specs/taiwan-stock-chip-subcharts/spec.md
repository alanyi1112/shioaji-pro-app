## ADDED Requirements

### Requirement: 逐日浮動 tooltip 與共用讀值狀態

同一 panel 的主 K 線、目前可見的技術副圖及每個作用中籌碼 pane MUST 依共用游標日期顯示各自的浮動 tooltip。tooltip MUST 覆蓋在圖表內容上且不占用文件排版高度，MUST 顯示所代表的 `sessionDate`、series 名稱、該日期實際值、必要組成欄位、資料狀態及來源；所有 dataset MUST 以游標日期查值，不得在游標移動時仍顯示標題保存的最新值。籌碼 pane 標題 MUST NOT 永久顯示最新值、組成明細或實際資料日期。

#### Scenario: 游標移到有完整逐日資料的交易日
- **WHEN** 使用者將游標移到主圖某個具有 K 線、技術指標及法人買賣超資料的交易日
- **THEN** 主圖、目前可見的技術副圖及法人 pane tooltip MUST 顯示同一個 `sessionDate` 的各自數值
- **AND** 法人 pane MUST 顯示該日合計或組成欄位，不得顯示資料序列最後一日的最新值

#### Scenario: 游標日期的欄位為 null 或部分資料
- **WHEN** 作用中的籌碼 pane 在游標日期只有部分欄位，或指定欄位為 `null`
- **THEN** tooltip MUST 將對應欄位標示為「部分資料」或「無資料」
- **AND** MUST NOT 將缺值轉成 0、沿用其他日期數值或隱藏其資料狀態

#### Scenario: tooltip 靠近圖表左右邊界
- **WHEN** 共用垂直線位於 pane 右側且 tooltip 放在線右會超出可視範圍，或位於左側且放在線左會超出可視範圍
- **THEN** tooltip MUST 自動翻到共用線另一側並保持在該 chart／pane 的可視邊界內
- **AND** MUST NOT 造成頁面水平捲動或改變 pane 高度

#### Scenario: 游標離開或 pane 被移除
- **WHEN** 游標離開 panel、作用日期超出可見資料範圍，或使用者移除／隱藏某個 pane
- **THEN** 對應 tooltip MUST 立即隱藏或銷毀
- **AND** MUST NOT 保留上一個日期、商品或已移除 pane 的讀值

#### Scenario: 技術副圖使用逐日 tooltip
- **WHEN** KD、RSI、MACD 或 ATR 技術副圖可見且使用者移動共用游標
- **THEN** 技術副圖 MUST 以浮動 tooltip 顯示游標日期的作用 series 數值
- **AND** 可保留不另占一列高度的短 series legend，但不得以永久詳細讀值列撐高副圖

## MODIFIED Requirements

### Requirement: 大戶與散戶獨立副圖

系統 MUST 將大戶持股與散戶持股提供為兩個可獨立選取的週頻複合 pane；每個 pane MUST 同時以比例線顯示持股比例，並以正負柱顯示相較前一筆實際發布週資料的百分點變化。pane 的 tooltip MUST 顯示門檻、持股比例、週增減、持股張數、持股人數、方向、頻率及實際資料日期。方式 B 同時勾選時 MUST 上下排列且共用相同 TDCC response；方式 A MUST 只顯示目前選取的一個 pane。TDCC 值 MUST 只屬於其實際 `dataDate`，其他交易日不得 forward-fill、插值或視為 0。

#### Scenario: 顯示預設大戶持股
- **WHEN** 大戶持股 pane 建立且有至少一筆 TDCC 分級 15 資料
- **THEN** pane MUST 以百分比線圖顯示分級 15 的持股比例
- **AND** tooltip MUST 顯示「1,000 張級距大戶」、實際為 `1,000,001 股以上`、持股張數、人數、資料日期與 TDCC 來源

#### Scenario: 顯示預設散戶持股
- **WHEN** 散戶持股 pane 建立且具有 TDCC 分級 1 至 3 資料
- **THEN** pane MUST 以百分比線圖顯示三個分級加總比例
- **AND** tooltip MUST 顯示「10 張以下」、加總持股張數、人數、資料日期與 TDCC 來源

#### Scenario: 顯示週變化柱
- **WHEN** 某週加總持股比例高於、低於或等於前一筆實際發布週資料
- **THEN** pane MUST 以本週比例減前週比例的百分點顯示柱值
- **AND** 增加柱使用台股紅色、減少柱使用綠色、零值使用中性色，tooltip MUST 同時顯示正負方向與「百分點」

#### Scenario: 只有一筆 TDCC 快照
- **WHEN** 查詢範圍只有一筆合法股權分散資料
- **THEN** pane MUST 顯示該筆比例資料點，且該 `dataDate` 的 tooltip MUST 顯示日期與「首筆／無前週比較」
- **AND** MUST NOT 畫出週變化柱、假的水平趨勢或每日補值

#### Scenario: 同一週某個分級缺漏
- **WHEN** 大戶或散戶計算所需的任一持股分級為缺漏或驗證失敗
- **THEN** 該 pane MUST 將該週標示為部分或無資料
- **AND** MUST NOT 將缺少分級視為零後繼續加總

#### Scenario: 游標停在 TDCC 未發布日
- **WHEN** 游標 `sessionDate` 不是任何一筆 TDCC 的實際 `dataDate`
- **THEN** 大戶／散戶 tooltip MUST 明示「當日無發布資料」
- **AND** MUST NOT 把前一週比例或週增減顯示成游標當日資料
- **AND** 若另列最近一筆資料作為參考，MUST 明確標示其實際 `dataDate` 並與當日缺值狀態區分

### Requirement: 籌碼副圖時間軸與十字線同步

所有實際顯示的籌碼 pane MUST 以 `sessionDate`／`dataDate` 與主 K 線及目前可見的技術副圖同步 visible range、crosshair、resize、聚焦模式及向左載入；沒有資料的交易日 MUST 保留 gap。每個 pane MUST 使用完整 candle 日期的 time anchor，使日頻與週頻資料共用相同 X 座標。方式 A 被替換而隱藏的副圖 MUST NOT 參與同步或以零尺寸更新。同一 panel MUST 只顯示一條由主圖 plot 頂端連續延伸至最後一個可見副圖底端的共用垂直線，各 chart 原生垂直 crosshair MUST NOT 形成重複或錯位線段；在 layout 穩定後，相同日期於主圖、技術副圖及每個可見籌碼 pane 的絕對螢幕 X 座標差 MUST 小於或等於 1 CSS px。

#### Scenario: 主圖平移與縮放
- **WHEN** 使用者平移或縮放主 K 線
- **THEN** 所有實際顯示的副圖 MUST 顯示相同交易日期範圍
- **AND** 同步過程不得形成循環更新或跳動
- **AND** 共用垂直線與各 pane 同日期資料點 MUST 維持對齊

#### Scenario: 籌碼副圖移動十字線
- **WHEN** 使用者在任一籌碼 pane 移動十字線
- **THEN** 主圖、目前可見的技術副圖及其他作用中的籌碼 pane MUST 同步到相同或最近的交易日
- **AND** 所有 tooltip MUST 使用同一個 `sessionDate`，TDCC 值則只在相符的實際 `dataDate` 顯示
- **AND** panel MUST 呈現一條連續且不左右錯位的共用垂直線

#### Scenario: 方式 A 切換共用槽位內容
- **WHEN** 使用者在技術副圖與籌碼 pane 間替換作用內容
- **THEN** 新顯示的 chart MUST 立即套用主圖目前 visible range、共用 plot geometry、cursor state 與可用尺寸
- **AND** 已隱藏 chart MUST NOT 接收 crosshair、tooltip 或 resize 更新

#### Scenario: 向左載入更早歷史
- **WHEN** 主 K 線載入更早 candles 且籌碼副圖已啟用
- **THEN** 前端只查詢新增的日期缺口
- **AND** 合併後的籌碼 rows 不重複、不改變既有日期值的順序
- **AND** 共用垂直線及 tooltip MUST 在合併後仍對應同一日期

#### Scenario: 對齊每週股權分散資料
- **WHEN** 大戶／散戶副圖顯示於日 K 面板
- **THEN** 每個比例線資料點與週變化柱 MUST 只對齊 TDCC 回傳的實際 `dataDate`
- **AND** 其他交易日 MUST 保留 gap，不得 forward-fill、插值或複製前一週比例
- **AND** 游標位於其他交易日時 tooltip MUST 顯示當日無發布資料，而不是把最近一筆 `dataDate` 移到共用垂直線位置

#### Scenario: 驗收 1px 日期對齊
- **WHEN** 在桌面寬度的 1／2／3 圖方式 B，分別對 visible range 左側、中央及右側交易日量測主圖、技術副圖與至少五個籌碼 pane 的 `element left + timeToCoordinate(date)`
- **THEN** 每個測試日期的最大與最小絕對螢幕 X 座標差 MUST 小於或等於 1 CSS px
- **AND** 在平移、縮放、panel resize、增減 pane 及 TDCC 級距切換後的穩定畫面仍 MUST 通過相同門檻

#### Scenario: document 捲動時共用垂直線保持連續
- **WHEN** 方式 B 有多個 pane 且使用者捲動瀏覽器 document，使部分主圖或副圖進出 viewport
- **THEN** 共用垂直線 MUST 依 panel 實際位置更新且在可見區段維持同一螢幕 X 座標
- **AND** overlay MUST NOT 攔截垂直捲動、水平拖曳、縮放或 pane 控制操作

### Requirement: 多層副圖高度與捲動

方式 B MUST 為主圖、技術副圖及每個籌碼 pane 保留可讀高度，並讓 panel 與頁面高度依作用中的 pane 數量自然增減；當內容超過 viewport 時，系統 MUST 以 `html/body` 的瀏覽器頁面作為唯一垂直捲動容器，`.subchart-slot`、`.chip-pane-region`、`.chip-pane-stack` 與 `.chart-panel` MUST NOT 形成可獨立垂直捲動的區域。桌面寬度的方式 B MUST 採緊湊副圖版型：技術副圖總高 MUST 介於 96–120 CSS px，每個籌碼 pane 總高 MUST 介於 88–104 CSS px，且浮動 tooltip MUST NOT 參與 layout flow 或增加這些高度；窄螢幕可因控制項換行放寬高度，但 MUST 避免無限制等比例壓縮與非預期水平捲動。方式 A MUST 只顯示單一副圖槽位且不得出現多層 stack 或因籌碼 pane 增加額外高度；4／6／8 圖與聚焦模式 MUST 維持方式 A 的固定視窗版型。每個可見籌碼 pane 標題 MUST 只永久顯示名稱、必要狀態、適用的 TDCC 級距控制與移除控制，MUST NOT 永久顯示最新值、實際資料日期或組成明細。

#### Scenario: 方式 A 顯示籌碼 pane
- **WHEN** 使用者在方式 A 選擇任一籌碼項目
- **THEN** 籌碼 pane MUST 使用原技術副圖槽位的高度與位置
- **AND** panel 不得新增副圖列、顯示多層 stack 或啟用方式 B 的長頁面版型
- **AND** 讀值 MUST 使用浮動 tooltip，不得因恢復永久詳細列而改變槽位高度

#### Scenario: 方式 B 勾選多個籌碼項目
- **WHEN** 使用者在 1／2／3 圖的方式 B 勾選五個以上籌碼項目且總高度超過 viewport
- **THEN** 主圖、技術副圖與每個 pane MUST 依緊湊高度及固定順序全部向下展開
- **AND** document 高度 MUST 隨內容增加並由瀏覽器頁面捲軸查看所有 pane
- **AND** panel、副圖槽位與籌碼區 MUST NOT 出現獨立垂直捲軸

#### Scenario: 標題不再永久占用最新讀值高度
- **WHEN** 籌碼 pane 已取得最新值、實際資料日期與組成明細
- **THEN** 這些讀值 MUST 只在逐日浮動 tooltip 或明確的狀態互動中顯示
- **AND** pane 標題 MUST NOT 因最新值、日期或明細新增第二列永久文字
- **AND** 游標未作用時不得以不可見占位元素保留原詳細列高度

#### Scenario: 從圖表內容使用垂直捲動手勢
- **WHEN** 使用者將游標或觸控位置放在主圖、技術副圖或任一籌碼 pane 上並執行垂直 wheel／touch 手勢
- **THEN** 手勢 MUST 可推進瀏覽器 document 的垂直捲動位置
- **AND** MUST NOT 被單一 chart 或 pane 的內層捲動區困住
- **AND** 水平拖曳、時間軸縮放、共用 crosshair 與 tooltip MUST 保持可操作

#### Scenario: 2／3 圖與窄螢幕使用共同頁面捲軸
- **WHEN** 方式 B 在寬螢幕以 2／3 個 panel 並排，或在既定 breakpoint 以下改為單欄
- **THEN** 所有 panel MUST 使用同一個瀏覽器頁面垂直捲軸
- **AND** 每個 panel MUST 依自己的作用 pane 自然增高，不得建立各自的垂直捲動容器
- **AND** 頁面 MUST NOT 因 panel、價格軸、tooltip 或副圖內容產生非預期水平捲軸

#### Scenario: 取消中間的 pane
- **WHEN** 使用者從方式 B 多層 stack 取消一個非首尾 pane
- **THEN** 其後 pane MUST 依固定順序向上補位，panel 與 document 高度 MUST 自然縮短
- **AND** 不得改變其他 pane 的資料、尺度、勾選狀態、visible range、tooltip 或 crosshair 同步

#### Scenario: 離開方式 B
- **WHEN** 使用者從方式 B 切到方式 A、4／6／8 圖或聚焦模式
- **THEN** 系統 MUST 移除方式 B 的長頁面與緊湊 stack 版型，恢復固定視窗與單一副圖槽位
- **AND** MUST 清理已隱藏 pane 的 listener／observer／tooltip，並正確 resize 保留的主圖與副圖
- **AND** 返回方式 B 後 MUST 恢復原本技術副圖狀態與完整籌碼勾選組合
