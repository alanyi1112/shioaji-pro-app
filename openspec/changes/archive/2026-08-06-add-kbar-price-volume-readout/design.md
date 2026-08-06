## Context

`CandleChart` 已將 Shioaji 1 分 K 聚合為目前選取的 1m、5m、15m、60m 或 1D `Candle[]`，並以 `barsRef` 作為圖上 K 棒與成交量的 canonical 資料。lightweight-charts 的 `subscribeCrosshairMove` 目前會以 `requestAnimationFrame` 節流技術指標 legend 更新，但 readout 只認得技術指標 series，沒有直接顯示 K 棒 OHLCV。

現行 `IndicatorDef` 假設每一項都有 `outputs`、`compute()` 與至少一個 lightweight-charts series；選擇器也允許同類型重複加入，legend 順序直接採用 instance 陣列順序。新的 K 棒價量功能要出現在同一個選擇器並沿用持久化、隱藏、移除及時框可見性，卻不能建立假的透明 series，也不能讓一般排序把時間區間列移出最上方。

另一個尚未實作的 change `integrate-multichart-technical-indicators` 也可能調整 indicator definition 與 instance store。本 change 維持獨立需求與驗收，不修改該 change 的 artifact；若兩者先後實作，後實作者必須保留本 change 的 readout discriminant 與固定置頂契約。

## Goals / Non-Goals

**Goals:**

- 在「主圖疊加」提供單一實例的「K 棒價量」，並以時間區間取代 legend 中的功能名稱。
- 由 crosshair time 查找目前圖表 canonical candle，顯示正確時框聚合後的開、高、低、收／最新及量。
- 固定放在主圖顯示數值區第一列，同時維持每張圖的游標與讀值隔離。
- 在日內 K 線跨越台灣顯示日期時，以較粗的垂直線清楚標示兩日邊界，並對齊主圖與副圖 pane。
- 明確區分歷史已收線與可證明仍形成中的最新 K 棒，不把「陣列最後一根」直接等同未收線。
- 不增加行情 API、外部資料來源、圖表 series 或交易權限。

**Non-Goals:**

- 不修改 OHLCV 聚合公式、K 棒資料來源、右上角行情摘要或成交量累加規則。
- 不增加漲跌幅、振幅、成交金額、買賣價、逐筆明細或 K 棒倒數計時。
- 不把 readout 複製到副圖，也不改變 MA、BOLL、Pivot 或其他技術指標公式。
- 不把 1D 圖的每一根日 K 間隔全部改成粗線；跨日粗分隔線只用於同一張日內圖中相鄰 candle 的顯示日期改變處。
- 不依賴 `integrate-multichart-technical-indicators` 完成後才可運作。

## Decisions

### 以 typed readout definition 擴充指標目錄

將定義模型改為可辨識 union：一般技術指標維持 `kind: 'series'` 的 `outputs` 與 `compute()`；K 棒價量使用 `kind: 'readout'`，只宣告 picker metadata、單一實例限制及可用設定。renderer、選擇器與設定視窗先依 `kind` 分流，readout 不得呼叫 `compute()` 或新增透明 series。

替代方案是在既有 `IndicatorDef` 放入空 output 或假的不可見線。這會破壞目前直接讀取 `outputs[0]` 的假設，也可能污染 autoscale、crosshair seriesData 與後續 migration，因此不採用。

### legend 第一欄只顯示時間區間

選擇器名稱使用「K 棒價量」，搜尋別名包含「價量、OHLCV、開高低收、時間區間」；但圖上的 readout 不顯示「K 棒價量」或「回報價量」字樣。第一欄直接顯示區間，例如：

- 1m：`09:48:00–09:48:59`
- 5m：`09:45–09:49`
- 60m：`09:00–09:59`
- 跨日期的日內區間：起訖兩端都帶 `MM/DD`
- 1D：顯示該 K 棒代表的台灣交易日期，例如 `2026/08/06`

時間一律依圖表既有的台灣市場 wall-clock 語意格式化，不以瀏覽器所在時區重新解讀。完整起訖 timestamp 放在可存取的 `title`／accessible name；視覺格式可依空間採上述固定短格式，但不得只顯示游標目前時刻。

### 以 pane primitive 繪製 2 CSS px 跨日分隔線

目前 `grid.vertLines` 只能設定所有垂直格線的共同樣式，不能只加粗日期邊界。新增受控 `DayBoundaryPrimitive`，從依 time 排序的 canonical intraday candles 產生台灣顯示日期 key；相鄰 candle 的 key 改變時，將分隔線畫在前一根與新日期第一根 candle 的 X 座標中點，避免線條穿過 K 棒本體。期貨／選擇權夜盤跨午夜時也依顯示日期改變建立邊界，不改寫其交易日歸屬或 OHLCV。

線寬固定為 2 CSS px，顏色沿用目前 theme 的 grid color，並在 pane background layer 繪製；高 DPI canvas 依 pixel ratio 換算，視覺粗細不得因螢幕倍率改變。每個現存 pane 都附加同一組 boundary primitive view，使主圖、成交量區與技術副圖垂直對齊。primitive 不提供 hit test、標籤或 autoscale contribution，因此不得遮擋 K 棒、改變價格尺度或攔截 crosshair／圖表點擊。

歷史初載、history paging、時框或商品切換會重建 boundary keys；平移、縮放與 resize 只重新換算可見 X 座標。新增、移除或重排副圖 pane 時 reconcile primitive attachment，chart destroy 時全部 detach。1D 圖不另畫每根 K 棒間的粗線，避免所有間隔都被強調而失去「跨日群組」語意。

### 以 crosshair time 查 canonical OHLCV

crosshair callback 保存目前選取的 logical time，再由依 `barsRef` 建立的 time index 查找 `Candle`。讀值不得從右上角 snapshot、座標換算價格或技術指標 seriesData 拼湊。這能確保 5m、15m、60m、1D 都顯示畫面同一根聚合 K 棒的 OHLCV，也讓游標位於共享時間軸的副圖 pane 時仍可回報主 K 棒。

若 crosshair 沒有 time、time 不對應 candle、游標離開圖表或位於未來空白區，readout 回退至最新一根 canonical candle；載入中或沒有 candle 時顯示時間與五個欄位的 `—`。

### 形成中狀態採明確 lifecycle，不以尾端位置猜測

每張 chart 保存 `formingBarTime`。合法 live quote 建立或更新目前 bucket 時將該 bucket 標記為 forming；新 bucket 出現時，前一根轉為 completed。日內 bucket 到達顯示區間終點後，即使沒有下一筆 tick，也必須由有界 boundary timer 清除 forming 狀態。

1D 必須依 `security_type` 使用可測試的台灣市場 session 結束規則；若商品的 session 結束無法從現有 contract metadata 可靠判定，系統不得只因它是最後一根就標示「最新」，而應使用「收」。這項保守降級避免在斷線、收盤後或只載入歷史資料時冒充盤中最新價。

選取 candle 為 forming 時顯示 `最新`，其值使用該 candle 的 current `close`；其他 candle 顯示 `收`。開、高、低、量的欄名不變。

### 固定置頂但不改寫 instance 順序

持久化仍保存一個 readout instance，render 時將可見 readout 分流並先於 `mainLegendInsts` 輸出；一般 instance 陣列與使用者既有順序保持不變。readout 的更多選單不提供複製、上移或下移。再次點選已加入的 picker 項目不得建立第二個 instance，而應關閉 picker 並聚焦既有設定或提示「已加入」。

### 讀值更新沿用單一 latest-wins 排程

crosshair 移動、current-bar live update、商品／時框切換與資料載入完成都只排程一次最新 readout 更新；舊 generation 的 callback 必須丟棄。不得因每筆 tick 重建技術指標 series、副圖 pane 或整張 chart。數值狀態限制在個別 `CandleChart`，全域 instance 只同步啟用與設定，不同步游標時間或讀值。

價格沿用商品／K 線既有精度；量使用非負整數與千分位，不套用價格小數位。欄位順序固定為「開、高、低、收／最新、量」。

## Risks / Trade-offs

- [獨立 change 與技術指標整合同時修改 definition／store] → 分別維持獨立規格；實作時先檢查另一 change 的實際狀態，後套用者以 typed union 合併，不覆蓋 readout 或其 migration。
- [期貨／選擇權夜盤的 1D 完成時點難以只靠簡化 metadata 判定] → 只有可證明 forming 時才顯示「最新」；無法可靠分類時保守顯示「收」，並以跨午夜 fixture 驗證不誤標。
- [八張圖每筆 tick 更新 React state 造成負載] → 每 chart 使用 latest-wins rAF／有界排程與 generation guard，不重建 series；加入八圖可見效能驗收。
- [跨日 primitive 在 history paging／pane 重建後殘留或錯位] → 以 canonical date keys、pane attachment reconciliation、visible-range redraw 與 destroy cleanup 測試驗證，不保存舊 generation 座標。
- [時間區間格式太長遮住其他 legend] → 使用固定短格式、tabular numbers 與可換行／溢位策略，完整區間保留在 tooltip 與 accessible name，不刪除 OHLCV 欄位。
- [游標停在目前 K 棒時 live update 沒觸發 crosshair event] → live quote 更新也必須排程 readout，不能只依賴滑鼠再次移動。

## Migration Plan

1. 先加入 readout definition 與 runtime schema 支援，對既有 indicator storage 執行可重入正規化；沒有 readout 的使用者維持原狀，不預設自動啟用。
2. 加入 picker、專用設定／控制與單一實例限制，再加入 chart-local readout renderer、time index 及 lifecycle。
3. 以單元、component／DOM 及本機 simulation browser-visible 測試驗收後再視為可實作完成。
4. 回復時可移除 readout renderer 與 picker 定義；舊版讀到未知 readout type 時依既有安全過濾忽略，不得清空其他 indicator instances。

## Open Questions

無；時間區間取代功能名稱、固定置頂及獨立 change 均已由使用者確認。
