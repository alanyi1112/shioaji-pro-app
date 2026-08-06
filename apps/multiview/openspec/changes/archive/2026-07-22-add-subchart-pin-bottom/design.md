## Context

籌碼副圖以三個固定 group wrapper 管理排序，右鍵功能表已提供「置頂」、上移與下移，manager 會以 `movePaneInOrder` 更新完整群組順序並依 `tabId + canonical symbol` 保存。這次需加入對稱的「置底」，且不可拆散群組、增加資料請求或改變方式 A 的單一副圖語意。

## Goals / Non-Goals

**Goals:**

- 每個籌碼 pane 的右鍵功能表都固定顯示「置底」。
- 方式 B 中一次將完整群組移到最後一個可見群組位置。
- 已在底部及方式 A 時明確 disabled。
- 沿用既有排序保存、DOM 更新、layout refresh 與生命週期清理模式。

**Non-Goals:**

- 不調整群組內 pane 的 canonical child order。
- 不新增常駐工具列按鈕或改變拖曳、上移、下移、置頂行為。
- 不變更資料 API、D1、資料來源或籌碼內容。

## Decisions

1. **在既有排序區加入對稱操作**：將「置底」放在「置頂」旁，並使用獨立 accessible name。這比把「下移」重複觸發多次更直接，也讓停用狀態可被使用者預先理解。
2. **manager 以最後索引移動完整群組**：新增 `canPinPaneToBottom` 與 `pinPaneToBottom`，解析 pane 的 group id 後，以 `desiredGroupIds().length - 1` 作為 target index。沿用 `saveVisibleGroupOrder`、`applyControllerOrder`、`updateInputs` 與單次 `onLayoutChange`。
3. **不重新載入資料**：置底只重排既有 controller DOM，與置頂相同，不呼叫 `load` 或建立新的資料請求。
4. **方式 A 保留可見但停用**：右鍵功能表維持一致資訊架構；僅方式 B 且目標群組不是最後一組時可操作。

## Risks / Trade-offs

- [風險] 新增的功能表項目可能未正確更新 disabled 狀態 → 由每次開啟功能表時的 `updateOrderControls` 重新計算，並加入首尾群組回歸測試。
- [風險] 置底重複保存或觸發多次 layout refresh → manager 沿用置頂的單一路徑，測試鎖定一次保存與一次 refresh。
- [風險] listener 未清理造成 panel 重建後重複動作 → 在 controller `destroy` 中移除「置底」click listener，並擴充 lifecycle contract 測試。

## Migration Plan

1. 新增功能表控制與 manager callback。
2. 更新靜態資源版本並執行 lint、build、完整測試與 OpenSpec strict validation。
3. 在本機實際操作置底與重新整理保留順序。
4. 發布 private Sites 版本；若需回退，部署前一個已成功版本即可。

## Open Questions

無。
