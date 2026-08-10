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
系統 MUST 以既有 `MultiChartOnCodexSite` 費波那契公式、錨點語意與視覺角色作為參考基準，並 MUST 在公式 fixture 保存 `multichart-ecae7ca-fibonacci-v2` version。回撤 MUST 使用 A／B 兩點，依 `B - r × (B - A)` 計算 `-0.62、-0.27、0、0.236、0.382、0.5、0.618、0.705、0.786、1`；拓展 MUST 使用 A／B／C 三點，依 `C + r × (B - A)` 計算 `0.618、0.705、0.786、1、1.272、1.414、1.618、2`，且 MUST NOT 產生 `-0.62`、`-0.27`。每條水準 MUST 同時保留有限價格、最多三位小數比率及百分比文字，價格顯示 MUST 沿用商品格式化規則；來源 repo MUST NOT 成為安裝、build 或 runtime dependency。

#### Scenario: 上漲或下跌波段回撤
- **WHEN** A／B 是合法有限錨點，不論 A 價格高於或低於 B
- **THEN** 系統 MUST 依同一公式產生全部十條回撤水準
- **AND** 系統 MUST NOT 假設只能由低點畫到高點或省略負比率、0.705 或任何其他指定水準

#### Scenario: 完成三點拓展
- **WHEN** A／B／C 都是合法有限錨點
- **THEN** 系統 MUST 依 A 至 B 的波段差與 C 產生全部八條拓展水準
- **AND** 結果 MUST NOT 包含 `-0.62`、`-0.27`
- **AND** 非有限結果 MUST 被拒絕，不得寫入 storage 或 renderer

#### Scenario: 舊公式資料遷移
- **WHEN** restore 讀取到合法的 `multichart-ecae7ca-fibonacci-v1` anchors
- **THEN** 系統 MUST 保留 kind、anchors 與完成 order，改以 v2 公式依 kind 重算回撤十條或拓展八條水準並安全寫回
- **AND** 系統 MUST NOT 因水準數量升級刪除合法完成圖

### Requirement: preview 與完成點選必須共用錨點吸附規則
主交易畫面與 MultiView MUST 以 kind-aware modifier policy 解析費波那契錨點，且 preview 與 click commit MUST 使用同一 resolver 與相同 time／price。回撤未按 Option／Alt 時，A MUST 吸附所點單根 K 棒 low、B MUST 吸附 high；按住 macOS Option 或 Windows Alt 時，A MUST 改吸附 high、B MUST 改吸附 low，且 A／B 仍須位於合法 K 棒。拓展未按 Option／Alt 時，A MUST 吸附 low、B MUST 吸附 high、C 在 K 棒區域 MUST 吸附 low，在未來空白區 MUST 使用游標自由價位；拓展按住 Option／Alt 時，A／B／C MUST 維持使用經 tick-size 正規化的游標自由價位並 MAY 位於空白區。吸附的 high／low 只指所點單根 K 棒，不得搜尋整段區間極值。

#### Scenario: 回撤一般 K 棒吸附
- **WHEN** 使用者未按 Option／Alt，並在合法 K 棒位置依序選取回撤 A 與 B
- **THEN** A MUST 使用第一根所點 K 棒 low，B MUST 使用第二根所點 K 棒 high
- **AND** preview 顯示價格 MUST 與完成保存價格相同

#### Scenario: 回撤 Option／Alt 反向吸附
- **WHEN** 使用者按住 macOS Option 或 Windows Alt，並在合法 K 棒位置依序選取回撤 A 與 B
- **THEN** A MUST 使用第一根所點 K 棒 high，B MUST 使用第二根所點 K 棒 low
- **AND** 系統 MUST NOT 使用游標自由價位、搜尋區間極值或改寫 K 棒資料

#### Scenario: 回撤 Option／Alt 不接受空白區
- **WHEN** 使用者按住 Option／Alt，並嘗試在沒有 K 棒的未來空白區選取回撤 A 或 B
- **THEN** 系統 MUST 保留目前 pending 錨點數並顯示該點無效
- **AND** 既有完成圖與 storage MUST 維持不變

#### Scenario: 拓展維持既有吸附與自由價位
- **WHEN** 使用者建立拓展，未按 Option／Alt 選取 A／B／C，或按住 Option／Alt 選取任一錨點
- **THEN** 未按 modifier 時 A／B／C MUST 分別使用 low／high／low，未來 C MUST 可使用游標自由價位
- **AND** 按住 Option／Alt 時 A／B／C MUST 使用經商品 tick-size 正規化的游標自由價位
- **AND** 系統 MUST NOT 建立假 candle、寫入 candle series 或觸發 history loader

#### Scenario: 兩個畫面使用相同 modifier fixture
- **WHEN** 主交易畫面與 MultiView 對相同 K 棒、raw pointer、kind、anchor index 與 `altKey` 執行 resolver fixture
- **THEN** 兩邊 MUST 產生相同 time／price 或相同無效結果
- **AND** tooltip 與 pending notice MUST 正確區分回撤反向吸附及拓展自由價位

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
費波那契 MUST 以不接收 pointer event 的 SVG overlay 顯示 1 CSS px 水平實線、1 CSS px 波段虛線、比率／價格標籤及第一張圖的相鄰色帶。第一張圖為回撤時 MUST 顯示十條分級彩色線與九個相鄰水準色帶，為拓展時 MUST 顯示八條分級彩色線與七個相鄰水準色帶，並沿用既有七個比率在各種類中的色彩；回撤新增的 `-0.62`、`-0.27` 與兩種類皆新增的 `0.705` MUST 分別使用固定色 `#a78bfa`、`#e879f9`、`#f472b6`，band opacity MUST 維持 `0.12` 深色主題基準。第二張 MUST 使用 `#cbd5e1` 單色且不得建立 band polygon，pending MUST 使用 `0.72` opacity。回撤水準由 A／B 較左位置、拓展水準由 B／C 較左位置向右延伸至價格軸安全邊界前。time scale 平移／縮放、price scale 變更、resize、history paging 及 current bar 更新後 MUST 由 canonical anchors 重新換算座標。

未固定 preview 錨點 MUST 使用約 10 CSS px、前景與 halo 可見線寬皆為 1 CSS px 的小型十字且不得同時顯示圓形；已固定及 completed 錨點 MUST 使用半徑 4 CSS px、框線約 1.25 CSS px 的透明空心圓，圓內不得顯示 A／B／C。待選價位導引 MUST 使用高對比藍色 `#38bdf8`、1.5 CSS px 實線、4 CSS px 深色 halo 與等寬數字標籤。非深色主題 MAY 使用同等對比的 theme token，但 MUST 保留依種類分級／單色順序及線型、文字、形狀等非純顏色辨識。

所有 SVG／autoscale 重繪排程 MUST 綁定 `chart identity + panelInstanceId + generation` 並採 latest-wins；`panelInstanceId` MUST 在每次 `CandleChart` mount 唯一且不得持久化。callback 執行前 MUST 驗證目前 identity、panelInstanceId、generation 與 host 仍有效。clear、換 identity、destroy 或 unmount MUST 取消排程並移除 SVG／helper，舊 callback 不得重建已移除註記。

#### Scenario: 完成拓展超出 K 棒範圍
- **WHEN** completed extension 的任一水準超出目前 K 線價格範圍
- **THEN** 系統 MAY 以透明 helper 納入八條完成水準的有限最低與最高值，使全部水準可見
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
- **THEN** 水平線、依種類產生的九個或七個色帶與標籤 MUST 停在價格軸安全邊界前，必要時標籤 MAY 移到線內側
- **AND** renderer MUST NOT 遮住價格刻度、攔截十字線、縮放、平移或委託線操作

### Requirement: 完成圖必須依身份安全保存並維持多圖隔離
completed 回撤與拓展 MUST 以版本化 schema 依 `security_type`、exchange、canonical contract code 及 timeframe minutes 保存於瀏覽器本機；pending MUST NOT 保存。切換商品或 timeframe MUST 取消舊 pending，但不得刪除舊 identity 的合法 completed；切回原 identity 時 MUST 還原其 kind、canonical anchors、order 及依種類重算的回撤十條或拓展八條水準。讀取時 MUST 驗證版本、有限 anchors、所需點數、每類最多一張及 order，損毀資料不得使圖表失敗或清除其他 identity。每個 chart 的 controller、renderer、listener、generation 與 cleanup MUST 隔離。

#### Scenario: 切換時間級別後切回
- **WHEN** 使用者在目前商品某一 timeframe 完成費波那契，切換到另一 timeframe 後再切回
- **THEN** 系統 MUST 還原原 timeframe 的合法回撤與拓展，並維持其完成順序及彩色／單色角色
- **AND** 另一 timeframe 的錨點、SVG、helper 或 pending MUST NOT 混入

#### Scenario: 換商品或重載
- **WHEN** 使用者切換商品或重新載入頁面
- **THEN** 系統 MUST 取消舊 pending，並只還原新 identity 的合法 completed 回撤與拓展
- **AND** 舊 identity 的 SVG、helper、listener 或錨點 MUST NOT 殘留

#### Scenario: storage 損毀或寫入失敗
- **WHEN** storage 無法解析、版本不相容、anchors 非法、同類重複或 localStorage 寫入失敗
- **THEN** 系統 MUST 只忽略／正規化該 identity 的無效資料，主圖及其他指標 MUST 繼續運作
- **AND** 寫入失敗時目前 session MAY 保留記憶體完成圖，但 UI MUST 顯示不含原始內容的「繪圖未保存」安全提示

#### Scenario: 多圖隔離
- **WHEN** 畫面同時存在 1、2、4 或 8 張不同商品／時框圖，並快速啟動、取消、完成或清除費波那契
- **THEN** 每張圖 MUST 只更新符合自身 identity 或明確目前商品全部清除事件的 pending 與 completed overlay
- **AND** 不得跨商品複製或刪除錨點、交換完成順序、重複 listener 或讓舊 generation 重建已清除圖形

### Requirement: 費波那契必須可分種類清除且不影響其他功能
系統 MUST 提供「清除回撤」、「清除拓展」及「全部清除」操作。「清除回撤」與「清除拓展」MUST 只移除目前商品、目前 timeframe 的指定 completed kind、SVG、autoscale helper 與相應 storage；不得移除另一種類。「全部清除」MUST 取消目前操作圖的 pending，並移除目前商品所有 timeframe 的回撤與拓展、相應 storage、SVG 及 autoscale helper；不得清除其他商品或任何非費波那契內容。同頁其他已掛載且顯示相同商品的圖表 MUST 即時反映全部清除。

#### Scenario: 只清除目前時間級別的一種類型
- **WHEN** 目前商品、目前 timeframe 的回撤與拓展都存在，使用者選擇「清除回撤」或「清除拓展」
- **THEN** 系統 MUST 只移除目前 identity 的指定種類及其保存資料
- **AND** 留下的單張圖 MUST 成為彩色有色帶的第一張圖，其他 timeframe 的同種類 MUST 保留

#### Scenario: 清除目前商品所有時間級別
- **WHEN** 使用者在任一 timeframe 選擇「全部清除」
- **THEN** 系統 MUST 只清除目前 canonical 商品在所有 timeframe 保存及已掛載的回撤與拓展
- **AND** 切換至該商品其他 timeframe 時 MUST 不再還原已清除圖形

#### Scenario: 全部清除不得影響其他資料
- **WHEN** 目前商品與其他商品均有繪圖，且畫面另有價格範圍、Pivot、Volume Profile、技術指標、委託線或交易狀態
- **THEN** 「全部清除」MUST 保留其他商品全部繪圖及所有非費波那契內容
- **AND** simulation／production 模式、交易狀態、K 線與行情資料 MUST 完全不變
