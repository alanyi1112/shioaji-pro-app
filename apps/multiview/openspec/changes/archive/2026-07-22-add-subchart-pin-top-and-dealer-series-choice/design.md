## Context

籌碼副圖已將十個 panes 分成「法人」、「融資券」與「大戶持股」三個 group wrapper，並保存 `modeBGroupOrder`。現有右鍵功能表只提供逐格上移、下移；自營商 pane 則只有固定的 `dealerTotalNetShares` 柱，雖然資料模型已有 `dealerSelfNetShares` 與 `dealerHedgingNetShares`，卻未接入可見 series 選擇。

本次變更不新增資料來源或 API 欄位，只擴充既有前端群組排序及 `seriesByPane` 偏好模型。

## Goals / Non-Goals

**Goals:**

- 所有籌碼 pane 的右鍵功能表固定提供「置頂」，在方式 B 將所在資料群組一次移到最上方。
- 群組置頂沿用現有排序保存、DOM 重排、layout refresh 與 canonical child order。
- 自營商 pane 可繪製自行、避險與合計，首次使用預設只顯示自行。
- 自營商 header 讀值只顯示目前選取的項目，並保留各 tab、symbol、pane 的既有偏好。

**Non-Goals:**

- 不改變技術指標副圖的位置；技術副圖在現有方式 B 本來就位於所有籌碼群組之前。
- 不拆分「法人」群組中的單一 pane 到其他群組，也不改變群組內 canonical 順序。
- 不修改三大法人、自營商來源欄位、後端 API 或資料回補排程。

## Decisions

### 1. 「置頂」操作群組而不是單一 pane

右鍵來源仍是個別籌碼 pane，但 manager 先以 `groupForPane(paneId)` 找到群組，再將該群組從目前可見順序移到索引 0。這可維持既有「同群組 panes 必須相鄰」的產品規則，且能直接重用 `saveVisibleGroupOrder()` 與 `applyControllerOrder()`。

替代方案是只移動單一 pane；這會破壞 group wrapper 與 canonical child order，因此不採用。

### 2. 功能表固定顯示「置頂」並以 disabled 表達不可用

「置頂」在每個籌碼 pane 的功能表都存在。方式 A、目前只有一個可見群組，或該群組已在最上方時設為 disabled；方式 B 且群組不在最上方時才可操作。固定項目可避免功能表高度與鍵盤順序隨情境跳動。

### 3. 自營商沿用通用 `PANE_SERIES_OPTIONS`

新增 `dealer-flow` 設定，三個 series 分別對應：

- `self` → `dealerSelfNetShares`
- `hedging` → `dealerHedgingNetShares`
- `net` → `dealerTotalNetShares`

預設為 `['self']`。繪圖、右側數值軸、右鍵勾選及 `seriesByPane` 保存均沿用既有外資／投信架構，不建立第二套狀態。

### 4. 不允許取消最後一個自營商項目

通用 series checkbox 仍允許複選，但 `dealer-flow` 在變更後若選取集合為空，會恢復使用者剛取消的項目並不寫入空陣列。這避免自營商 pane 存在卻沒有任何可見資料；其他 panes 保持既有行為。

### 5. 保存狀態採向後相容補值

`readSelection()` 只在既有 `seriesByPane['dealer-flow']` 不存在時套用新預設 `['self']`；若已有合法值則原樣保留。版本號更新只用於辨識目前預設集合，不以版本號強制覆寫使用者設定。

## Risks / Trade-offs

- [既有使用者沒有自營商 series 設定] → `readSelection()` 依新預設補上 `self`，不影響其他 pane 偏好。
- [舊資料只有合計而自行或避險缺值] → 只畫實際非 `null` 資料並顯示「無資料」，不得以合計反推組成值。
- [置頂造成不必要資料重載] → 只重排既有 group DOM、保存一次並觸發一次 layout refresh，不呼叫 `load()`。
- [方式 A 誤認為可排序] → 功能表保留但將「置頂」設為 disabled，並以程式層 `canPinToTop()` 再次阻擋。

## Migration Plan

1. 先部署前端程式與測試；既有 localStorage payload 由 `readSelection()` 漸進補上自營商預設。
2. 驗證方式 B 群組置頂、頁面重載後順序、自營商三項切換與首次預設。
3. 若需回復，可回滾前端版本；既有 `seriesByPane['dealer-flow']` 只會成為舊版忽略的額外欄位，不需資料清除。

## Open Questions

無。
