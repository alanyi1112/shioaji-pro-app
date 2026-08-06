## Why

回撤與拓展同時存在時，第二張單色圖仍帶有區間半透明色帶，容易與第一張彩色圖的色帶疊加並干擾 K 棒閱讀。第二張圖只保留單色線條即可維持先後辨識，同時降低主圖視覺負擔。

## What Changes

- 回撤與拓展同時存在時，較晚完成的第二張單色費波那契圖不再渲染相鄰水準區間的填色。
- 第二張圖仍保留單色水平級別實線、單色 A–B／A–B–C 虛線、錨點與標籤。
- 第一張分級彩色費波那契圖仍保留既有半透明區間色帶。
- 畫第二種圖的 pending preview 依第二張圖規則不顯示區間填色，避免完成前後樣式跳變。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `main-chart-fibonacci-tools`：第二張單色費波那契圖及其 pending preview 改為線條呈現，不再顯示區間填色。

## Impact

- 影響 `public/static/app.js` 的費波那契 SVG 色帶渲染條件。
- 影響費波那契樣式與前端 contract 測試；不變更本機保存格式、Worker API、D1 或外部資料來源。
