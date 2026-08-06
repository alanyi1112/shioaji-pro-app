## Why

籌碼副圖目前可逐組上移、下移或一鍵置頂，但要把某一組移到最下方仍須重複操作。新增對稱的「置底」可讓使用者一次完成群組排序，並延續既有保存與不重新抓取資料的行為。

## What Changes

- 在每個籌碼副圖的右鍵功能表加入固定顯示的「置底」操作。
- 在多層副圖模式中，將該 pane 所屬的完整資料群組一次移到籌碼副圖區最下方。
- 已在最後一組或處於單層副圖模式時，保留「置底」項目但設為 disabled。
- 沿用既有群組順序偏好保存、canonical child order、layout refresh 與不重新抓取資料的契約。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `taiwan-stock-chip-subcharts`：新增籌碼資料群組一鍵置底、停用狀態與重新載入後恢復順序的需求。

## Impact

- 前端籌碼副圖右鍵功能表與群組排序 manager：`public/static/chip-panes.js`
- 前端靜態資源版本：`public/static/index.html`
- OpenSpec 與回歸測試：`openspec/`、`tests/rendered-html.test.mjs`
- 不變更 Worker API、D1 schema、資料來源或部署環境變數。
