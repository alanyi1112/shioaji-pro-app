## Why

Shioaji K 線面板與 MultiView 的費波那契拓展目前都從 `0.618` 起算，缺少使用者需要的 `0.5` 水準，造成兩個圖表入口無法呈現一致且完整的拓展參考。這項調整必須同步處理公式契約、既有繪圖遷移與兩套 renderer，避免只改其中一處或讓舊資料失效。

## What Changes

- 將費波那契拓展水準更新為 `0.5、0.618、0.705、0.786、1、1.272、1.414、1.618、2`，維持既有 `C + r × (B - A)` 公式。
- 同步更新 Shioaji K 線面板與 `apps/multiview` 主圖的拓展線、標籤、色帶、自動縮放與測試 fixture。
- 為新增的 `0.5` 水準指定穩定且不改動既有水準配色的視覺角色。
- 將 Shioaji 費波那契公式版本升級，安全接受既有 `v1`、`v2` 錨點資料並以新版水準重算；既有 kind、anchors、order 與商品／週期身份不得遺失。
- 同步更新 root 與 MultiView 的正式規格，讓兩套實作維持相同拓展契約。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `main-chart-fibonacci-tools`: 費波那契拓展由八條水準改為包含 `0.5` 的九條水準，並新增舊公式版本遷移與雙 renderer 一致性要求。

## Impact

- 主要影響 `src/lib/fibonacci-annotations.ts`、相關 Shioaji K 線 overlay／browser tests，以及 `apps/multiview/public/static/chart-annotations.js`、主圖註記 renderer、樣式與測試。
- 需更新 `openspec/specs/main-chart-fibonacci-tools` 與 `apps/multiview/openspec/specs/main-chart-fibonacci-tools`。
- 不新增後端 API、外部套件、行情請求或交易行為；不影響 simulation／production 模式。
