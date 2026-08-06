## Why

多圖配置的下排 panel 仍將「主圖」與「副圖」功能表固定向下展開；當主圖選項、數值顯示與繪圖工具累積成較高的單欄內容時，功能表會超出瀏覽器可視範圍，導致部分選項無法看見或操作。需要建立一致的 viewport-safe 功能表契約，讓 1／2／4／6／8 圖與不同視窗高度都能完整操作。

## What Changes

- 讓每個 chart panel 的「主圖」與「副圖」功能表依按鈕上下可用空間，自動選擇向下或向上展開。
- 當任一方向都不足以容納完整內容時，將功能表限制在 viewport 安全邊距內並提供垂直捲動，不允許選項被瀏覽器邊界截斷。
- 將「主圖」指標選項改為適合窄 panel 的緊湊多欄排列，長標籤維持完整可讀；數值顯示控制與繪圖工具保留清楚分區。
- 將費波那契回撤、費波那契拓展、價格範圍與清除繪圖按鈕改為緊湊兩欄排列，降低功能表高度而不縮小點擊範圍。
- 主項文字維持可讀字級，保留 checkbox、button、select 的完整操作範圍、DOM／鍵盤順序、既有選取狀態、外部點擊收合及 Escape 行為。
- 補上 CSS／互動契約測試與實際瀏覽器驗收，涵蓋多圖上下排、視窗邊界、捲動 fallback 與鍵盤操作。

## Capabilities

### New Capabilities

- `chart-indicator-menu-viewport-safety`: 定義主圖／副圖功能表的 viewport-safe 展開方向、邊界限制、捲動 fallback，以及主圖選項與繪圖工具的緊湊排列與操作可及性。

### Modified Capabilities

無。

## Impact

- 影響 `public/static/index.html` 的主圖選項分組結構、`public/static/styles.css` 的功能表尺寸與排列，以及 `public/static/app.js` 的功能表定位與生命週期控制。
- 需調整 `tests/subchart-interaction.test.mjs` 與必要的渲染 HTML 測試，並在 1／2／4／6／8 圖、上排／下排與較矮 viewport 驗證實際可見及可操作結果。
- 不變更 checkbox value、指標計算、資料請求、偏好保存格式、圖表 series、Worker API、D1／R2 schema 或 Sites runtime 綁定。
