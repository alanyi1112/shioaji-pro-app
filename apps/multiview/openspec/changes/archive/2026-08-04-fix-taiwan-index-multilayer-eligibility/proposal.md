## Why

Sites 保留站的「台股」頁籤同時包含 `^TWII` 台灣加權指數與 `.TW`／`.TWO` 商品，現行資格判斷因此把整個頁籤誤認為混合市場，連帶停用 1／2／3／4 圖的多層副圖。這違反使用者對台股市場頁籤的操作預期，也讓後續台股商品無法使用已保存的籌碼副圖。

## What Changes

- 將台灣市場基準指數視為台股頁籤的多層副圖相容商品，不再因 `^TWII` 存在而封鎖整個頁籤。
- 保留 panel 級資格防線：不具台股籌碼資格的指數 panel 只顯示技術副圖，不建立或請求籌碼 pane。
- 保留 6／8 圖固定單一副圖政策；只有 1／2／3／4 圖可依台股頁籤資格切換主圖、單一副圖與多層副圖。
- 非台股及真正跨市場的混合頁籤仍停用多層副圖，且不得覆寫使用者保存的模式偏好。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `taiwan-stock-chip-subcharts`：補充台灣市場指數與台股商品共存時的頁籤級及 panel 級多層副圖資格。
- `codex-sites-rewrite`：修正台股市場頁籤多圖 parity，並維持 6／8 圖固定單一副圖邊界。

## Impact

- 前端資格與呈現模式：`public/static/app.js`。
- 前端回歸測試：`tests/subchart-interaction.test.mjs`、必要的 rendered HTML 契約測試。
- OpenSpec 主規格：`taiwan-stock-chip-subcharts`、`codex-sites-rewrite`。
- 不變更 Worker API、D1 schema、籌碼資料來源或使用者已保存的 pane 選取與排序。
