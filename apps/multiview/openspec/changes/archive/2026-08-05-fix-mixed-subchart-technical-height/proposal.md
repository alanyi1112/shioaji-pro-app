## Why

四圖多層副圖頁面若同時包含可建立籌碼 pane 的台股與只能保留單一技術副圖的台灣市場指數，grid 會進入長頁面版型，但指數 panel 的方式 A 技術副圖高度會在 `auto` row 中歸零。這會讓已選取且已有資料的 KD／ATR 線圖不可見，違反混合頁籤與技術副圖可見性契約。

## What Changes

- 在多層副圖長頁面版型中，為回退至方式 A 技術副圖的 panel 保留固定緊湊高度。
- 保持沒有選取技術指標時收合副圖列的既有行為。
- 新增四圖混合 `^TWII` 與 eligible 台股商品的 CSS／版面回歸測試，避免技術指標再次被壓成 0 高。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `taiwan-stock-chip-subcharts`: 補強多層副圖長頁面中，無籌碼資格 panel 回退至方式 A 技術副圖時仍須維持可見緊湊高度的規格。

## Impact

- 影響 `public/static/styles.css` 的混合副圖 page-scroll 版面規則。
- 影響副圖互動與渲染 HTML 回歸測試。
- 不變更 API、D1 schema、資料來源、授權或任何秘密設定。
