## Why

RealTimeStock 主交易畫面的費波那契回撤與拓展目前各只有七條固定水準，且「全部清除」只作用於目前時間級別，無法符合使用者對新增負向／0.705 水準及目前商品跨時間級別管理的需求。此變更需與同 repo 的 `apps/multiview` 同步，避免兩套費波那契公式、保存與清除語意再次分歧。

## What Changes

- 回撤新增 `-0.62`、`-0.27`、`0.705`，形成 `-0.62、-0.27、0、0.236、0.382、0.5、0.618、0.705、0.786、1` 十條水準。
- 拓展新增 `0.705`，形成 `0.618、0.705、0.786、1、1.272、1.414、1.618、2` 八條水準；不顯示 `-0.62`、`-0.27`。
- 回撤繼續使用 `B - r × (B - A)`，拓展繼續使用 `C + r × (B - A)`；新增水準必須進入標籤、彩色線、相鄰色帶及 completed extension autoscale。
- 每個商品的回撤與拓展繼續依時間級別分開保存；切換時間級別時不得刪除原時間級別的完成圖，切回後必須還原。
- 「清除回撤」及「清除拓展」只清除目前商品、目前時間級別的對應種類。
- **BREAKING**：「全部清除」改為清除目前商品所有時間級別的回撤與拓展，不得影響其他商品、價格範圍、Pivot、Volume Profile、技術指標或交易內容。
- 與 `apps/multiview/openspec/changes/extend-fibonacci-levels-and-timeframe-persistence` 協調更新公式、色票、保存、清除與驗收契約，但不建立跨 app runtime dependency。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `main-chart-fibonacci-tools`: 將回撤擴充為十條、拓展擴充為八條指定水準，並修改跨時間級別保存與目前商品全時間級別清除契約。

## Impact

- 主要影響 `src/lib/fibonacci-annotations.ts`、`src/lib/fibonacci-overlay.ts`、`src/components/fibonacci-overlay.tsx`、`src/components/candle-chart.tsx`、對應樣式與測試。
- RealTimeStock 既有 formula version 需要可回溯的 v2 與 v1 anchors 遷移，舊完成圖不得因升級被清除。
- completed extension 的最低／最高 autoscale 將包含負比例水準，完成時可能擴大價格軸；pending preview 仍不得驅動 autoscale。
- 不改變 Shioaji API、行情資料、錨點吸附、交易模式互斥、下單流程、simulation／production 邊界或任何秘密資料處理。
