## Why

三欄等多圖版面中的籌碼副圖標題列目前固定單行並裁切溢出內容，造成三大法人、融資券等完整讀值無法查看；新加入商品若只有部分日資料或少量 TDCC 週資料，也只能被動等待排程，缺少安全且可理解的使用者補資料入口。

## What Changes

- 籌碼副圖標題、日期、逐項讀值、狀態與週資料控制項在一列放不下時自動換到下一列，pane 高度同步增加，所有資訊仍保持可讀且不產生水平捲動。
- 在籌碼副圖既有滑鼠右鍵功能表中，只於目前 symbol／pane 確實有可回補缺口時顯示回補操作；TDCC 未達一年歷史時顯示「回補歷史資料」，不得因短目標已完成而誤判為完整。
- 新增已登入使用者可呼叫的安全回補 API：日資料以 Worker `waitUntil` 立即背景補齊缺少 datasets；TDCC 歷史資料只重新排入既有受保護低速 scheduler，不由瀏覽器或 Worker 規避官方限制抓取表單。
- 回補入口加入 symbol、dataset、日期範圍驗證、單一 symbol 防重複、冷卻時間、既有 retry-after 尊重及冪等 D1 狀態；連點不得重複大量呼叫上游。
- 功能表與 pane 顯示「回補已開始／已排入回補／請稍後再試／目前不需回補」等明確狀態，完成後重新讀取 D1 資料。
- 籌碼副圖逐項讀值的名稱固定使用右鍵「線圖項目」對應的系列色，只有數值與方向箭頭依正負值顯示紅／綠／中性色，避免名稱跟著漲跌變色。

## Capabilities

### New Capabilities

- `manual-chip-backfill`: 定義由已登入使用者安全要求單一台股 symbol 補齊缺少日籌碼或排入 TDCC 歷史回補的 API、限流、背景工作與狀態語意。

### Modified Capabilities

- `taiwan-stock-chip-subcharts`: 籌碼副圖標題讀值改為可換行，並在既有右鍵功能表依缺口狀態提供立即回補操作與結果回饋。

## Impact

- 前端：`public/static/chip-panes.js`、`public/static/styles.css`、靜態資產版本與副圖 contract tests。
- Worker：`worker/app.ts`、`worker/tdcc-continuous-backfill.ts`、既有日資料 prewarm 與 D1 continuous target 狀態。
- API：新增單一使用者操作的 `POST /api/taiwan-stock-chip/backfill`；不公開既有內部 secrets，也不新增前端按鈕。
- 資料與排程：沿用既有 D1 tables、single-flight、retry-after、GitHub Actions 與 TDCC 受保護 runner，不新增 schema 或外部 queue。
