## Context

主圖使用 Lightweight Charts 的 time scale 處理滾輪縮放與按住滑鼠平移。現行 `applyPayload` 會立即 refit 並再排程一次雙 `requestAnimationFrame` refit；`refreshPanelLayout` 也會在每次 ResizeObserver、副圖 layout callback 或 panel 尺寸更新時無條件 refit。這些 callback 可能晚於使用者互動發生，因而把已縮放或平移的範圍改回 `0..candles.length - 1 + rightOffset`。

同時，向左瀏覽觸發歷史補載時已有 `applyPreservedVisibleLogicalRange`，會按新增 K 棒數量平移原範圍；修正不得破壞這條既有路徑。

## Goals / Non-Goals

**Goals:**

- 使用者一開始在主圖滾輪或按住左鍵操作，就讓尚未執行的初始化 refit 失效。
- resize、副圖資料完成與指標重繪不得改變主圖目前可視邏輯範圍。
- 主圖、技術副圖與籌碼副圖繼續同步同一個時間範圍。
- 新商品或週期建立新 chart 時仍顯示預設完整範圍與右側留白。
- 歷史補載仍可保留使用者正在查看的時間位置。

**Non-Goals:**

- 不改變 Lightweight Charts 的縮放倍率、拖曳手感或觸控手勢。
- 不更動 K 棒資料量、歷史補載門檻或 API。
- 不新增跨重整保存縮放範圍的功能。

## Decisions

1. `armHistoryInteraction` 除了啟用歷史補載，也負責取消尚未執行的 `timeScaleFitFrame`。相較只在 refit callback 檢查 flag，主動取消可避免多餘 callback，並讓 wheel 與 pointerdown 共用同一條使用者接管邏輯。
2. `refreshPanelLayout` 在 resize 前讀取主圖 `visibleLogicalRange`，完成主圖、副圖與籌碼 pane resize 後，以既有同步函式恢復該範圍。若當下尚無有效範圍，就不擅自 refit；初始資料載入仍由 `applyPayload` 負責設定預設範圍。
3. `applyPayload` 在已有使用者互動且未指定歷史補載 anchor 時，保存呼叫前範圍並在重繪後恢復。這涵蓋指標切換與同一商品的非同步重繪，不影響新 chart 的初始 fit。
4. `scheduleTimeScaleRefit` 執行前再次檢查使用者互動狀態，作為事件排序的防線。即使取消發生在第二個 animation frame 的臨界點，也不得重設範圍。
5. 保留 `applyPreservedVisibleLogicalRange` 作為歷史補載的優先路徑；其 anchor 與新增 K 棒位移語意比一般使用者範圍保存更精確。

## Risks / Trade-offs

- [resize 後範圍邊界可能短暫超出資料] → Lightweight Charts 支援 logical range 超出資料邊界，且歷史補載本來就依賴此行為；持續使用既有 finite range 驗證。
- [初始載入時 ResizeObserver 先於資料完成] → 無有效範圍時只 resize 不 refit；資料到達後 `applyPayload` 會設定完整範圍。
- [使用者只點一下主圖也被視為接管範圍] → 這是保守選擇；點擊後保留當前範圍比稍後突然顯示全部 K 棒更符合預期。
- [副圖 layout callback 頻繁恢復相同範圍] → 同步函式只處理有限範圍，成本低於完整 refit，且避免可見跳動。
