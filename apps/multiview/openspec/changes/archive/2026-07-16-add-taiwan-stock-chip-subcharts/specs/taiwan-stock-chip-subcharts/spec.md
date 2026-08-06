## ADDED Requirements

### Requirement: 台股個股籌碼副圖選單

系統 MUST 在每個圖表面板的籌碼副圖選單提供外資買賣超、投信買賣超、自營商買賣超、三大法人合計、外資持股、融資、融券、借券、大戶持股及散戶持股選項，並 MUST 只在 eligible 台股普通股的 `1d` 週期載入籌碼資料。現有 RSI、KD、MACD、ATR 技術副圖 MUST 保持原行為，且 MUST NOT 受籌碼副圖 A／B 模式控制。

#### Scenario: 選擇三大法人合計
- **WHEN** 使用者在 `2330.TW` 日 K 面板選擇「三大法人合計」
- **THEN** 面板新增並展開對應籌碼 pane
- **AND** 只請求目前 K 線資料範圍所需的 `institutional-flow` 資料

#### Scenario: 切換到非日 K
- **WHEN** 籌碼副圖已選取且使用者把週期切換為 `1h`、`1wk` 或其他非 `1d` 週期
- **THEN** 系統清除舊籌碼 series 並顯示「籌碼資料僅支援日 K」
- **AND** MUST NOT 顯示先前日 K 的籌碼資料

#### Scenario: 切換到不支援商品
- **WHEN** 籌碼副圖已選取且使用者切換到 ETF、海外商品或未知商品
- **THEN** 系統顯示中性不適用狀態
- **AND** MUST NOT 發出籌碼上游請求

#### Scenario: 分別選擇大戶與散戶
- **WHEN** 使用者在 eligible 台股普通股日 K 面板勾選「大戶持股」及「散戶持股」
- **THEN** 面板 MUST 依目前模式建立一個作用 pane 或兩個獨立週頻 pane
- **AND** 兩個顯示項目 MUST 共用 D1 中相同日期範圍的 TDCC 股權分散資料

### Requirement: 籌碼副圖 A／B 顯示模式

系統 MUST 提供「A 單一副圖」與「B 多層副圖」兩種籌碼顯示模式。方式 A MUST 以單選語意讓每個 panel 一次只顯示一個籌碼 pane；方式 B MUST 以複選語意讓每個已勾選項目建立一個具獨立 Y 軸的 pane，並依固定選單順序上下排列。

#### Scenario: 方式 A 替換作用 pane
- **WHEN** 使用者在方式 A 的同一 panel 從「三大法人合計」選擇「外資持股」
- **THEN** 系統移除三大法人合計 pane 並建立外資持股 pane
- **AND** 主圖與既有技術副圖不需重新載入或改變選項

#### Scenario: 方式 B 增加多個 pane
- **WHEN** 使用者在方式 B 依序勾選三大法人合計、融資、融券、大戶持股與散戶持股
- **THEN** 系統 MUST 建立五個獨立 pane，並依固定 registry 順序排列
- **AND** 相同 dataset 的 pane MUST 共用已取得的 response 與 request，不得重複抓取相同 `symbol + dataset + range`

#### Scenario: 方式 B 取消單一項目
- **WHEN** 使用者在方式 B 取消勾選「融券」
- **THEN** 系統 MUST 只銷毀融券 pane 的 chart、series、讀值、listener 與 observer
- **AND** 其他籌碼 pane、主圖與技術副圖 MUST 保持作用且重新排列

#### Scenario: A 與 B 保留各自選擇
- **WHEN** 使用者在方式 B 已選取多個 pane，切到方式 A 選擇另一個 pane，再切回方式 B
- **THEN** 系統 MUST 恢復原本 B 的完整勾選組合
- **AND** MUST NOT 以 A 的單一作用項目覆寫 B 的保存清單

### Requirement: 圖表數量與副圖模式政策

系統 MUST 支援 1、2、3、4、6、8 圖。1、2、3 圖 MUST 可使用 A 或 B 且首次預設 B；4、6、8 圖 MUST 固定使用 A。方式控制 MUST 是全域設定，所有目前 panel 採用相同 effective mode。

#### Scenario: 首次使用 1、2 或 3 圖
- **WHEN** 裝置尚未保存籌碼副圖偏好且使用者選擇 1、2 或 3 圖
- **THEN** 系統 MUST 啟用方式 B
- **AND** MUST 預設勾選三大法人合計、融資、融券、大戶持股與散戶持股

#### Scenario: 4、6、8 圖固定方式 A
- **WHEN** 使用者選擇 4、6 或 8 圖
- **THEN** 系統 MUST 套用方式 A 並停用方式 B 控制
- **AND** 介面 MUST 顯示「4 圖以上固定單一副圖」或同等清楚說明

#### Scenario: 從 B 切到 4、6、8 圖後返回
- **WHEN** 使用者從 1、2 或 3 圖的方式 B 切換至 4、6 或 8 圖，再返回 1、2 或 3 圖
- **THEN** 4、6、8 圖期間 MUST 只顯示最後作用的單一 pane
- **AND** 返回後 MUST 恢復原本方式 B 與完整勾選組合

#### Scenario: 4、6、8 圖進入聚焦模式
- **WHEN** 使用者在 4、6 或 8 圖中聚焦任一 panel
- **THEN** 聚焦 panel MUST 維持方式 A
- **AND** 聚焦動作 MUST NOT 暫時或永久啟用方式 B

#### Scenario: 顯示新增的 3 圖版面
- **WHEN** 使用者在寬螢幕選擇 3 圖
- **THEN** 系統 MUST 以三欄一列呈現三個等寬 panel
- **AND** 低於多圖可讀性 breakpoint 時 MUST 改為單欄，不得使用不對稱的二加一版面

### Requirement: 法人買賣超副圖

系統 MUST 將外資、投信、自營商及三大法人合計提供為四個可獨立選取的法人買賣超 pane。每個 pane MUST 依交易日顯示相應淨買賣超、可辨識的零軸與正負方向；自營商讀值 MUST 分辨自行買賣與避險，三大法人合計讀值 MUST 分列三個組成項。

#### Scenario: 同日三大法人有正負買賣超
- **WHEN** 方式 B 同時顯示外資、投信與自營商 pane，且某交易日外資買超、投信賣超、自營商資料完整
- **THEN** 各 pane MUST 依自己的正負值畫在零軸兩側
- **AND** hover 讀值 MUST 顯示同一日期、對應法人張數、自營商細項與資料來源

#### Scenario: 某法人資料缺漏
- **WHEN** 某交易日只有外資與投信資料，自營商欄位為 `null`
- **THEN** 系統只畫可用 series
- **AND** 讀值將自營商標示為「無資料」，不得顯示 0 張

#### Scenario: 顯示三大法人合計
- **WHEN** 某交易日的外資、投信與自營商合計資料完整且已通過來源總計交叉驗證
- **THEN** 使用者 MUST 可建立「三大法人合計」pane
- **AND** hover 讀值 MUST 同時顯示合計張數與三個組成分項

#### Scenario: 三大法人合計不完整
- **WHEN** 任一組成分項缺漏或與來源總計驗證不一致
- **THEN** 三大法人合計 series MUST 在該日保留 gap 或標示部分資料
- **AND** MUST NOT 顯示以零補足的錯誤合計

### Requirement: 外資持股副圖

外資持股副圖 MUST 以百分比尺度顯示來源發布的外資及陸資持股比率，並在讀值顯示持股股數、發行股數與實際資料日期；MUST NOT 顯示或推算投信及自營商持股比。

#### Scenario: 顯示外資持股比
- **WHEN** 某交易日有外資持股比率與持股股數
- **THEN** 副圖以百分比折線呈現該比率
- **AND** hover 讀值顯示持股比率、持股股數與來源

#### Scenario: 外資持股資料未發布
- **WHEN** K 線已有某交易日但來源尚未發布該日持股資料
- **THEN** 副圖在該日保留 gap
- **AND** MUST NOT forward-fill 前一日比率

### Requirement: 融資融券副圖

系統 MUST 將融資與融券提供為兩個可獨立選取的 pane，分別顯示餘額，並在讀值提供對應的當日增減、買進／賣出／償還及資券互抵；兩個 pane MUST 共用相同 `margin-short` response，不同來源單位 MUST 在進入圖表前正規化。

#### Scenario: 顯示融資融券餘額
- **WHEN** 方式 B 同時勾選融資與融券，且某交易日有完整餘額
- **THEN** 系統 MUST 建立兩個具獨立 Y 軸的 pane
- **AND** 各 pane 讀值 MUST 顯示今日餘額與相對前日增減

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
- **AND** hover 讀值清楚區分兩者

### Requirement: 大戶與散戶獨立副圖

系統 MUST 參照使用者提供的呈現方式，將大戶持股與散戶持股提供為兩個可獨立選取的週頻百分比柱狀 pane，並在各 pane 顯示門檻、持股比例、持股張數、持股人數、方向及資料日期。方式 B 同時勾選時 MUST 上下排列且共用相同 TDCC response；方式 A MUST 只顯示目前選取的一個 pane。

#### Scenario: 顯示預設大戶持股
- **WHEN** 大戶持股 pane 首次建立且有 TDCC 分級 15 資料
- **THEN** pane MUST 以百分比柱狀圖顯示分級 15 的持股比例
- **AND** 讀值 MUST 顯示「1,000 張級距大戶」、實際為 `1,000,001 股以上`、持股張數、人數、資料日期與 TDCC 來源

#### Scenario: 顯示預設散戶持股
- **WHEN** 散戶持股 pane 建立且同一資料日期具有 TDCC 分級 1 至 3
- **THEN** pane MUST 以百分比柱狀圖顯示三個分級加總比例
- **AND** 讀值 MUST 顯示「10 張以下」、加總持股張數、人數、資料日期與 TDCC 來源

#### Scenario: 依週變化決定柱色
- **WHEN** 某週加總持股比例高於或低於前一筆實際發布週資料
- **THEN** 增加的柱 MUST 使用台股紅色語意，減少的柱 MUST 使用綠色語意
- **AND** 持平或第一筆 MUST 使用中性色，且讀值 MUST 同時以箭頭或文字呈現方向

#### Scenario: 同一週某個分級缺漏
- **WHEN** 大戶或散戶計算所需的任一持股分級為缺漏或驗證失敗
- **THEN** 該 pane MUST 將該週標示為部分或無資料
- **AND** MUST NOT 將缺少分級視為零後繼續加總

### Requirement: 大戶散戶級距控制

系統 MUST 讓使用者從 TDCC 官方持股級距可精確組成的選項調整大戶下界與散戶上界，且 MUST 在控制項旁說明實際股數範圍。

#### Scenario: 調整為支援的官方級距
- **WHEN** 使用者從選單選擇另一個支援的持股級距門檻
- **THEN** 前端 MUST 使用已載入的 levels 重新加總比例、股數及人數
- **AND** MUST NOT 因門檻切換再次呼叫 TDCC 上游

#### Scenario: 門檻包含無法切開的邊界
- **WHEN** 市場慣稱門檻與 TDCC 級距的精確下界不同，例如「1,000 張以上」對應 `1,000,001 股以上`
- **THEN** 控制項或 tooltip MUST 顯示實際官方範圍
- **AND** MUST NOT 隱藏、四捨五入或推估該邊界差異

### Requirement: 籌碼副圖時間軸與十字線同步

所有作用中的籌碼 pane MUST 以 `sessionDate` 與主 K 線及技術副圖同步 visible range、crosshair、resize、聚焦模式及向左載入；沒有資料的交易日 MUST 保留 gap。每個 pane MUST 使用完整 candle 日期的 time anchor，使日頻與週頻資料共用相同 X 座標。

#### Scenario: 主圖平移與縮放
- **WHEN** 使用者平移或縮放主 K 線
- **THEN** 所有作用中的籌碼 pane MUST 顯示相同交易日期範圍
- **AND** 同步過程不得形成循環更新或跳動

#### Scenario: 籌碼副圖移動十字線
- **WHEN** 使用者在任一籌碼 pane 移動十字線
- **THEN** 主圖、技術副圖及其他作用中的籌碼 pane MUST 同步到相同或最近的交易日
- **AND** 所有讀值使用同一個 `sessionDate`

#### Scenario: 向左載入更早歷史
- **WHEN** 主 K 線載入更早 candles 且籌碼副圖已啟用
- **THEN** 前端只查詢新增的日期缺口
- **AND** 合併後的籌碼 rows 不重複、不改變既有日期值的順序

#### Scenario: 對齊每週股權分散資料
- **WHEN** 大戶／散戶副圖顯示於日 K 面板
- **THEN** 每根柱 MUST 只對齊 TDCC 回傳的實際 `dataDate`
- **AND** 其他交易日 MUST 保留 gap，不得 forward-fill、插值或複製前一週比例

### Requirement: Panel lifecycle 與舊請求隔離

籌碼 pane manager MUST 跟隨 panel 的 symbol、interval、頁籤、排序、focus、建立與銷毀 lifecycle；切換後的舊 request MUST 被取消或忽略，不能覆蓋目前 panel。A／B 與 pane 選擇 MUST 在 panel 重建前以 `tabId + canonical symbol` 保存，不能只依畫面 index。

#### Scenario: 快速切換兩個台股個股
- **WHEN** 使用者在第一個籌碼 request 完成前從 `2330.TW` 切換到 `8069.TWO`
- **THEN** 舊 request 的 response MUST NOT 畫到新商品
- **AND** 新 panel 只顯示 `8069.TWO` 的來源與資料

#### Scenario: 變更圖表數量
- **WHEN** 使用者在 1／2／3／4／6／8 圖之間切換
- **THEN** 已移除 panel 的籌碼 listener、observer 與 request MUST 被清理
- **AND** 新 panel MUST 依穩定鍵恢復適用的 A／B 偏好與 pane 選擇

### Requirement: 多層副圖高度與捲動

方式 B MUST 為主圖及每個籌碼 pane 保留可讀的最低高度；當 pane stack 超過 panel 可用高度時 MUST 提供 panel 內垂直捲動，MUST NOT 以無限制等比例壓縮容納全部 pane。每個 pane 標題 MUST 顯示名稱、最新值、實際資料日期、狀態及可操作的移除控制。

#### Scenario: 勾選多個籌碼項目
- **WHEN** 使用者在方式 B 勾選五個以上籌碼項目且總高度超過 panel
- **THEN** 主圖與每個 pane MUST 保持規定的最低高度
- **AND** 使用者 MUST 可在該 panel 內垂直捲動查看所有 pane

#### Scenario: 取消中間的 pane
- **WHEN** 使用者從多層 stack 取消一個非首尾 pane
- **THEN** 其後 pane MUST 依固定順序向上補位
- **AND** 不得改變其他 pane 的資料、尺度或勾選狀態

### Requirement: 籌碼資料狀態與可及性

系統 MUST 在籌碼副圖顯示載入中、部分資料、資料過期、尚未發布、不適用與來源不可用狀態；series MUST 有文字 label，讀值與操作 MUST 不只靠顏色辨識。

#### Scenario: 使用過期 D1 資料
- **WHEN** API 回傳 rows 並標示 `stale_cache`
- **THEN** 副圖仍顯示最近成功資料
- **AND** 狀態區顯示資料日期與「資料可能過期」

#### Scenario: 股權分散歷史尚未累積
- **WHEN** 大戶／散戶查詢範圍早於 D1 可用的最早 TDCC 資料日期
- **THEN** 狀態區 MUST 顯示實際可用起日與「較早週資料尚未保存」
- **AND** MUST NOT 以空白日資料、外資持股或其他籌碼 series 補足

#### Scenario: 完全沒有可用資料
- **WHEN** eligible 商品在請求範圍內沒有 D1 或上游資料
- **THEN** 副圖顯示安全且可理解的原因
- **AND** 不保留上一個商品的 series 或讀值

#### Scenario: 鍵盤與輔助辨識
- **WHEN** 使用者以鍵盤操作副圖選單或以非彩色方式閱讀圖表
- **THEN** 每個選項具有可聚焦 label 與狀態
- **AND** series 以名稱、線型／標記及文字讀值共同辨識
