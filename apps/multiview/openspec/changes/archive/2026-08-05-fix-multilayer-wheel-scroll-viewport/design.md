## Context

多層副圖使用 document 長頁面，主圖與每個副圖 surface 都綁定 `QuoteChartInteractions.bindWheelRouting()`。目前 `chartInteractionOptions()` 仍允許 Lightweight Charts 處理一般 `mouseWheel`，而 routing 只攔截 `Option/Alt + wheel` 來捲頁。真實重現顯示，在主圖中央向下滾動時 `window.scrollY` 保持 0，但 visible logical range 由 `0～159` 擴張為 `-21.42～177.65`，造成左側負索引空白與 K 棒整體縮小。

## Goals / Non-Goals

**Goals:**

- 多層副圖模式下，一般垂直滾輪在任何 chart surface 上都只捲動 document。
- 捲頁手勢不得進入 Lightweight Charts，也不得改變主圖或副圖的 visible logical range、bar spacing 與 crosshair 對齊。
- 保留明確的桌面滾輪縮放路徑：`Option/Alt + wheel` 交由圖表處理。
- 主圖與單一副圖模式維持既有滾輪行為。

**Non-Goals:**

- 不改變水平拖曳、pinch、價格軸拖曳、鍵盤或觸控手勢。
- 不修改 lazy mount、pane 排序、資料請求、D1 或 API。
- 不在 UI 增加提示列、按鈕或新的永久設定。

## Decisions

1. 在既有 capture-phase `bindWheelRouting()` 反轉多層副圖的 modifier 判定：一般無修飾鍵的垂直 wheel 先 `preventDefault()`、`stopImmediatePropagation()`，再以正規化後的 delta 呼叫 `window.scrollBy()`；`Option/Alt + wheel` 不攔截，交給 Lightweight Charts。每個 surface MUST 在呼叫 `createChart()` 前先註冊 routing，使自訂 capture listener 的執行順序早於圖表 library。
   - 理由：同一 helper 已套用主圖、技術副圖與 lazy-mounted 籌碼副圖，可一次修正所有 surface；只使用 capture phase 但晚於 `createChart()` 註冊時，library 仍會先縮放，因此註冊順序也是契約的一部分。
   - 未採用只在 CSS 或 scroll listener 還原 range：事件仍會先造成縮放與畫面閃動，並可能觸發歷史補載或同步 callback。
2. `Ctrl/Meta + wheel` 不由應用程式攔截，保留瀏覽器原生縮放／系統手勢。
3. 單元測試直接驗證一般 wheel 會捲頁且停止傳播、Alt wheel 不會捲頁；瀏覽器驗收量測 `window.scrollY`、visible logical range、首末 K 棒座標與 mounted pane 數量。
4. Lazy-mounted 籌碼 chart 在建立後兩個 layout frame 內不向主圖回送 visible range；待初始化、auto-size 與主圖範圍同步完成後才開放使用者 range input。這可避免新 pane 的暫態範圍反向改寫主圖或留下整格 K 棒偏移。

## Risks / Trade-offs

- [使用者原本習慣一般滾輪縮放] → 多層副圖仍可用 `Option/Alt + wheel`、pinch 與既有拖曳／價格軸操作；主圖與單一副圖模式完全不變。
- [不同裝置 wheel deltaMode 不同] → 沿用既有 `normalizeWheelDelta()`，統一 pixel、line 與 page delta。
- [lazy mount 期間捲頁觸發 pane 建立] → 驗收捲動前後主圖 range 與 bar spacing 必須相同，確保 mount／resize callback 不反向污染主圖。
