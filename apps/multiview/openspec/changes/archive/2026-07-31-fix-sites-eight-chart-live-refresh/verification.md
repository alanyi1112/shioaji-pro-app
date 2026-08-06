## 驗證摘要

- 驗證日期：2026-07-31（Asia/Taipei）
- 修正 commit：`d8abd4d68adb2741eb8d287dd73f61aefd5662ed`
- Cloudflare 正式站 push deployment：GitHub Actions run `30600820514`，`event=push`、`conclusion=success`、`headSha` 與修正 commit 完整相符。
- Sites 保留站：version 164，source commit 與修正 commit 完整相符，production deployment `succeeded`。

## 自動化驗證

- 聚焦測試：95／95 通過。
- 完整 `npm test`：345／345 通過，包含 production build。
- `npm run lint`：0 errors、0 warnings。
- `npx openspec validate --all --strict`：37／37 通過。
- `git diff --check`：通過。
- `npm run cloudflare:budget`：通過；估算每日 requests 6,746／50,000、D1 rows read 622,690／3,500,000、D1 rows written 26,720／50,000。
- coordinator 行為測試證明：in-flight 新 subscription 會立即補跑、visible／online recovery 會取代既有低頻 timer、最後 subscription 取消後不再排程。

## Cloudflare 正式站驗收

- 實際載入 `/static/live-batch-coordinator.js?v=20260731-sites-eight-chart-v1` 與同版 `app.js`。
- 依序切換 1／4／8 圖，panel 數量分別為 1、4、8，所有可見 panel 均為 2026-07-31 本交易日資料。
- 八圖切換後 8／8 panel 均完成載入；切換動作會銷毀並重建 panel subscription，未出現舊 panel payload 套用或批次中斷。

## Sites 保留站驗收

- 既有授權 session 重新載入後，確認實際載入 `/static/live-batch-coordinator.js?v=20260731-sites-eight-chart-v1` 與同版 `app.js`。
- 台股第 1／4 頁八圖：8／8 panel 均顯示 2026-07-31 資料，未再出現半數停在前一交易日。
- 台股第 2／4 頁八圖：8／8 panel 均顯示 2026-07-31 10:54，且沒有「中斷／錯誤／失敗」狀態。
- 驗收未使用匿名 `401`、舊 health、cookie 或 bypass token 代替實際頁面結果。
