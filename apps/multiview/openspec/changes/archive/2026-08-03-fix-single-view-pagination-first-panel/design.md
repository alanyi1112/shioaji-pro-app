## Context

目前前端以 `state.singleChartView` 同時表示兩件事：`view=single` deep-link 的初始商品，以及第一個 panel 的預設商品。多圖頁面重新使用同一份 state 時，`defaultSymbolForPanel(0)` 會把 deep-link 商品重新套回第一格；而 `applySingleChartView()` 又把商品在完整清單中的 index 直接寫入 `categoryPageByTabId`，沒有依當時圖表數量換算頁碼。

正式站可重現的資料流如下：

```text
view=single&symbol=00919.TW
        │
        ├─ 初始化 1 圖：singleChartView 綁定 00919.TW
        ├─ 使用者改為 6 圖：原 singleChartView 仍存在
        ├─ 分頁切換：其餘 panel 依頁碼切換
        └─ panel 0：defaultSymbolForPanel() 再次釘回 00919.TW
```

## Goals / Non-Goals

**Goals:**

- 讓單圖 deep-link 只在 1 圖期間指定單一商品與週期。
- 切換至 2／3／4／6／8 圖後，所有 panel 均使用目前頁籤與目前頁碼的同一份 canonical 商品切片。
- 讓單圖商品轉入多圖時，初始頁碼落在包含該商品的正確頁面，之後可正常逐頁切換。
- 讓 6／8 圖只使用單一副圖；切回其他圖數時不遺失使用者原本選取的主副圖偏好。
- 保留雙擊開啟單圖 URL、單圖重新載入與一般多圖直接載入的既有行為。

**Non-Goals:**

- 不變更 Worker API、D1 schema、商品排序、頁籤排序或資料來源。
- 不修改單圖 URL 的商品驗證與 fallback 規則。
- 不處理 `add-mainforce-chip-subcharts` 的資料來源或 UI 規劃。

## Decisions

1. **以圖表數量作為 single-view 狀態邊界。**
   - `defaultSymbolForPanel()`、`defaultIntervalForPanel()`、台股副圖資格判定與 debug mode 只有在目前圖表數量為 1 時才讀取 `singleChartView`。
   - 切換到多圖時清除 page-scoped single-view state，並移除目前 URL 的 `view／symbol／interval／tab` query，避免重新整理又回到已離開的單圖模式。
   - 選擇此方案而非只移除第一個 panel 的特殊條件，是因為舊 single-view state 也會污染副圖資格、debug 報告與 chart-count 偏好保存。

2. **以商品 index 除以 page size 計算頁碼。**
   - 單圖 deep-link 初始化與從單圖切換至多圖時，使用 `Math.floor(symbolIndex / chartCount)` 計算分類頁 index。
   - 選擇在狀態轉換時重算，而非改變 `categoryPaginationState()` 的通用語意，避免影響既有一般頁碼與相鄰頁預載。

3. **切換圖表數量時先完成狀態轉換，再 render panels。**
   - count change handler 先保存單圖商品對應的多圖頁碼、清除 single-view route，再依新的 chart count 呼叫 `renderCategoryPagination()` 與 `renderPanels()`。
   - 一般多圖切換不重設目前頁籤與頁碼；若新圖表數量使頁碼超出範圍，沿用既有 pagination clamp。

4. **6／8 圖以有效模式強制單一副圖。**
   - `effectiveChartPresentationMode()` 在目前圖表數量為 6 或 8 時一律回傳 `single`。
   - `#compact-subchart-mode` 停用 `main` 與 `multi` 選項，但保留控制項與單一副圖選項可見；切回其他圖數時依然使用原本保存的偏好。
   - 多層副圖資格判定在 6／8 圖回傳不可用，避免頁面捲動與副圖 controller 依照多層模式啟動。

5. **以 source-level contract 加上 live browser 驗收。**
   - 自動測試保護 helper／handler 的狀態邊界、商品切片與 URL cleanup。
   - 瀏覽器驗證從有效 `view=single` URL 進入後切換 1／2／3／4／6／8 圖，逐頁確認第一個 panel 不重複且所有 panel 商品與頁碼一致；同時驗證一般首頁與市場頁籤切換。

## Risks / Trade-offs

- [Risk] 使用者在單圖 URL 中把圖表數量改成多圖後，URL 會被正規化為一般多圖 URL。→ [Mitigation] 只在使用者明確變更 chart count 時執行，保留目前頁籤、商品排序與正確多圖頁碼。
- [Risk] 單圖商品不在目前有效頁籤時可能無法計算目標頁。→ [Mitigation] 先沿用既有 `resolveSingleChartViewRequest()` 的有效 tab／symbol fallback；找不到 index 時保留既有 pagination clamp，不產生越界頁碼。
- [Risk] 既有單圖 deep-link 測試可能依賴 `state.singleChartView` 永久存在。→ [Mitigation] 只在 1 圖生命週期保留該 state，並新增從單圖轉多圖的明確回歸情境。
