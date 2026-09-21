## 驗收時間與環境

- 驗收時間：2026-09-21 16:32（Asia/Taipei，已收盤）
- 頁面：`http://127.0.0.1:5174/`
- 執行模式：Shioaji simulation-only；未啟用 production、CA或真實下單
- 服務守恆：8080 PID 1256、5173 PID 920、5174 PID 926持續監聽；`pnpm local-runtime status`顯示 simulation API、business watchdog、5173、5174與盤後 pipelines均為 loaded／healthy

## 根因與修正

1. Shioaji一分鐘Kbars的原始時間為區間結束時間；實際09:01–13:30共270列代表09:00–13:30的270個一分鐘區間。舊程式直接把原始時間當區間開始，造成1分標籤晚一分鐘，5／15／60分的bucket邊界也可能錯位。
2. `sessionFromKbars`現在保留原始`sourceTime`，canonical `time`固定減60秒；`aggregateMinuteCandles`固定使用bucket開始時間。page cache identity加入`shioaji-end-to-canonical-start/1`，舊時間語意資料不會沿用。
3. Yahoo上游確實可能缺少完成交易日的分鐘邊界。Worker現在依台股時段產生`continuity`、`missingBoundaryIntervals`與安全`reasonCode`；缺少的OHLCV不補造，舊candle payload cache升為`quote-state-v25-intraday-continuity-v1`。
4. UI對分鐘partial顯示實際缺少時段；盤中尚未完成session回報`unknown/session_in_progress`，不誤報缺棒。低流動商品只有內部稀疏且無正式缺失證據時使用`intraday_sparse_or_no_trade`，不把合法無成交直接定性成程式遺失。

## 真實來源矩陣

完整JSON保存在`outputs/multiview-kbar-audit/2026-09-21-source-matrix.json`，可用`node apps/multiview/scripts/audit-kbar-source-continuity.mjs`重跑。

| 商品 | Yahoo 1m | Yahoo 5m | Yahoo 15m | Yahoo 60m | Yahoo 日／週／月 | Shioaji 1m／5m／15m／60m |
|---|---:|---:|---:|---:|---|---|
| 00918.TW ETF | 262，partial，09:02–13:24 | 266，partial | complete | complete | complete／complete／complete | 270／54／18／5，全部complete |
| 2330.TW 普通股 | 265，partial，末筆13:24 | 266，partial | complete | complete | complete／unknown／unknown | 270／54／18／5，全部complete |
| 6146.TWO 上櫃普通股 | 73，partial，09:01–13:23 | 219，partial | complete | complete | unknown／unknown／unknown | 270／54／18／5，全部complete |

- 三檔Shioaji原始資料均為09:01–13:30共270列；正規化後均為09:00–13:29，5分最後一根13:25、15分最後一根13:15、60分最後一根13:00。
- Yahoo 1m與5m是來源真實缺列，強制Yahoo模式保留實際列並顯示partial；自動模式在完整Shioaji可用時採用Shioaji同源candle set。
- Yahoo週／月是同一daily base的確定性聚合。00918既有官方continuity為complete；2330與6146的週／月官方continuity仍為unknown，因此保留未核實狀態，不推論為缺棒，也不冒充complete。

## 真實5174瀏覽器驗收

- `Shioaji 即時`：00918的1m、5m、15m、60m、日、週、月均有價格與canvas；1m／5m／15m／60m continuity均為complete，分鐘狀態顯示「Shioaji Kbars」。
- `Yahoo 延遲`：1m顯示「缺2026-09-21 09:00–09:02、13:25–13:30」；5m顯示各完成交易日缺13:25–13:30；15m、60m、日、週、月正常且未顯示假缺口。
- `自動`：1m、5m、15m、60m均原子採用完整Shioaji Kbars並回報complete；日K正常；週／月保留canonical daily base語意。
- 最後恢復為`自動`＋`日`，價格34.19、continuity complete、42個canvas；瀏覽器console沒有error或warning。

## 自動化驗證

- `node --test apps/multiview/tests/realtime-coordinator.test.mjs apps/multiview/tests/realtime-charts.test.mjs`：46/46通過。
- `node --test apps/multiview/tests/rendered-html.test.mjs`：64/64通過；同時將既有盤中quote測試改成固定平日，避免執行日落在週末造成假失敗。
- `pnpm typecheck:multiview`：通過。
- `pnpm build:multiview`：通過。
- 本次範圍ESLint：通過。
- `openspec validate verify-and-repair-multiview-kbar-source-continuity --strict`：通過。
- `git diff --check`：本次範圍通過。

## 保留限制

- Yahoo來源沒有回傳的分鐘OHLCV無法安全重建，產品只揭露partial，不以Shioaji或推算值混入Yahoo payload。
- 2330與6146的週／月官方daily-base continuity尚未取得complete證據，狀態保持unknown；目前未發現聚合器漏掉已存在daily row的程式錯誤。
