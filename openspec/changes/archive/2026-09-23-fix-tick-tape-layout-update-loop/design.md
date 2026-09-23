## Context

`TickTape` 以虛擬清單呈現大量成交資料，並在 `useLayoutEffect` 中處理商品／頁籤／檢視／設定切換與新成交插入時的捲動位置。現行判斷把完整 `contract` 物件放入前次上下文；watchlist、cache 或行情刷新即使仍是同一商品，也可能產生新的等價物件。effect 因此誤判切換、修改 DOM 捲動位置，接著無條件呼叫 `setScrollTop`。在同步父層更新期間，這會累積 React nested updates，最終觸發 `Maximum update depth exceeded` 並使啟動失敗。

修復必須局限於成交明細的版面狀態，不改變 history、SSE、去重、coverage、大單分類或交易行為。工作樹同時有分價量表與資金流向的進行中變更，因此實作也必須相容於三種檢視。

## Goals / Non-Goals

**Goals:**

- 同一商品的等價 `contract` 物件重新 render 時，不重置捲動位置且不產生重複 state update。
- 真正切換商品、成交頁籤、檢視或設定 revision 時，仍依既有語意重置捲動位置。
- 新成交加入時，保留使用者已捲離頂端後的可見內容錨點。
- 以瀏覽器測試重現等價物件刷新，防止回歸。

**Non-Goals:**

- 不重寫成交明細 session hook、SSE 或 IndexedDB 流程。
- 不變更分價量表、資金流向的計算公式或版面。
- 不啟用 production 或觸發任何交易寫入。

## Decisions

### 1. 以穩定商品鍵取代物件參照

版面上下文保存由 `security_type`、`exchange`、`code` 與 `target_code` 組成的商品鍵。這些欄位表達成交 session 身分，等價物件會得到相同鍵，真正切換商品才會得到不同鍵。

替代方案是要求所有父層永久 memoize `contract`，但商品物件來自 watchlist、cache 與即時資料等多條路徑，無法以單一父層保證；在元件邊界正規化更可靠。

### 2. DOM 捲動值只有改變時才寫入 React state

元件使用 ref 保存最近一次已同步的捲動值。layout effect 完成必要的 DOM 調整後，先比較實際 `element.scrollTop` 與 ref；只有數值改變才呼叫 `setScrollTop`。使用者的 `scroll` 事件也同步更新同一 ref，確保 effect 不會把已知值再次寫回 state。

替代方案是在 setter 內回傳相同 state，但 React 仍需排入更新才能判斷，因此無法消除 layout effect 中不必要的同步 dispatch。

### 3. 以行為測試覆蓋根因而非只比對實作

瀏覽器測試先建立捲動位置，再以新的等價 `contract` 物件重新 render，驗證捲動位置不變且沒有啟動錯誤；另保留真正上下文切換的既有語意。這能直接辨識原本的物件參照誤判。

## Risks / Trade-offs

- [商品鍵欄位不足以區分少數衍生商品] → 納入現有 session 使用的 `security_type`、`exchange`、`code`、`target_code`，並沿用不支援商品的既有 fail-closed 行為。
- [瀏覽器對 `scrollTop` 可能有小數差異] → 比較時採用極小容差，避免視覺上相同的位置造成重複更新。
- [進行中成交明細變更共用同一元件] → 只修改捲動同步與測試，不觸碰資料衍生與 API 邏輯，並執行三種檢視相關的 focused tests。

## Migration Plan

此變更沒有資料遷移。部署後由 HMR 或重新載入套用；若需回復，只需還原成交明細的穩定商品鍵與 guarded scroll sync 修改。

## Open Questions

無。
