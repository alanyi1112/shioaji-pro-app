## Why

Sites 保留站在八圖模式仍為每個 panel 建立獨立且不會主動結束的 `EventSource`。同源長連線與個別初始 request 競爭時，部分 panel 會先更新、其餘 panel 長時間停留在前一交易日快取，造成同一頁報價與 K 線日期不一致。

## What Changes

- 將 Sites 保留站的可見 panel 即時更新改為頁面級 bounded batch polling，與現有 Cloudflare 路徑共用 `/api/candles/batch` contract。
- 八圖首次載入後立即以同一批次刷新所有已訂閱 panel，避免每個 panel 維持獨立無限 `EventSource`。
- 保留前景／背景、離線、休市、online recovery 與 panel destroy／tab 切換時的取消契約。
- 新增回歸測試，證明 Sites 與 Cloudflare 都不會在八圖模式建立逐 panel `EventSource`，且單一商品失敗不會清除其他 panel 的有效結果。
- 以實際 Sites 保留站驗證八格皆顯示同一交易日的新鮮報價，不以稍後自行追上或單一 panel 成功代替。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `codex-sites-rewrite`: Sites 保留站的 1／4／8 圖可見 panel 必須共用有界即時更新，不得因逐 panel 長連線排隊而讓部分 panel 長時間停在舊交易日。

## Impact

- 影響 `public/static/app.js` 的頁面級 live update coordinator 與 panel stream lifecycle。
- 影響 `tests/cloudflare-runtime.test.mjs` 及相關前端 contract tests。
- `/api/candles/batch` response contract 不變；不新增外部依賴、D1 schema 或秘密設定。
- 同一核心程式會同時部署到 Cloudflare 正式站與 Sites 保留站，兩邊必須分開驗收。
