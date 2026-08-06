## Why

固定範圍 VP 在焦點移到另一個範圍後，會隱藏原範圍的 VAH／POC／VAL 價格標籤，且殘留的範圍縱線與過高的不透明度會遮蔽 K 棒與價位線；聚焦範圍的黃色縱向控制線也明顯比水平價位線粗。需要讓多個固定範圍 VP 在焦點切換後仍可讀，並降低視覺遮擋。

## What Changes

- 失焦的固定範圍 VP 保留 VAH／POC／VAL 水平線與價格標籤。
- 失焦的固定範圍 VP 不顯示左右範圍縱線或拖曳控制線。
- 降低固定範圍 VP 柱狀圖、水平線、價格標籤與範圍底色的不透明度，使 K 棒與價位層級仍可辨識。
- 將聚焦範圍左右黃色拖曳控制線調整為 2 CSS px，與一般水平價位線相同粗細。

## Capabilities

### New Capabilities

- `fixed-range-volume-profile-visual-state`: 定義固定範圍 VP 在聚焦與失焦狀態下的水平層級、價格標籤、範圍縱線、柱狀圖與透明度行為。

### Modified Capabilities

- 無。

## Impact

- 前端固定範圍 VP 的 SVG／DOM 渲染與 CSS 視覺狀態。
- 固定範圍 VP 的渲染契約測試與靜態資產 cache key。
- 不變更市場資料 API、計算公式、儲存格式或 Worker 端點。
