## MODIFIED Requirements

### Requirement: 法人買賣超副圖

系統 MUST 提供「外資買賣超＋持股」、投信買賣超、自營商買賣超及三大法人合計四個可獨立選取的法人 pane。「外資買賣超＋持股」MUST 同時顯示外資淨買賣超柱與外資及陸資持股比折線，並以獨立尺度呈現張數及百分比；其餘買賣超 pane MUST 依交易日顯示相應淨買賣超、可辨識的零軸與正負方向。自營商讀值 MUST 分辨自行買賣與避險，三大法人合計讀值 MUST 分列三個組成項。

#### Scenario: 顯示合併外資 pane
- **WHEN** 方式 B 選取「外資買賣超＋持股」，且同一日期具有外資買賣超及外資持股資料
- **THEN** 系統 MUST 在同一 pane 以正負柱顯示外資買賣超，並以折線顯示外資持股比
- **AND** 兩種數值 MUST 使用獨立 Y 軸尺度且共用同一時間軸
- **AND** 標題列讀值 MUST 顯示同一日期、外資買賣超、持股比、持股股數及資料來源

#### Scenario: 合併 pane 只有一種資料
- **WHEN** 某交易日只有外資買賣超或外資持股其中一種資料
- **THEN** 系統 MUST 繪製可用 series，缺少的欄位顯示「無資料」
- **AND** MUST NOT 以 0 或前一日資料填補缺值

#### Scenario: 同日三大法人有正負買賣超
- **WHEN** 方式 B 同時顯示合併外資、投信與自營商 pane，且某交易日外資買超、投信賣超、自營商資料完整
- **THEN** 各 pane MUST 依自己的正負值畫在零軸兩側
- **AND** 標題列讀值 MUST 顯示同一日期、對應法人張數、自營商細項與資料來源

#### Scenario: 某法人資料缺漏
- **WHEN** 某交易日只有外資與投信資料，自營商欄位為 `null`
- **THEN** 系統只畫可用 series
- **AND** 讀值將自營商標示為「無資料」，不得顯示 0 張

#### Scenario: 顯示三大法人合計
- **WHEN** 某交易日的外資、投信與自營商合計資料完整且已通過來源總計交叉驗證
- **THEN** 使用者 MUST 可建立「三大法人合計」pane
- **AND** 標題列讀值 MUST 同時顯示合計張數與三個組成分項

#### Scenario: 三大法人合計不完整
- **WHEN** 任一組成分項缺漏或與來源總計驗證不一致
- **THEN** 三大法人合計 series MUST 在該日保留 gap 或標示部分資料
- **AND** MUST NOT 顯示以零補足的錯誤合計

### Requirement: 融資融券副圖

系統 MUST 將融資與融券提供為兩個可獨立選取的 pane，分別顯示餘額，並在標題列逐日讀值提供對應的當日變化、買進／賣出／償還及資券互抵；兩個 pane MUST 共用相同 `margin-short` response，不同來源單位 MUST 在進入圖表前正規化。當日變化 MUST 以明確 `+` 或 `-` 顯示，正值為紅色、負值為綠色、零值為中性色，MUST NOT 同時顯示含混的「增減」文字。

#### Scenario: 顯示融資融券餘額
- **WHEN** 方式 B 同時勾選融資與融券，且某交易日有完整餘額
- **THEN** 系統 MUST 建立兩個具獨立 Y 軸的 pane
- **AND** 各 pane 標題列 MUST 顯示今日餘額與相對前日的明確正負變化
- **AND** `+` 變化 MUST 為紅色，`-` 變化 MUST 為綠色

#### Scenario: 商品當日不可融券或沒有融券資料
- **WHEN** 融資資料有效但融券欄位為 `null`
- **THEN** 系統仍顯示融資 series
- **AND** 融券讀值顯示「無資料」，不得畫零線誤導

### Requirement: 多層副圖高度與捲動

方式 B MUST 為主圖、技術副圖及每個籌碼 pane 保留可讀高度，並讓 panel 與頁面高度依作用中的 pane 數量自然增減；當內容超過 viewport 時，系統 MUST 以 `html/body` 的瀏覽器頁面作為唯一垂直捲動容器，`.subchart-slot`、`.chip-pane-region`、`.chip-pane-stack` 與 `.chart-panel` MUST NOT 形成可獨立垂直捲動的區域。桌面寬度的方式 B MUST 採緊湊副圖版型：技術副圖總高 MUST 介於 96–120 CSS px，每個籌碼 pane 總高 MUST 介於 88–104 CSS px；籌碼 pane MUST NOT 建立浮動 tooltip，且標題列 inline readout MUST 與標題及控制項共同使用緊湊 header，不得遮住 chart 或造成水平捲動。窄螢幕可因控制項換行放寬高度，但 MUST 避免無限制等比例壓縮。方式 A MUST 只顯示單一副圖槽位且不得出現多層 stack 或因籌碼 pane 增加額外高度；4／6／8 圖與聚焦模式 MUST 維持方式 A 的固定視窗版型。

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

#### Scenario: 從圖表內容使用垂直捲動手勢
- **WHEN** 使用者將游標或觸控位置放在主圖、技術副圖或任一籌碼 pane 上並執行垂直 wheel／touch 手勢
- **THEN** 手勢 MUST 可推進瀏覽器 document 的垂直捲動位置
- **AND** MUST NOT 被單一 chart 或 pane 的內層捲動區困住
- **AND** 水平拖曳、時間軸縮放、共用 crosshair 與標題列逐日讀值 MUST 保持可操作

#### Scenario: 2／3 圖與窄螢幕使用共同頁面捲軸
- **WHEN** 方式 B 在寬螢幕以 2／3 個 panel 並排，或在既定 breakpoint 以下改為單欄
- **THEN** 所有 panel MUST 使用同一個瀏覽器頁面垂直捲軸
- **AND** 每個 panel MUST 依自己的作用 pane 自然增高，不得建立各自的垂直捲動容器
- **AND** 頁面 MUST NOT 因 panel、價格軸、readout 或副圖內容產生非預期水平捲軸

#### Scenario: 取消中間的 pane
- **WHEN** 使用者從方式 B 多層 stack 取消一個非首尾 pane
- **THEN** 其後 pane MUST 依固定順序向上補位，panel 與 document 高度 MUST 自然縮短
- **AND** 不得改變其他 pane 的資料、尺度、勾選狀態、visible range、標題列讀值或 crosshair 同步

#### Scenario: 離開方式 B
- **WHEN** 使用者從方式 B 切到方式 A、4／6／8 圖或聚焦模式
- **THEN** 系統 MUST 移除方式 B 的長頁面與緊湊 stack 版型，恢復固定視窗與單一副圖槽位
- **AND** MUST 清理已隱藏 pane 的 listener／observer／readout 狀態，並正確 resize 保留的主圖與副圖
- **AND** 返回方式 B 後 MUST 恢復原本技術副圖狀態與完整籌碼勾選組合

### Requirement: 台股籌碼副圖選單

系統 MUST 在每個圖表面板的單一「副圖」選單中，以可辨識的「技術指標」與「籌碼資料」群組提供既有 RSI、KD、MACD、ATR，以及外資買賣超＋持股、投信買賣超、自營商買賣超、三大法人合計、融資、融券、借券、大戶持股及散戶持股選項。選單 MUST NOT 同時保留分離的「外資買賣超」與「外資持股」選項，工具列 MUST NOT 再提供獨立「籌碼」按鈕。系統 MUST 在 eligible 台股普通股與 ETF 的 `1d` 週期依 dataset 載入籌碼資料；技術指標的計算與同圖複選行為 MUST 保持不變。

#### Scenario: 從單一副圖選單選擇外資合併 pane
- **WHEN** 使用者在 eligible 普通股或 ETF 日 K 面板展開「副圖」並選擇「外資買賣超＋持股」
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
- **THEN** 系統清除舊籌碼 series 並顯示「籌碼資料僅支援日 K」
- **AND** MUST NOT 顯示先前日 K 的籌碼資料

#### Scenario: 切換到 ETF
- **WHEN** 籌碼副圖已選取且使用者切換到商品目錄確認的 TWSE／TPEx ETF 日 K
- **THEN** 系統 MUST 請求並顯示各 dataset 的獨立 availability
- **AND** 一個 pane 無資料時其他可用 pane MUST 繼續顯示

#### Scenario: 切換到真正不支援商品
- **WHEN** 籌碼副圖已選取且使用者切換到海外商品、權證、未知或停用商品
- **THEN** 系統顯示中性不適用狀態
- **AND** MUST NOT 發出籌碼上游請求

#### Scenario: 分別選擇大戶與散戶
- **WHEN** 使用者在 eligible 台股普通股或 ETF 日 K 面板選擇「大戶持股」及「散戶持股」
- **THEN** 面板 MUST 依目前模式替換單一共用槽位或建立兩個獨立週頻 pane
- **AND** 兩個顯示項目 MUST 共用 D1 中相同日期範圍的 TDCC 股權分散資料

## ADDED Requirements

### Requirement: 籌碼副圖標題列逐日讀值

同一 panel 的每個作用中籌碼 pane MUST 依共用游標日期在 pane 標題同一列顯示自己的 inline readout。readout MUST 顯示 `sessionDate`、主要 series 值、必要組成欄位、資料狀態與來源，並以間距或分隔符避免文字擠在一起；游標未作用時 MUST 顯示最新可用讀值。籌碼 pane MUST NOT 建立浮動 tooltip，亦 MUST NOT 在 chart 內容或價格軸顯示 series title／last-value 標籤。

#### Scenario: 游標移到有完整逐日資料的交易日
- **WHEN** 使用者將游標移到具有法人、融資券或 TDCC 資料的日期
- **THEN** 每個作用中籌碼 pane 的標題列 MUST 顯示同一個游標日期的自身數值
- **AND** MUST NOT 顯示資料序列最後一日的值或浮動框

#### Scenario: 游標離開 pane
- **WHEN** 游標離開 panel 或共用游標被清除
- **THEN** 每個籌碼 pane 的標題列 MUST 恢復最新可用日期與讀值
- **AND** MUST NOT 保留上一個游標日期或上一個商品的讀值

#### Scenario: 方向性數值套用正負號與顏色
- **WHEN** 買賣超、相對前日變化或週增減為正值、負值或零
- **THEN** 正值 MUST 顯示 `+` 且為紅色，負值 MUST 顯示 `-` 且為綠色，零值 MUST 使用中性色
- **AND** 融資融券變化 MUST NOT 顯示「增減」兩字取代確定方向

#### Scenario: 游標日期欄位缺漏
- **WHEN** 作用中的籌碼 pane 在游標日期只有部分欄位或指定欄位為 `null`
- **THEN** 標題列 MUST 將欄位標示為「部分資料」或「無資料」
- **AND** MUST NOT 將缺值轉成 0 或沿用其他日期數值

#### Scenario: TDCC 游標日期不是發布日
- **WHEN** 游標日期沒有對應 TDCC 實際週資料
- **THEN** 標題列 MUST 顯示游標日期與「當日無資料」
- **AND** MAY 顯示最近一筆較早的真實資料日期及比例作為參考，但 MUST 清楚標為最近一筆，且不得將其視為游標當日值

#### Scenario: 標題列寬度不足
- **WHEN** panel 寬度不足以容納標題、readout、狀態與控制項
- **THEN** readout segment MUST 依既定優先順序換行或縮短次要文字
- **AND** MUST NOT 重疊控制項、遮住 chart 或造成頁面水平捲動

## REMOVED Requirements

### Requirement: 外資持股副圖

**Reason**：外資持股已與外資買賣超整合為同一 pane，保留獨立 pane 會重複占用頁面高度。

**Migration**：已保存的 `foreign-holding` 選取狀態自動遷移為 `foreign-flow-holding`；若同時存在 `foreign-flow`，去重後只保留一張合併 pane。

### Requirement: 逐日浮動 tooltip 與共用讀值狀態

**Reason**：浮動 tooltip 會同時遮住多張 pane 的資料，改由標題列 inline readout 承接逐日資訊。

**Migration**：移除籌碼 pane tooltip DOM、CSS 與定位 API；共用十字線改為更新標題列，離開時恢復最新值。主圖與技術副圖既有讀值行為不在本次移除範圍。
