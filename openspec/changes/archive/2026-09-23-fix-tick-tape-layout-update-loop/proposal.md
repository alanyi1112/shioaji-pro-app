## Why

成交明細在啟動或商品資料刷新時可能出現 React `Maximum update depth exceeded`，使整個交易終端落入啟動失敗畫面。問題來自版面捲動同步把內容相同但物件參照不同的商品誤判為商品切換，並在 `useLayoutEffect` 中重複寫入相同 state，因此需要讓成交明細能安全承受等價資料重新 render。

## What Changes

- 成交明細以穩定的商品識別值判斷真正的商品切換，不再依賴 `contract` 物件參照。
- 只有 DOM 捲動位置實際改變時才同步 React state，避免 layout effect 形成巢狀更新迴圈。
- 保留真正切換商品、頁籤、檢視或設定 revision 時回到頂端，以及使用者捲離後新成交維持閱讀位置的既有行為。
- 增加瀏覽器回歸測試，覆蓋等價商品物件重新 render、捲動位置與啟動錯誤防護。

## Capabilities

### New Capabilities
- `tick-tape-layout-stability`: 規範成交明細在等價商品資料刷新與捲動同步期間的穩定性，以及真正上下文切換時的捲動語意。

### Modified Capabilities

無。

## Impact

- 主要影響 `src/components/tick-tape.tsx` 的商品身分與捲動狀態同步。
- 增補 `src/components/tick-tape-session.browser.test.ts` 的瀏覽器回歸案例。
- 不變更行情 API、SSE subscription、成交分類、交易模式或下單功能。
