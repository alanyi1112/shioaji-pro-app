## Context

來源 repo `MultiChartOnCodexSite` 的 GitHub 預設 `main` 目前為 `2d09253f710de1126a0ca841bfb0645125b2ed31`，所有遠端 refs 中較新的可驗證工作版本為 `ecae7cac837f06085801c96f3da0c570051d66e7`。兩版 `public/static/chart-annotations.js` 與 `openspec/specs/main-chart-fibonacci-tools/spec.md` blob 相同；新版 `public/static/app.js` 另有 active panel、generation、requestAnimationFrame cleanup 等生命週期修正。本 change 固定以 `ecae7ca` 命名 `multichart-ecae7ca-fibonacci-v1` formula／interaction version，並以該版完整 controller、renderer、style 與測試為參考，不在 runtime 依賴來源 repo。

RealTimeStock 的 `CandleChart` 由 Lightweight Charts canvas 顯示 K 線，現有 `chart.subscribeClick` 同時負責固定區間／Pivot 選點、游標價位同步、點價買賣、停損、停利與警示，`subscribeCrosshairMove` 也會持續呼叫 `setPickedPrice`。這是本 change 最重要的安全邊界：費波那契若沒有明確狀態機與 pointer move／click 優先權，可能把繪圖動作誤當成點價或交易操作。已歸檔的 `integrate-multichart-technical-indicators` 已建立 typed overlay lifecycle、generation guard、browser harness 與穩定資料更新，本 change 只在該基礎上加入互動式 annotation。

## Goals / Non-Goals

**Goals:**

- 以來源 repo 的固定水準、公式與錨點行為建立可追溯的費波那契回撤／拓展。
- 讓 pending、completed、cancel、clear、restore 成為可單元測試的純狀態機。
- 讓 overlay 隨 time scale、price scale、resize、history paging 與 current bar 更新保持對齊。
- 讓每張圖依商品與時框隔離完成圖，並確保多圖快速操作沒有跨 panel 污染。
- 以明確模式切換保證費波那契點擊不可能送出委託或建立觸價警示。

**Non-Goals:**

- 不把費波那契註冊成可重複加入的技術指標 instance。
- 不新增價格範圍、固定區間 Volume Profile、任意線段或文字註記。
- 不新增通用 PNG 匯出、雲端同步、後端 storage 或分享連結。
- 不變更 Shioaji simulation／production 設定、下單 API 或風險檢查。

## Decisions

### 使用純 controller 與無事件 SVG renderer

建立 versioned annotation controller，狀態分為 `idle`、`pending-retracement`、`pending-extension` 與 completed collection。controller 只接受已正規化的 `{time, price}`、identity 及操作命令，不直接存取 chart、DOM 或網路。renderer 只讀 controller snapshot，建立覆蓋於主圖 plot 的 React 管理 SVG，並固定 `pointer-events: none`；所有 pointer／keyboard event 仍由 `CandleChart` 單一協調層處理。

回撤公式固定為 `B - ratio × (B - A)`；拓展固定為 `C + ratio × (B - A)`。計算只接受有限 time／price，顯示比率最多三位小數，價格沿用商品 tick-size／格式化規則。公式 fixture 鎖定 `multichart-ecae7ca-fibonacci-v1`，不在 runtime 依賴另一個 repo。

renderer snapshot 與重繪排程帶入 `chart identity + panelInstanceId + generation`；`panelInstanceId` 是每次 `CandleChart` mount 產生且不持久化的唯一值。time scale、price scale、ResizeObserver、history paging 或 current bar 只能排入 latest-wins requestAnimationFrame；callback 執行前必須確認 identity、panelInstanceId、generation 與 host 仍有效，clear、換 identity 或 unmount 必須取消排程並移除 SVG／helper，避免舊 panel callback 重建註記。

### 錨點解析與預覽共用同一規則

一般操作時，A 取所點 K 棒 low、B 取 high；拓展 C 在 K 棒區域取 low，在未來空白區保留游標自由價位。A／B 點在空白區時視為無效。按住 Option／Alt 時 A／B／C 都使用游標換算價位，並允許空白區；controller 保存的 preview 與 click commit 必須來自同一 resolver，避免畫面提示與實際錨點不同。

空白區 time 由目前 time scale logical coordinate 與 timeframe 間距換算成穩定 timestamp，只用於 annotation 座標，不加入 candle series、不觸發 history loader。換算失敗時該點無效，不猜測時間。

### 待選價位導引與錨點形狀沿用最新版來源契約

合法 `pending.preview` 是待選價位導引、preview 十字與 click commit 的唯一資料來源。導引線從 plot 左緣延伸至價格軸安全邊界，使用高對比藍色 `#38bdf8`、1.5 CSS px 實線與 4 CSS px 深色 halo；右端內側顯示等寬數字的 `待選 A／B／C｜格式化價格`。它不改寫 Lightweight Charts 原生十字線，不廣播到其他 pane，也不進 autoscale／storage。

pending preview 錨點使用約 10 CSS px、前景與 halo 可見線寬皆為 1 CSS px 的小型十字，不再顯示圓形；已固定及 completed 錨點使用半徑 4 CSS px、框線 1.25 CSS px 的透明空心圓，圓內不顯示 A／B／C。費波那契 pending 期間暫時關閉主圖 K 線以外所有可見價格 LineSeries 的實心 crosshair marker，並記住各 series 原始設定；complete、cancel、clear、identity restore 或 unmount 後精確還原。

### 繪圖狀態與交易模式互斥

啟動回撤或拓展前，`CandleChart` 必須切回 `observe`，清除任何 armed buy／sell／stop／take／alert one-shot mode及固定區間／Pivot pending selection，再顯示明確的「繪圖中」提示。pending 存在時，單一 dispatcher 必須先處理 preview／anchor；pointer move 與合法 chart click 都不得呼叫 `setPickedPrice`，click 也不得呼叫 `placeQuickOrder` 或 `addTrigger`。使用者主動切換到任一交易／警示或其他選點工具時，先取消 Fibonacci pending 再 armed 該模式；完成的費波那契圖保持可見。Escape 只取消 pending，不影響完成圖、委託線或其他指標。

### 回撤與拓展各保留一張並依完成順序分色

同一 identity 最多保存一張 retracement 與一張 extension。重畫同類型只取代該類型，另一類保留；新完成者取得較新的 order。單張或較早完成者使用來源七色 `#fb7185`、`#fb923c`、`#facc15`、`#84cc16`、`#2dd4bf`、`#22d3ee`、`#818cf8` 與 `0.12` 透明度相鄰色帶；較晚完成者使用 `#cbd5e1` 單色線、單色標籤與單色波段導引線，不建立 band polygon。pending 使用 `0.72` 透明度；回撤／拓展完成導引線分別以 `#f8fafc`／`#d8b4fe` 為基準。非深色主題可使用具同等順序與對比的 theme token，但 MUST 保存七級／單色角色與非純顏色辨識。這能沿用來源辨識方式並避免兩組色帶遮住 K 線。

### 本機保存採 identity 隔離與失敗降級

storage key 由 schema version、`security_type`、`exchange`、canonical contract code 及 timeframe minutes 組成；不保存帳戶、委託、成交或 API 資訊。只有 completed 圖寫入，pending preview 永不持久化。讀取時執行 runtime validation、有限值檢查、每類去重及 order 正規化；損毀資料只移除該 identity 的註記並顯示安全 reason code，不得清空其他 localStorage。

localStorage 寫入失敗時，完成圖在目前記憶體 session 仍可使用，但 UI 必須提示「繪圖未保存」；不得輸出原始 storage 內容。換商品／時框會取消 pending、切換 controller identity 並只載入新 identity 的完成圖。

### pending 不進 autoscale，完成拓展才有界納入

pending 水準、preview 錨點與待選價位導引只存在 SVG，不建立 autoscale helper，游標移動不得讓價格軸跳動。只有 completed extension 可用兩條透明、無 marker 的 helper series，在 B／C 時間納入七線最低／最高水準；retracement 不額外擴張。helper 以 levels／anchors signature 避免 current bar 重複 `setData`。清除、換 identity 或 destroy 必須移除 helper。所有 render callback 使用目前 generation，舊 callback 不得重建已清除 overlay。

### 與來源 repo 的差異必須是明確的 RealTimeStock 適配

來源把 Fibonacci 與價格範圍放在同一 controller、以 canonical symbol／interval 保存，並可將 completed SVG 合成進 panel PNG。RealTimeStock 第一階段維持已核准範圍：不納入價格範圍與 PNG 匯出；storage identity 額外包含 `security_type`、exchange 與 timeframe minutes，避免相同 code 在不同市場碰撞；清除 UI 額外提供 retracement、extension 及 all 三種粒度；交易模式互斥與 `setPickedPrice` 封鎖則是來源 repo 沒有交易 click 時不需要、但 RealTimeStock 必須新增的安全適配。這些差異不得改變來源公式、錨點、待選導引、雙圖順序或視覺契約。

## Risks / Trade-offs

- [圖表 click 同時負責下單] → 繪圖與交易模式互斥、單一 click dispatcher、simulation component test 驗證任何繪圖點擊都不呼叫下單或 trigger。
- [Canvas 與 SVG 座標漂移] → 訂閱 time scale、price scale、ResizeObserver 及資料 generation；renderer 每次由 canonical anchors 重算，不保存像素座標。
- [期貨或股票 tick-size 不同] → 錨點保存原始有限價格，標籤依 contract formatter 顯示；自由價位 commit 前使用既有 `roundToTick`。
- [兩張圖色帶遮蔽 K 線] → 只有較早完成的彩色圖建立半透明 bands，較晚單色圖只畫線。
- [localStorage 損毀或 quota 失敗] → identity 級 validation、記憶體 fallback 與安全提示，不輸出資料內容。

## Migration Plan

1. 先加入來源公式、錨點 resolver 與 controller fixture，不接圖表 click。
2. 建立 versioned identity storage、損毀降級及 retracement／extension 共存測試。
3. 加入 SVG renderer、固定色票、色帶、標籤、待選價位導引、preview 十字、crosshair marker 切換與 completed-extension-only autoscale。
4. 將工具入口、Escape、清除與單一 click dispatcher 接入 `CandleChart`，完成交易模式互斥。
5. 驗證換商品／時框、history paging、resize、1／2／4／8 圖隔離及 localStorage reload。
6. 執行完整 unit、browser、build、OpenSpec strict、diff check 與本機 simulation 可見驗收；目前 repo 沒有 `lint` script，不得把不存在的 `pnpm run lint` 列為通過條件，除非另有明確 tooling task 新增。

## Open Questions

- 無阻擋問題。通用 panel PNG 匯出目前不存在，維持明確 non-goal；未來若建立匯出 capability，必須把可見費波那契 SVG 一併合成。
