## Context

主圖目前以 `chartPointForPanelEvent()` 將滑鼠 X／Y 座標轉成費波那契預覽及錨點的 `{ time, price }`；其中價格來自 `candleSeries.coordinateToPrice(y)`。同一個 pointer move 隨後會依游標日期呼叫共用十字線同步，而主圖原生水平十字線刻意設定在該根 K 棒的 `close`，以維持主圖、副圖與籌碼 pane 的日期讀值一致。結果是實際錨點價格與畫面上的收盤價水平虛線不同，且既有 SVG 預覽只有空心圓、導引線及可計算的費波那契水準，沒有獨立標示游標 Y 對應價格。

本變更只補上費波那契等待選點期間的暫態瞄準輔助。它必須沿用現有主圖註記 controller、價格 formatter、plot 安全邊界與 PNG 排除機制，不改變共用十字線或完成註記的資料契約。

## Goals / Non-Goals

**Goals:**

- 讓使用者在點下 A、B、C 前直接看見游標位置對應的實際錨點價位。
- 以不同顏色、實線及明確文字標籤，區分錨點價格導引與既有收盤價水平虛線。
- 保證點選前顯示的格式化價格與點選後保存錨點再格式化的結果一致。
- 維持既有日期十字線、跨 pane 同步、費波那契公式、完成註記及圖表手勢不變。

**Non-Goals:**

- 不把錨點自動吸附至開盤、最高、最低、收盤、均線或最小跳動價格。
- 不新增錨點拖曳、鍵盤微調、觸控放大鏡或一般常駐游標價格線。
- 不變更 `localStorage` schema、API、D1、外部資料來源或伺服器端保存。
- 不將暫態價格導引納入完成註記或 PNG 匯出。

## Decisions

### 1. 以既有 pending preview 作為唯一價格來源

價格導引 SHALL 只讀取費波那契 `pending.preview`，其內容仍由 `chartPointForPanelEvent()` 產生。畫面標籤與點選處理因此共用相同的時間／價格座標轉換路徑；驗收時以「保存後錨點經相同 formatter 顯示的文字等於點選前標籤」判定一致，而不為了顯示而改寫錨點的原始有限數值。

考慮過另外在導引線 listener 重新執行 `coordinateToPrice()`；但兩條取樣路徑可能因 resize、價格軸更新或事件時序產生細微差異，因此不採用。也不將價格吸附到 candle close，因為那會改變既有任意圖上價位選點的語意。

### 2. 在既有 SVG 註記層繪製獨立暫態群組

當 `pending.type === "fibonacci"` 且具有有效 preview 時，SVG 註記層 SHALL 額外建立價格導引群組。水平線從 plot 左緣延伸至既有 `rightEdge`，Y 座標直接使用 preview price 的 `priceToCoordinate()`；右端價格標籤置於 plot 內側並限制在可見高度，文字為 `待選 A｜價格`、`待選 B｜價格` 或 `待選 C｜價格`。下一點名稱依已固定錨點數決定，不把 A／B／C 寫入既有空心錨點圓內。

導引線採高對比藍色實線及必要的深色細 halo，與既有灰白收盤價虛線形成顏色與線型雙重差異；價格標籤使用同色邊框、深色背景及等寬數字。群組維持 `pointer-events: none`，並以 `data-export-exclude` 沿用 `panel-image-export.js` 的排除契約。

考慮過建立新的 HTML overlay；但現有 SVG 已掌握 price scale、plot 安全邊界及註記重繪生命週期，另建 DOM 會增加 resize 與座標漂移風險，因此不採用。

### 3. 不修改原生水平十字線與共用日期同步

現有 `setCrosshairPosition(candle.close, time, candleSeries)` SHALL 保留，讓 K 棒收盤價水平虛線、日期讀值及跨 pane 同步維持原契約。新的導引線不呼叫 `setCrosshairPosition()`、不寫入 `sharedHoverTime`，也不廣播至技術或籌碼副圖；它只回答「若現在點下去，錨點價位是多少」。

這使同一主圖在選點時可能同時存在兩條水平線：灰白虛線代表 K 棒收盤價，高對比實線與 `待選 A／B／C` 標籤代表實際錨點價位。保留兩者比暫時隱藏收盤價線更能維持既有讀值脈絡，也避免切換工具時改動 chart options。

### 4. 完整沿用 pending preview 的清理生命週期

導引群組不建立新的持久狀態或獨立 listener。當滑鼠離開主圖而 `previewPoint()` 清除 preview、Escape 取消 pending、最後一點完成、重新啟動其他工具、切換商品／週期、reset 或銷毀 panel 時，下一次既有 `renderChartAnnotations()` 重繪 SHALL 自然移除導引群組。無效座標、價格軸範圍外或價格軸安全邊界內不得產生殘留標籤。

### 5. 選點期間關閉原生實心 marker，preview 改用小型十字

截圖中的大型實心圓來自多條主圖 LineSeries 的 `crosshairMarkerVisible`，不是費波那契錨點。controller 狀態進入 `pending.type === "fibonacci"` 時，主圖 SHALL 暫時對既有價格 LineSeries 套用 `crosshairMarkerVisible: false`；新增或重建 LineSeries 時也必須從當下 pending 狀態決定初值。完成、取消、清除、工具切換或身份 restore 後 SHALL 恢復原本的可見 marker 行為。

SVG preview 錨點不再繪製圓形，而以兩條約 10 CSS px、可見粗細固定 1 CSS px 的水平／垂直細線構成小型十字，圓心仍使用同一 `pending.preview` 座標。preview halo 也限制為相同 1 CSS px，避免背景描邊使十字看起來仍像粗線。已固定及完成錨點保留透明空心圓，但半徑縮為 4 CSS px。這讓「尚未選取」與「已固定」具有形狀差異，也不以大型實心面積遮住 K 棒。

### 6. pending 拓展不參與價格軸 autoscale

既有兩條隱形 autoscale series 原先同時接受完成拓展與待選 C 所衍生的拓展高低界；後者會在每次 pointer move 觸發 `setData()` 及 `autoScale: true`，直接造成 K 線反覆壓縮。`updateFibonacciAutoScale()` SHALL 只讀取 `completed.fibonacci`，忽略所有 pending preview。預覽水準仍由 SVG 即時計算，超出目前 plot 的部分依既有裁切規則略過；完成 C 後才一次更新正式拓展界線。

### 7. 單圖新分頁的必要資料請求不得被 config 或原頁長連線阻擋

正式站重現顯示，多圖雙擊開啟 `view=single` 後，首頁與 `/api/config` 已成功，但 `/api/instruments` 約 22 秒後才送達 Worker；Worker log 證明 `/api/instruments` 實際執行只需約 195ms。先將 config 與 instruments 改為並行後，version 140 仍需約 23 秒才建立 panel，且請求仍在瀏覽器端延後約 22 秒送出。由「Worker 尚未收到請求」及多圖原頁同時維持多條 `EventSource` 可推論，根因是同源長連線占用瀏覽器可用連線，並非商品 API 執行時間或 K 線 renderer。

初始化 SHALL 在第一次網路等待前同時啟動 `loadInstruments()` 與 `loadAppConfig()`，以 instruments promise 完成作為解析單圖 URL、建立 panel 與載入 K 線的關鍵路徑；config 可在 panel 建立後收尾。多圖雙擊開啟新分頁前，原頁 SHALL 暫停當下 panel 的即時串流以釋放連線容量，並在 3 秒後對同一批仍有效 panel 自動恢復；即使新分頁被瀏覽器阻擋也不得永久停用原頁串流。既有 canonical symbol、interval、tab fallback、`noopener`、原頁可見狀態與共用圖數偏好隔離維持不變。

## Risks / Trade-offs

- [收盤價虛線與錨點實線同時存在仍可能混淆] → 使用不同顏色、實／虛線差異及 `待選 A／B／C` 明文，不只依賴顏色辨識。
- [價格標籤靠近圖頂或圖底被裁切] → 依標籤高度限制 Y 座標，水平線仍維持真實 preview price，不因標籤避讓而移動。
- [價格軸寬度或 resize 改變造成右端錯位] → 每次註記重繪重新使用 `getAxisSafeWidth()` 計算 `rightEdge`，不快取像素位置。
- [pointer move 頻繁重建 SVG 增加成本] → 沿用既有 preview 變更與註記重繪節奏，不新增第二個 pointer listener；瀏覽器驗收確認連續移動無明顯延遲。
- [匯出時誤收暫態選點導引] → 導引群組標記 `data-export-exclude`，並以 exporter clone 測試確認只有完成註記保留。
- [關閉 marker 後失去選點焦點] → 以置中於真實 preview 座標的小型十字取代，並保留垂直日期線、水平價位線與待選文字標籤。
- [拓展預覽超出 plot 時看不到全部水準] → 選點穩定性優先；預覽只畫目前可見部分，完成後再依既有正式 autoscale 規則顯示全部水準。
- [config 與 instruments 併行可能改變狀態更新順序] → `appConfig` 不參與商品清單、單圖 URL 或 panel 建立；保留各自錯誤處理，並以瀏覽器確認多圖原頁及新分頁均正確。
- [開啟單圖時短暫中斷原頁即時串流] → 只暫停雙擊當下的 panel 物件，固定 3 秒後呼叫既有 `resumeStream()`；歷史 K 線、版面、頁碼、捲動、visible range 與副圖狀態不重建，且回到原頁後即時串流繼續。

## Migration Plan

1. 在既有註記渲染路徑加入只讀 pending preview 的價格導引群組與樣式，不變更 controller 儲存格式。
2. 補上渲染與生命週期測試，再於本機實際操作回撤及拓展的 A／B／C 選點、取消、完成、resize 與 PNG 匯出。
3. 執行既有主圖註記、共用十字線及完整測試；通過後依 Sites 流程發布並在正式站重驗。
4. 若發生互動或視覺回歸，回退本次前端版本即可；沒有資料遷移或後端狀態需要還原。

## Open Questions

- 無；本變更採不吸附、只在費波那契 pending 期間顯示，並保留既有收盤價十字線。
