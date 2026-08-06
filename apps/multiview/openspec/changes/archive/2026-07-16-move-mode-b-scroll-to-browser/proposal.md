## Why

目前方式 B 雖會建立所有已勾選的技術與籌碼副圖，但桌面版把圖表 panel 固定在視窗高度，並在單一 panel 的籌碼區加入內層垂直捲軸，造成多層副圖難以連續閱讀，也與使用者提供的參考畫面不一致。方式 B 應改為讓內容自然向下展開，統一由瀏覽器頁面捲動，使所有已選副圖能依序同時呈現。

## What Changes

- **BREAKING**：方式 B 不再於 `.chip-pane-region` 或單一 panel 內提供獨立垂直捲動，改由 `html/body` 的瀏覽器頁面捲軸控制整頁。
- 1／2／3 圖使用方式 B 時，主圖、技術副圖與所有已勾選籌碼 pane 依固定順序自然向下堆疊，並各自保留可讀最低高度，不以壓縮方式塞入單一視窗。
- 方式 B 的 panel 與 grid 高度會隨已選 pane 數量增減；取消項目後頁面高度自然縮短，新增項目後頁面高度自然增加。
- 方式 A、4／6／8 圖及聚焦模式維持目前固定單一副圖與視窗內多圖配置，不因方式 B 的長頁面版型增加高度或內層 stack。
- 桌面與窄螢幕採一致的單一頁面捲動語意，禁止產生 panel 內垂直捲軸與非預期的頁面水平捲軸。
- 補充切換模式、切換圖數、resize、wheel／touch、crosshair、時間軸同步及 pane 增減時的版面與互動驗收。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `taiwan-stock-chip-subcharts`：將「多層副圖高度與捲動」從 panel 內垂直捲動改為方式 B 的瀏覽器整頁捲動，並明確定義 1／2／3 圖、窄螢幕、方式 A、4／6／8 圖與聚焦模式的版面邊界。

## Impact

- 前端版面與狀態：`public/static/styles.css`、`public/static/app.js`、`public/static/index.html`。
- 圖表生命週期：主圖、技術副圖與 `public/static/chip-panes.js` 的 `ResizeObserver`、resize、visible range 與 crosshair 同步行為。
- 驗證：`tests/rendered-html.test.mjs`、前端 contract 測試、本機瀏覽器的 1／2／3 圖 A／B 與窄螢幕互動驗收，以及 Codex Sites 正式站可見結果。
- 不變更籌碼資料 API、D1 schema、資料來源、秘密值或 4／6／8 圖的方式 A 政策。
