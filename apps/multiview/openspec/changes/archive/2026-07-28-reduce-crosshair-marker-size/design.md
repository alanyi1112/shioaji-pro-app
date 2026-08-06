## Context

主圖均線、布林線、固定範圍價格線、技術副圖折線與籌碼副圖折線分別由 `public/static/app.js` 與 `public/static/chip-panes.js` 建立。這些 `LineSeries` 未指定 crosshair marker 尺寸，因此 Lightweight Charts 5.0.9 使用半徑 4 px、邊框 2 px 的預設值；同一日期有多條折線時，圓點會沿共用垂直十字準線堆疊。

## Goals / Non-Goals

**Goals:**

- 主圖、技術副圖與籌碼副圖的可見折線 marker 統一為半徑 2 CSS px、邊框 1 CSS px。
- 保留 marker 原有顏色、顯示時機、跨 pane 同步與費波那契選點期間的隱藏行為。
- 以契約測試及實際瀏覽器畫面驗證尺寸與資訊可讀性。

**Non-Goals:**

- 不改變十字準線位置、水平／垂直線樣式、日期標籤或 readout。
- 不改變折線本身線寬、顏色、資料、指標公式與價格尺度。
- 不調整 candle、histogram、費波那契錨點或固定範圍 VP 控制點。

## Decisions

1. 在主圖與籌碼副圖模組各自定義相同的 marker 尺寸常數，並於所有可見 `LineSeries` 建立入口套用。兩個 browser script 目前沒有共用 module bundling 邊界；局部常數比新增全域依賴更小且不影響載入順序。
2. 使用 `crosshairMarkerRadius: 2` 與 `crosshairMarkerBorderWidth: 1`。相較預設直徑 8 px，4 px 直徑只略大於現有 1–2 px 線條，仍足以辨識顏色與交點。
3. 不以 `crosshairMarkerVisible: false` 全面隱藏。完全移除會失去折線與十字準線交點提示，和使用者要求的「只比線粗大一點點」不符。
4. 保留每個 series 既有 option override 與費波那契狀態切換；尺寸設定只縮小預設可見 marker，不改變哪些 marker 應出現。

## Risks / Trade-offs

- [高 DPI 螢幕上 marker 可能顯得很小] → 使用 2 CSS px 半徑而非 1 px，並在實際瀏覽器以共用十字準線跨主副圖驗收。
- [漏掉直接建立的可見 LineSeries] → 契約測試覆蓋主圖 `addLine`、技術副圖 `addIndicatorLine` 與籌碼副圖 `addLine` 三個入口；隱藏的 time anchor 與 autoscale series 不納入。
- [上游 Lightweight Charts 預設值變更] → 顯式指定尺寸，避免日後 CDN 小版本更新造成視覺漂移。

## Migration Plan

1. 套用尺寸常數、更新兩支 script 的 cache-busting key 並補齊測試後，執行完整 build、tests、lint、OpenSpec strict validation 及 `git diff --check`。
2. 在本機瀏覽器讓十字準線穿過多條主圖／技術副圖／籌碼副圖折線，確認圓點縮小且同步不變。
3. 推送相同完整 HEAD 至 GitHub 與 Sites source，保存並發布 owner-only Sites version，再於正式站重驗。
4. 若 marker 太小或出現相容性問題，回復兩個 series option 即可；不涉及資料或 schema rollback。

## Open Questions

無。
