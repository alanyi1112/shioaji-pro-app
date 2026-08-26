# PE gap report（2026-08-26）

## 判讀基準

- 本報告以本機 D1 的 `taiwan_stock_pe_backfill_job`、`taiwan_stock_pe_fetch_state` 與 `taiwan_stock_pe_valuation_daily` 為證據。
- `history missing=15` 代表 15 個 job 尚未完成全部月份 checkpoint，不等於 15 檔完全沒有資料。
- `latest pending=12` 需區分官方未發布、官方明確無有效 P/E、只有少量 latest row，以及真正的 parser／排程缺陷。
- 實際 TPEx OpenAPI 在 2026-08-26 驗收時，PE 日期為 2026-08-25、quotes 日期為 2026-08-26；這是合法但尚未同日，不是 schema mismatch。

## 逐商品分類

| 分類 | 商品 | D1 證據 | 處理 |
| --- | --- | --- | --- |
| 官方未發布／新 ETF 歷史不足 | `00981A.TW`、`00982A.TW`、`00991A.TW` | 0 rows、history `partial/insufficient_history`、latest `official_not_published` | 保留 insufficient／pending，不造假資料 |
| 官方明確無有效 P/E | `3363.TWO`、`3055.TW`、`3149.TW` | 0 rows、latest `official_gap` | 保留 official gap，不以零值或舊值補入 |
| 已有少量 latest，history 尚未執行 | `3081.TWO`、`3163.TWO`、`3441.TWO`、`3680.TWO`、`8027.TWO`、`2801.TW`、`2834.TW`、`3026.TW`、`4958.TW` | 1 至 2 rows、verified end 2026-08-25、job `queued 0/61` | 依 budget／checkpoint 執行 bounded history，不視為 parser 失敗 |
| latest 已可用，history checkpoint 尚未完成 | `3481.TW`、`4967.TW`、`6505.TW` | 650／843／1094 rows、latest `available`、job 仍 queued | 繼續未完成月份，不重抓或覆蓋 verified rows |
| history 已完成 | `1303.TW`、`2344.TW`、`2408.TW`、`2409.TW`、`2615.TW` | 589 至 1098 rows、job complete、FinMind overlap verified | 不列入修正 |

## 程式修正範圍

1. 將 TPEx 合法但 PE／quotes 日期無交集改判為 `official_not_published`。
2. 只有 payload 型別錯誤、必要欄位不存在或同日資料無法正規化時才回 `schema_mismatch`。
3. health 分開保存本次 attempt 與最後 verified source date，避免舊日期掩蓋本次失敗。
4. 失敗 attempt 不修改 valuation rows；history 仍依既有 checkpoint 與 budget 有界執行。
