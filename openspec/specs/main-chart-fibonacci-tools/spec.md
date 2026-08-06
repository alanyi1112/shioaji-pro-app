# main-chart-fibonacci-tools Specification

## Purpose
TBD - created by archiving change integrate-multichart-fibonacci-tools. Update Purpose after archive.
## Requirements
### Requirement: 主圖必須提供獨立的費波那契回撤與拓展工具
系統 MUST 在每個 `CandleChart` 提供「費波那契回撤」與「費波那契拓展」入口，且初始都 MUST 未進入選點狀態。啟動回撤 MUST 等待 A／B 兩點；啟動拓展 MUST 等待 A／B／C 三點，UI MUST 顯示目前工具及剩餘錨點數。工具狀態不得修改 MA、BOLL、FVG、Volume Profile、Pivot 或副圖指標的選取。

#### Scenario: 啟動回撤
- **WHEN** 使用者選擇「費波那契回撤」
- **THEN** 系統 MUST 進入等待 A／B 兩點的 pending 狀態並顯示剩餘點數
- **AND** 主 K 線、既有指標、委託線與已完成註記 MUST 維持可見

#### Scenario: 啟動拓展
- **WHEN** 使用者選擇「費波那契拓展」
- **THEN** 系統 MUST 進入等待 A／B／C 三點的 pending 狀態並顯示剩餘點數
- **AND** 新 pending MUST 取代同一 panel 的其他未完成繪圖，但不得刪除任何完成圖

### Requirement: 回撤與拓展必須使用最新版來源 repo 的固定公式及水準
系統 MUST 以 `MultiChartOnCodexSite` commit `ecae7cac837f06085801c96f3da0c570051d66e7` 的 `public/static/chart-annotations.js`、`public/static/app.js`、正式 Fibonacci specs 與測試作為完整參考基準，並 MUST 在公式 fixture 保存 `multichart-ecae7ca-fibonacci-v1` version。回撤 MUST 使用 A／B 兩點，依 `B - r × (B - A)` 計算 0、0.236、0.382、0.5、0.618、0.786、1；拓展 MUST 使用 A／B／C 三點，依 `C + r × (B - A)` 計算 0.618、0.786、1、1.272、1.414、1.618、2。每條水準 MUST 同時保留有限價格、最多三位小數比率及百分比文字，價格顯示 MUST 沿用商品格式化規則；來源 repo MUST NOT 成為安裝、build 或 runtime dependency。

#### Scenario: 上漲或下跌波段回撤
- **WHEN** A／B 是合法有限錨點，不論 A 價格高於或低於 B
- **THEN** 系統 MUST 依同一公式產生全部七條回撤水準
- **AND** 系統 MUST NOT 假設只能由低點畫到高點或省略任何水準

#### Scenario: 完成三點拓展
- **WHEN** A／B／C 都是合法有限錨點
- **THEN** 系統 MUST 依 A 至 B 的波段差與 C 產生全部七條拓展水準
- **AND** 非有限結果 MUST 被拒絕，不得寫入 storage 或 renderer

### Requirement: preview 與完成點選必須共用錨點吸附規則
未按 Option／Alt 時，A MUST 吸附所點 K 棒 low、B MUST 吸附 high；拓展 C 在 K 棒區域 MUST 吸附 low，在未來空白區 MUST 使用游標自由價位。A／B 位於空白區時 MUST 視為無效。按住 macOS Option 或 Windows Alt 時，A／B／C MUST 使用經 tick-size 正規化的游標自由價位，並 MAY 位於空白區。preview 與 click commit MUST 使用同一 resolver 與相同 time／price。

#### Scenario: 一般 K 棒吸附
- **WHEN** 使用者未按 Option／Alt，並在合法 K 棒位置依序選取 A、B 及拓展 C
- **THEN** A MUST 使用該 K 棒 low、B MUST 使用 high、C MUST 使用 low
- **AND** preview 顯示價格 MUST 與完成保存價格相同

#### Scenario: 自由價位與未來空白區
- **WHEN** 使用者按住 Option／Alt 選取任一錨點，或在拓展 C 階段選取未來空白區
- **THEN** 系統 MUST 使用可換算的 time 與經商品 tick-size 正規化的游標價位
- **AND** 系統 MUST NOT 建立假 candle、寫入 candle series 或觸發 history loader

#### Scenario: 無效空白區點選
- **WHEN** 使用者未按 Option／Alt，且 A 或 B 點在沒有 K 棒的位置
- **THEN** 系統 MUST 保留目前 pending 錨點數並顯示該點無效
- **AND** 既有完成圖與 storage MUST 維持不變

### Requirement: pending 預覽必須即時、可取消且不污染價格尺度
pending 狀態 MUST 顯示下一錨點 A／B／C、暫態波段導引線及目前可計算的水準。合法 `pending.preview` MUST 同時驅動從 plot 左緣延伸至價格軸安全邊界的獨立待選價位實線，右端內側 MUST 顯示 `待選 A／B／C｜格式化價格`；該時間／價格 MUST 與 click commit 共用同一 resolver 結果。滑鼠離開有效 plot、按 Escape、換商品／時框、啟動其他工具或切換交易模式時 MUST 清除 preview 或取消 pending。pending 資料 MUST NOT 寫入 localStorage、完成註記或 autoscale helper，也不得改寫原生十字線或其他 pane 的同步讀值。

#### Scenario: 游標預覽下一點
- **WHEN** pending 工具收到合法游標座標但尚未點選
- **THEN** SVG MUST 顯示目前下一錨點、`待選 A／B／C｜格式化價格` 全寬價位導引與可計算的暫態內容
- **AND** 游標移動 MUST NOT 改變 K 線價格尺度、bar spacing 或可視時間範圍

#### Scenario: 待選價位與吸附後錨點一致
- **WHEN** 未按 Option／Alt 的 preview 經 resolver 吸附到 K 棒 low／high，或自由價位經 tick-size 正規化
- **THEN** 待選價位導引、preview 十字及隨後 click commit MUST 使用相同 time／price
- **AND** 同一 formatter 顯示的待選價格 MUST 與完成後該錨點價格相同

#### Scenario: Escape 取消
- **WHEN** 使用者在錨點尚未選滿時按 Escape
- **THEN** 系統 MUST 回到 idle 並移除 preview、pending anchor 與提示
- **AND** MUST NOT 建立不完整完成圖、改寫 storage 或移除既有完成圖

### Requirement: 繪圖輸入與點價／交易模式必須互斥
啟動任一費波那契工具 MUST 先將圖表切回游標觀察模式，並取消固定區間、Pivot 或其他未完成選點。pending 存在時，合法主圖 pointer move／click MUST 先交給 annotation controller：pointer move 不得同步訂單面板點價，click 只能加入錨點，不得同步點價、送出委託、建立停損／停利或新增警示。使用者切換到買、賣、停損、停利、警示或其他選點工具時，系統 MUST 先取消 Fibonacci pending，再啟動所選模式；完成圖保持可見。

#### Scenario: 繪圖點擊不得送單
- **WHEN** 回撤或拓展處於 pending，使用者點選 A、B 或 C
- **THEN** 系統 MUST 只新增費波那契錨點
- **AND** `placeQuickOrder`、`addTrigger` 及其他交易副作用 MUST NOT 被呼叫

#### Scenario: 繪圖游標移動不得同步訂單點價
- **WHEN** 回撤或拓展處於 pending，使用者在主圖移動游標或預覽吸附價位
- **THEN** 系統 MUST 只更新 Fibonacci preview 與待選價位導引
- **AND** `setPickedPrice` MUST NOT 被呼叫，訂單面板價格 MUST 維持進入繪圖前的狀態

#### Scenario: 使用者改選交易模式
- **WHEN** pending 尚未完成，使用者選擇點價買賣、停損、停利或警示
- **THEN** pending MUST 先被取消，交易模式才 MAY armed
- **AND** 先前已完成的回撤與拓展 MUST 維持可見且不得攔截後續交易 click

### Requirement: 回撤與拓展必須各保留一張並依完成順序呈現
同一 canonical contract identity 與 timeframe 最多 MUST 保留一張回撤及一張拓展。完成新圖時 MUST 只取代相同種類的舊圖；較早完成者 MUST 使用分級彩色、相鄰半透明色帶與彩色標籤，較晚完成者 MUST 使用一致單色線、單色標籤及單色導引線，且 MUST NOT 建立區間色帶。

#### Scenario: 兩種圖先後完成
- **WHEN** 使用者先完成一種類型，再完成另一種類型
- **THEN** 兩張圖 MUST 同時存在，較早者彩色且有色帶，較晚者單色且無色帶
- **AND** renderer 重繪、reload 或 resize 不得交換兩者完成順序

#### Scenario: 重畫相同種類
- **WHEN** 回撤與拓展都存在，使用者重畫其中一種
- **THEN** 系統 MUST 只取代同種類舊圖，未重畫者成為較早彩色圖，新圖成為較晚單色圖
- **AND** 另一種類的 anchors MUST 完整保留

### Requirement: 費波那契 overlay 必須符合來源視覺並安全重繪
費波那契 MUST 以不接收 pointer event 的 SVG overlay 顯示 1 CSS px 水平實線、1 CSS px 波段虛線、比率／價格標籤及第一張圖的相鄰色帶。第一張七級色票 MUST 以來源的 `#fb7185`、`#fb923c`、`#facc15`、`#84cc16`、`#2dd4bf`、`#22d3ee`、`#818cf8` 與 `0.12` band opacity 為深色主題基準；第二張 MUST 使用 `#cbd5e1` 單色且不得建立 band polygon，pending MUST 使用 `0.72` opacity。回撤水準由 A／B 較左位置、拓展水準由 B／C 較左位置向右延伸至價格軸安全邊界前。time scale 平移／縮放、price scale 變更、resize、history paging 及 current bar 更新後 MUST 由 canonical anchors 重新換算座標。

未固定 preview 錨點 MUST 使用約 10 CSS px、前景與 halo 可見線寬皆為 1 CSS px 的小型十字且不得同時顯示圓形；已固定及 completed 錨點 MUST 使用半徑 4 CSS px、框線約 1.25 CSS px 的透明空心圓，圓內不得顯示 A／B／C。待選價位導引 MUST 使用高對比藍色 `#38bdf8`、1.5 CSS px 實線、4 CSS px 深色 halo 與等寬數字標籤。非深色主題 MAY 使用同等對比的 theme token，但 MUST 保留七級／單色順序及線型、文字、形狀等非純顏色辨識。

所有 SVG／autoscale 重繪排程 MUST 綁定 `chart identity + panelInstanceId + generation` 並採 latest-wins；`panelInstanceId` MUST 在每次 `CandleChart` mount 唯一且不得持久化。callback 執行前 MUST 驗證目前 identity、panelInstanceId、generation 與 host 仍有效。clear、換 identity、destroy 或 unmount MUST 取消排程並移除 SVG／helper，舊 callback 不得重建已移除註記。

#### Scenario: 完成拓展超出 K 棒範圍
- **WHEN** completed extension 的最低或最高水準超出目前 K 線價格範圍
- **THEN** 系統 MAY 以透明 helper 納入完成圖的最低與最高水準，使七線可見
- **AND** pending preview MUST NOT 使用 helper；清除、換 identity 或 destroy 後 MUST 移除相應 autoscale 範圍

#### Scenario: 費波那契選點標記不遮蔽目標價位
- **WHEN** 任一 Fibonacci 工具進入 pending
- **THEN** 主圖 K 線以外的可見價格 LineSeries MUST 暫時關閉原生實心 crosshair marker，preview MUST 顯示小型十字
- **AND** complete、cancel、clear、identity restore 或 unmount 後 MUST 精確還原各 series 原本的 marker 設定並移除 preview 十字

#### Scenario: 舊 generation 排程晚到
- **WHEN** 使用者快速換商品／時框、清除註記或卸載 panel，而舊 SVG／helper callback 尚在佇列
- **THEN** 舊 callback MUST 被取消或丟棄
- **AND** 新 identity MUST NOT 短暫顯示舊錨點、helper、marker 狀態或重複 listener

#### Scenario: 標籤與價格軸安全邊界
- **WHEN** 可見 plot 空間有限或比率／價格標籤接近價格軸
- **THEN** 水平線、色帶與標籤 MUST 停在價格軸安全邊界前，必要時標籤 MAY 移到線內側
- **AND** renderer MUST NOT 遮住價格刻度、攔截十字線、縮放、平移或委託線操作

### Requirement: 完成圖必須依身份安全保存並維持多圖隔離
completed 回撤與拓展 MUST 以版本化 schema 依 `security_type`、exchange、canonical contract code 及 timeframe minutes 保存於瀏覽器本機；pending MUST NOT 保存。讀取時 MUST 驗證版本、有限 anchors、所需點數、每類最多一張及 order，損毀資料不得使圖表失敗或清除其他 identity。每個 chart 的 controller、renderer、listener、generation 與 cleanup MUST 隔離。

#### Scenario: 換商品、換時框或重載
- **WHEN** 使用者切換商品／時框或重新載入頁面
- **THEN** 系統 MUST 取消舊 pending，並只還原新 identity 的合法 completed 回撤與拓展
- **AND** 舊 identity 的 SVG、helper、listener 或錨點 MUST NOT 殘留

#### Scenario: storage 損毀或寫入失敗
- **WHEN** storage 無法解析、版本不相容、anchors 非法、同類重複或 localStorage 寫入失敗
- **THEN** 系統 MUST 只忽略／正規化該 identity 的無效資料，主圖及其他指標 MUST 繼續運作
- **AND** 寫入失敗時目前 session MAY 保留記憶體完成圖，但 UI MUST 顯示不含原始內容的「繪圖未保存」安全提示

#### Scenario: 多圖隔離
- **WHEN** 畫面同時存在 1、2、4 或 8 張不同商品／時框圖，並快速啟動、取消、完成或清除費波那契
- **THEN** 每張圖 MUST 只更新自身 identity 的 pending 與 completed overlay
- **AND** 不得跨圖複製錨點、交換完成順序、重複 listener 或讓舊 generation 重建已清除圖形

### Requirement: 費波那契必須可分種類清除且不影響其他功能
系統 MUST 提供清除回撤、清除拓展及清除全部費波那契的操作。清除 MUST 同步移除相應 completed state、SVG、autoscale helper 與該 identity storage；不得移除另一種類、Pivot、其他主圖／副圖指標、委託線、觸價條件或 K 線資料。

#### Scenario: 只清除一種類型
- **WHEN** 回撤與拓展都存在，使用者選擇只清除其中一種
- **THEN** 系統 MUST 只移除指定種類及其保存資料
- **AND** 留下的單張圖 MUST 成為彩色有色帶的第一張圖

#### Scenario: 清除全部費波那契
- **WHEN** 使用者選擇清除全部費波那契
- **THEN** 系統 MUST 回到 idle 並移除兩種類型、preview、helper 與該 identity storage
- **AND** simulation／production 模式、交易狀態與其他圖表功能 MUST 完全不變
