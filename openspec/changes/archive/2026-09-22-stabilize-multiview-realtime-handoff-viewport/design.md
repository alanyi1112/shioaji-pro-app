## Context

00929.TW 在 2026-09-21 盤中以日線與「自動」來源載入時，畫面先顯示 Yahoo canonical 的 524 根日 K；Shioaji bootstrap 與第一筆 snapshot 抵達後，`renderDailyKlines()` 以 242 根同源日 K 重建所有 series。`applyPreservedVisibleLogicalRange()` 只處理新增前置 K 棒，對 candle 數量縮短仍套用舊 logical range，因而留下約 54% 右側空白。現行 viewport coordinator 能隔離程式性 callback，但無法修正呼叫端提交的跨資料集合錯誤範圍。

既有 `multiview-taiwan-realtime-market-data` 規格要求自動模式在 Shioaji 可用時使用完整同源 payload，禁止將 Yahoo 歷史與 Shioaji 當期 OHLCV 混接。本修正必須同時維持來源完整性、simulation-only、安全成交量單位與既有共用 SSE。

## Goals / Non-Goals

**Goals:**

- 自動模式不再先顯示即將被 Shioaji bootstrap 取代的 canonical 圖形。
- candle 集合增減或來源切換時，以日期錨點轉換 viewport，並把範圍限制在新資料可支援的跨度內。
- 使用者已縮放／平移時保留相同日期區間；未操作時顯示新來源完整範圍與既定右側空間。
- 同日 snapshot 繼續只增量更新最後一棒，不重建整套主圖、副圖與籌碼 pane。

**Non-Goals:**

- 不混接 Yahoo 與 Shioaji candle rows，不改變 provider 選擇、volume normalization 或官方收盤核定規則。
- 不增加 Shioaji 歷史查詢天數、不寫入 D1、不啟用 production 或真實下單。
- 不修改週／月 provisional 聚合的來源契約。

## Decisions

### 自動模式等待最終 Shioaji bootstrap

對可使用 Shioaji 的 `1m`、`5m`、`15m`、`1h`、`1d`，`自動`與`Shioaji 即時`都先保存 canonical payload 作為 fallback，但不先繪製。Shioaji 完整 bootstrap 成功後一次繪製同源 payload；`自動`模式若 1.5 秒仍未完成，才原子繪製完整 canonical fallback，避免本機來源真的受阻時讓畫面無限等待。Kbars 隨後恢復時仍以完整 payload 交接。

此作法優於把較舊 Yahoo rows 接到 Shioaji 前方，因為混接會違反既有同源 OHLCV 與成交量單位契約。它也優於擴大 Shioaji 歷史範圍，後者會增加大量分鐘原始列、載入延遲與 renderer 壓力。

### viewport snapshot 以時間為身分並限制跨度

來源交接前擷取 `fromTime`、`toTime`、小數位置、跨度、右側貼齊狀態與 bar spacing。套用新 candle 集合時優先依時間尋找對應 index；若為右側貼齊，保留不超過新集合最大可顯示跨度的原跨度。舊跨度大於新資料時直接收斂至新資料完整範圍，禁止保留不存在的 logical slots。

此邏輯放在 `chart-interactions.js` 的純函式，讓 524→242、242→524、日期交集與缺少錨點可用 Node 測試，不依賴 canvas 或 DOM。

### 完整重建與增量更新分流

第一次 bootstrap、換交易日、fallback 與收盤 canonical handoff屬資料集合結構變動，使用 time-anchored snapshot 後完整套用。相同交易日且 candle 數量不變仍走 `series.update()` 與 latest-wins 指標排程，viewport 不得重新提交。

## Risks / Trade-offs

- [Shioaji bootstrap 較慢時初次圖表會多等待數百毫秒] → 顯示明確「等待 Shioaji Kbars」；自動模式 1.5 秒仍未完成才使用已保存的 canonical fallback。
- [來源切換後可用歷史長度本來就不同] → 保留相同日期區間或安全收斂到新來源完整範圍，不偽造不存在的 K 棒。
- [time anchor 在新來源缺少相同交易日時無法完全對齊] → 依單側可用錨點與跨度重建；兩側都不存在時使用新來源 canonical 全範圍。
- [修改共用 viewport 邏輯影響其他補載流程] → 歷史向前補載仍沿用既有 prepend logical offset；新純函式只供來源／結構交接使用。

## Migration Plan

1. 先加入純函式回歸測試與來源顯示時序測試。
2. 接上自動模式 bootstrap gate 與來源交接 viewport snapshot。
3. 執行 MultiView focused tests、browser tests、typecheck、build、OpenSpec strict 與 `git diff --check`。
4. 使用目前 simulation runtime 驗證 00929.TW 自動／Shioaji／Yahoo 三種模式；盤中再驗證首次 snapshot、重連與換日條件。
5. 若發生回歸，可回退前端 gate 與 viewport helper；資料庫與 API 無 migration。

## Open Questions

無。來源完整性沿用既有正式規格，實作不需要新的外部授權或 production 設定。
