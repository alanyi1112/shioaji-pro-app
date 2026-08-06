## Context

固定範圍 VP 的範圍名稱仍需保留在設定清單、命中區資料與選取流程中，但 VAH／POC／VAL 價格標籤不再需要重複顯示該名稱。現行水平線基底為 2px，POC 再覆寫為 3px；聚焦範圍的左右拖曳控制線則為先前確認的 2px。

## Goals / Non-Goals

**Goals:**

- 價格標籤只顯示 `VAH／POC／VAL + 格式化價格`。
- VAH、POC、VAL 水平線全部為 1 CSS px。
- 保留既有顏色、虛實線型、透明度、重新選取與拖曳能力。
- 保持左右黃色控制線為 2 CSS px，讓其仍有足夠的拖曳命中提示。

**Non-Goals:**

- 不移除設定清單內的「範圍 1／範圍 2」名稱，也不修改命名功能。
- 不變更固定範圍 VP 計算、VAH／POC／VAL 價位、保存格式、Worker API 或 D1。
- 不調整柱狀圖、標籤框、顏色與透明度。

## Decisions

1. `appendFixedProfileLevel` 直接以 `${entry.label} ${formattedPrice}` 產生價格標籤，並移除這條渲染路徑不再需要的 `rangeName` 參數。範圍名稱本身仍保留在 `profileRange` 與設定 UI，不進行資料遷移。
2. `.fixed-profile-level` 的 `border-top-width` 統一改為 `1px`，POC 不再另設 3px。VAH dashed、POC solid、VAL dotted 與各自色彩仍能提供辨識。
3. `.fixed-profile-drag-handle` 維持 2px。這是可拖曳控制元件，與純資訊水平線採不同粗細，避免 1px 命中提示過細。
4. 更新 `styles.css` 與 `app.js` cache key，確保部署後瀏覽器取得新版資產。

## Risks / Trade-offs

- [多個固定範圍 VP 的同級價格標籤不再直接顯示所屬範圍] → 保留既有顏色、位置、聚焦／失焦透明度及可點選行為，設定清單仍顯示範圍名稱。
- [1px POC 的粗細辨識降低] → 保留 POC 黃色實線，與 VAH 虛線、VAL 點線持續以顏色及線型區分。
