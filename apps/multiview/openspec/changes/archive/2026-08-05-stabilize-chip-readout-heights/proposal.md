## Why

多層副圖的籌碼 pane 會在共用游標移動時，依「完整資料」、「部分資料」、「當日無資料」與「最近一筆」等 readout 內容重新換行，導致 header、pane 及其下方內容持續改變高度，形成明顯的上下跳動。現行規格要求 header 依每次內容自然增高，必須改成由資料、版面與顯示設定決定穩定保留高度，讓游標更新只改變讀值、不改變幾何位置。

## What Changes

- 為每個作用中的籌碼 pane 建立與目前 panel 寬度、series 選取、級距及資料狀態相容的穩定 readout 高度保留區。
- 將共用游標的逐日 readout 更新限制為內容與樣式更新，不得在游標移動期間改變 header、pane 或後續 pane 的垂直位置。
- 在圖數、panel 寬度、瀏覽器縮放、series 選取、holder 級距或資料 payload 改變時，重新計算合法保留高度；一般 pointer move 不得觸發重算。
- 保留完整日期、數值、狀態、原順序與安全換行，不以 ellipsis、裁切、水平捲動或浮動 tooltip 換取穩定高度。
- 對相同列且副圖配置相容的多圖 panel，讓相同 pane identity 可採共同最大保留高度，以維持跨欄邊界對齊；配置不同時仍各自穩定，不強制錯誤對齊。
- 補上 1／2／3／4 圖多層副圖、完整／部分／缺值／TDCC 非發布日、series／級距切換與 responsive resize 的幾何穩定驗收。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `taiwan-stock-chip-subcharts`: 將多層副圖 header 由「隨每次 readout 換行自然增高」改為「在 layout-affecting 狀態改變時建立足以完整容納內容的穩定保留高度」，並新增游標移動期間的幾何穩定與跨 panel 對齊要求。

## Impact

- 前端：`public/static/chip-panes.js` 的 readout 模型、量測、保留高度與 crosshair 更新生命週期。
- 樣式：`public/static/styles.css` 的 pane header、inline readout、holder 控制項及多層副圖高度規則。
- 整合：`public/static/app.js` 的 panel layout refresh、共用 crosshair 與多 panel 高度協調介面可能需要小幅擴充。
- 驗證：`tests/rendered-html.test.mjs`、`tests/subchart-interaction.test.mjs` 與瀏覽器實際幾何量測。
- 不變範圍：市場資料 API、D1 schema、資料來源、清單持久化、stream contract 與 6／8 圖固定單一副圖規則均不變。
