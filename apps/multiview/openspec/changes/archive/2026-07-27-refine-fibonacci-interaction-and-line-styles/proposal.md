## Why

目前費波那契錨點只能自由選價，完成新圖時也會覆蓋既有回撤或拓展，造成波段端點不易準確落在 K 棒高低價，且無法同時比較回撤與拓展。現有線寬與實／虛線層級也需要統一，讓費波那契與本益比河流圖在密集主圖中更清楚但不搶過 K 線。

## What Changes

- 費波那契 A 點預設吸附所點 K 棒最低價、B 點預設吸附最高價；拓展 C 點在有 K 棒時吸附最低價，在無 K 棒的未來區域則保留自由價位。
- 按住 macOS Option 或 Windows Alt 點選時，A／B／C 均略過價格吸附並使用游標自由價位；未按組合鍵時，A／B 點在無 K 棒區域不得建立錨點。
- 同一 canonical symbol 與 interval 各保留一張回撤及一張拓展；重畫同種類型只取代該類舊圖，不得清除另一種類型。
- 回撤與拓展同時存在時，先完成的圖維持分級彩色，後完成的圖改以單色呈現；只剩單一類型時恢復分級彩色。
- 費波那契水平級別線改為 1 CSS px 彩色實線；A–B／A–B–C 完成及暫態波段連接線維持虛線但改為 1 CSS px，暫態狀態另以較低透明度區分。
- 本益比河流圖維持 P50 1.4 CSS px，其餘百分位線統一為 1 CSS px 彩色實線；provisional 尾端維持虛線、較低透明度與既有狀態文字。
- 既有單張費波那契本機資料安全遷移至雙類型保存格式，並讓重繪、價格軸 autoscale 與完整 panel PNG 匯出包含目前可見的兩種類型。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `main-chart-fibonacci-tools`: 修改錨點吸附與 Option／Alt 自由選價行為、回撤／拓展共存及分級彩色／第二圖單色呈現規則。
- `taiwan-stock-pe-river-chart`: 明確規範七條河流線的線寬，以及 verified／provisional 的實線與虛線視覺差異。

## Impact

- 影響 `public/static/chart-annotations.js` 的完成註記資料模型、本機儲存版本與遷移。
- 影響 `public/static/app.js` 的滑鼠座標／K 棒錨點解析、雙類型重繪、第二圖單色判定與拓展 autoscale。
- 影響 `public/static/styles.css` 與 `public/static/pe-river-overlay.js` 的 SVG 線寬、實／虛線及單色樣式。
- 需調整費波那契 controller、主圖渲染、河流 overlay、PNG 匯出與瀏覽器互動測試；不變更 Worker 資料來源、D1 schema、排程、外部 API 或秘密值。
