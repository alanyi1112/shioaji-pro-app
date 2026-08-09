## Why

MultiView 的費波那契回撤與拓展目前各只有七條固定水準，且只有單一「清除繪圖」操作，會清除目前 interval 的費波那契與價格範圍，無法表達目前時間級別的分種類清除或目前商品跨 interval 全部清除。此變更需與 RealTimeStock 主交易畫面同步，確保兩套公式、視覺及保存語意一致。

## What Changes

- 回撤新增 `-0.62`、`-0.27`、`0.705`，形成 `-0.62、-0.27、0、0.236、0.382、0.5、0.618、0.705、0.786、1` 十條水準。
- 拓展新增 `0.705`，形成 `0.618、0.705、0.786、1、1.272、1.414、1.618、2` 八條水準；不顯示 `-0.62`、`-0.27`。
- 沿用既有回撤與拓展公式，讓新增水準進入標籤、依種類產生的彩色線與相鄰色帶、completed extension autoscale 及完整 panel PNG 匯出。
- 每個 canonical symbol 的費波那契繼續依 interval 分開保存；切換 interval 時不得刪除原 interval 完成圖，切回後必須還原。`intraday` 分時模式仍暫停費波那契顯示且不得建立新圖。
- 新增「清除回撤」與「清除拓展」，只清除目前 symbol、目前 interval 的對應種類。
- **BREAKING**：「全部清除」定義為清除目前 symbol 所有 interval 的回撤與拓展；不得影響其他 symbol、價格範圍、Pivot、Volume Profile、技術指標或個人資料。
- 與 repo 根目錄的同名 RealTimeStock change 協調測試 fixture 與可見行為，但不建立跨 app runtime dependency。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `main-chart-fibonacci-tools`: 將回撤擴充為十條、拓展擴充為八條指定水準，並加入目前 interval 分種類清除、切換還原及目前商品全 interval 清除契約。

## Impact

- 主要影響 `public/static/chart-annotations.js`、`public/static/app.js`、`public/static/index.html`、`public/static/styles.css`、圖片匯出行為與 `tests/chart-annotations.test.mjs`。
- 既有 storage 只保存 anchors，可保留現行 schema 並於 restore 時依種類自動重算水準；跨 interval 清除必須安全枚舉本 app namespace，更新記憶體與 storage，同時保留同 identity 的價格範圍。
- completed extension 的 autoscale 必須包含新增負比例最低／最高值；pending preview 仍不得改變價格尺度。
- 不新增 API、D1、Worker 資料欄位、外部行情依賴、production credential 或交易能力；不擴大進行中的 Shioaji realtime change 範圍。
