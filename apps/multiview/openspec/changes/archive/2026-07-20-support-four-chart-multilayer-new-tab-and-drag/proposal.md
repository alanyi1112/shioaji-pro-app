## Why

目前 4 圖被強制使用單一副圖，無法像 3 圖一樣同時比較多個商品的完整多層副圖；多圖 panel 的雙擊聚焦又會改變原分頁內容，不利於保留比較畫面。現行籌碼群組拖曳雖能在可見目標間排序，但拖曳區過小且缺少頁面邊緣自動捲動，長頁面上經常無法把群組移到畫面外的位置。

## What Changes

- 讓 4 圖可選擇「單一副圖」或「多層副圖」，並讓多層副圖在寬螢幕以一列四欄顯示四個商品，由整個瀏覽器頁面垂直捲動。
- 保留 4 圖單一副圖的既有 2×2 固定視窗版面；6／8 圖仍固定使用單一副圖。
- 將多圖 panel 的雙擊行為改為開啟新分頁，以本分頁專用 URL 狀態顯示該商品的 1 圖模式，原多圖分頁保持不變。
- 新分頁沿用來源 panel 的商品、週期與清單頁籤，且不得把共用的圖表數量偏好覆寫為 1。
- 擴大籌碼資料群組的有效拖曳區，加入靠近 viewport 上下邊緣時的 document 自動捲動與位置重算，讓群組可跨越畫面外目標。
- 保留群組內 canonical child order、一次 drop 才保存與重排，以及右鍵與鍵盤替代排序操作。
- 多層副圖在尚無該商品既有偏好時，預設勾選全部十個籌碼副圖；既有使用者選擇仍原樣保留。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `codex-sites-rewrite`：修改多圖 panel 的單圖開啟行為，新增不污染共用偏好的 URL 單圖檢視狀態。
- `taiwan-stock-chip-subcharts`：修改圖表數量與副圖模式政策、4 圖多層版面，以及多層籌碼資料群組拖曳契約。

## Impact

- 前端初始化、圖表數量／模式政策、panel 雙擊事件與 URL 狀態解析：`public/static/app.js`。
- 4 圖多層副圖、緊湊工具列與響應式版面：`public/static/styles.css`。
- 籌碼資料群組拖曳命中範圍、edge auto-scroll、placeholder／ghost 與排序保存：`public/static/chip-panes.js`。
- 快取版本與 UI contract：`public/static/index.html`、`tests/rendered-html.test.mjs`、`tests/subchart-interaction.test.mjs`。
- 不變更 Worker API、D1 schema、籌碼資料來源、回補排程或 Sites runtime secrets。
