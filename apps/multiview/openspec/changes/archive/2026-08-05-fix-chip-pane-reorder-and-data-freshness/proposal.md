## Why

副圖資料群組按下「置頂」後，圖表目前可能保留錯誤的 viewport 狀態，造成資料線左側出現不應有的空白，且共用滑鼠游標與 K 棒的 X 座標失準。另一方面，籌碼提示把不同資料集的說明合併成單一橘黃色段落，信用交易資料也可能以今日 K 棒日期顯示尚未由來源發布的數值；這會讓使用者誤判資料的新鮮度與來源狀態。

## What Changes

- 副圖資料群組重新排序、置頂或置底後，以穩定的時間錨點保存並還原可視範圍與共用游標，不以重排前的暫時 logical range 造成水平偏移。
- 籌碼提示保留後端逐筆 warning 的資料集邊界，依資料集使用可辨識且一致的顏色呈現，並保留關閉提示功能。
- 信用交易資料只以來源實際發布的交易日建立資料列；若請求日期尚未發布，讀值顯示「當日無資料／最近一筆」及真實資料日期，不把最後一根 K 棒日期當成信用交易資料日期。
- 補上置頂後 viewport／游標、提示色彩與信用交易未發布日期的自動化回歸測試及本機可見行為驗收。

## Capabilities

### New Capabilities

- `chip-pane-layout-and-data-freshness`: 定義籌碼副圖重排後的 viewport／座標穩定、資料提示的資料集色彩，以及來源未發布時的真實日期與缺值顯示契約。

### Modified Capabilities

無。

## Impact

- 前端：`public/static/app.js`、`public/static/chip-panes.js`、`public/static/styles.css`。
- Worker：`worker/taiwan-stock-chip-service.ts` 及必要的資料日期／availability contract。
- 測試：`tests/subchart-interaction.test.mjs`、`tests/taiwan-stock-chip-service.test.mjs` 與新增的純函式或來源 contract 測試。
- 不新增 D1 schema、不改變既有資料來源授權、不提交任何帳號、token 或其他秘密資料。
