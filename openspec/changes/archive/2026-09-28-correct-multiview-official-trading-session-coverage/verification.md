# 2026-09-28 逐檔唯讀核對

- 時區：Asia/Taipei；核對於 2026-09-28 19:05 左右。
- 官方年度來源：TWSE `holidaySchedule`、TPEx `tradingDate`，交叉一致；日曆版本 `sha256:2a6911b076ecf7d1678036862b5806d8d4a05aa63ab94730c912c908ec4941ff`。9/25、9/28 為休市，最近已完成交易日為 9/24。
- D1：本機既有資料庫，以 read-only SQLite 連線與 `PRAGMA query_only=ON` 核對 `user_instruments`、`candle_history`、`candle_history_state`。沒有刪改清單、日 K、continuity 舊結果或失敗收據。僅由受保護內部入口加入一筆有期限的官方日曆快取。
- `apps/multiview/scripts/audit-official-daily-coverage.mjs` 逐檔比較 9/1–9/24 的 18 個官方預定交易日與 D1 真實 K 棒日期：61/61 檔各有 18/18 棒，且 61/61 檔最後一棒均為 9/24。這只證明此期間沒有「缺棒候選」，不代表全部歷史或所有指標都完整。
- 5174 實際 `/api/health`：`expectedCompletedSession=2026-09-24`、`calendar.status=verified`、`latestSessionCoverage=61/61`、`latestSessionVerified=7/61`。其餘 54 檔的 continuity 仍是 `unknown`，不可升格為 complete。
- 本機 Worker 直接向官方站抓年度表曾回 `calendar_twse_fetch_failed`；既有 Node 盤後工作可讀官方資料，因此新增受保護、雙重驗證、有期限的 D1 日曆快取。手動只執行 `--calendar-only` 種入 2026 官方表，沒有啟動 continuity run、回補或重啟服務。後續既有每日 16:45 runner 會先更新官方日曆；來源失敗不沿用過期快取。

## 逐檔狀態

以下每檔在 9/1–9/24 均有 18/18 個預定交易日 K 棒；分組只表示既存稽核狀態，不抹去歷史異常。

| 舊稽核狀態與原因 | 檔數 | 商品 |
| --- | ---: | --- |
| `complete`，最新日已覆蓋且既有稽核無缺口 | 7 | 0050.TW、0056.TW、009816.TW、009819.TW、00991A.TW、1303.TW、1809.TW |
| `unknown / audit_request_budget` | 11 | 3081.TWO、3163.TWO、3189.TW、3363.TWO、3441.TWO、3675.TWO、3680.TWO、4768.TWO、5439.TWO、8027.TWO、8054.TWO |
| `unknown / provider_unavailable` | 2 | 2412.TW、2436.TW |
| `unknown / invalid_response` | 41 | 006208.TW、00878.TW、00918.TW、00919.TW、00929.TW、00981A.TW、00982A.TW、2301.TW、2308.TW、2317.TW、2327.TW、2330.TW、2344.TW、2382.TW、2395.TW、2408.TW、2409.TW、2449.TW、2454.TW、2603.TW、2615.TW、2801.TW、2834.TW、2881.TW、2882.TW、2891.TW、3008.TW、3026.TW、3037.TW、3055.TW、3149.TW、3231.TW、3481.TW、3711.TW、3715.TW、4958.TW、5871.TW、6257.TW、6505.TW、8046.TW、8103.TW |

## 尚未證明

54 檔舊稽核失敗／未知的較早歷史尚未重新取得逐商品官方月報證據；不能宣稱它們的所有歷史缺口是休市誤報。2024 年官方年曆目前來源無法通過 schema 驗證，因此全歷史重算保持待查，工具預設只核對最近一個月。若有臨時停市但年度表尚未更新，應另查官方臨時公告；本次沒有以個股成交量判斷市場是否為交易日。

## 驗證結果

- `pnpm exec tsc --noEmit -p apps/multiview/tsconfig.json`：通過。
- `pnpm --dir apps/multiview build`：通過；vinext 的既有靜態分析提示仍存在，不影響編譯。
- `node --test`：`candle-history`、官方日曆、local continuity runner、local runtime schedule 四個 focused 檔案合計 38/38 通過。
- `openspec validate correct-multiview-official-trading-session-coverage --strict`、`git diff --check`：通過。
- 未執行整庫測試、重啟服務、archive、commit 或 push；54 檔舊稽核 unknown 與全歷史待查維持原樣。

## 2026-09-28 19:38 再次唯讀分類

- 對同一個本機 D1 以 `node:sqlite` 的 `readOnly: true`、`PRAGMA query_only=ON` 查詢；先將啟用清單依 canonical symbol 去重，再連到 `candle_history_state`。若直接按清單列數計算，跨頁籤重複商品會被重複計入：原始列為 85，實際商品為 61。全程未改寫 D1、continuity state、來源 K 棒或失敗收據。
- 61 檔中，`complete` 7 檔；`unknown / invalid_response` 41 檔、`unknown / audit_request_budget` 11 檔、`unknown / provider_unavailable` 2 檔。54 檔 `unknown` 的 `missing_session_count` 目前均為 0，但因完整稽核未通過，**不能**由零推論歷史無缺口。
- 以既有唯讀官方交易日稽核器將範圍擴大到 2026-01-01～2026-09-24：61/61 檔都有 9/24 K 棒；以各檔**在庫首根 K 棒**之後的官方預定交易日為母體，`candidateMissingSymbols=0`。這只排除該期間的在庫缺日候選；在庫首日不等於正式上市日，也不驗證 OHLCV 值、較早歷史、停復牌或來源完整窗。
- 嘗試擴大到 2025-01-01 時，既有 TWSE `holidaySchedule?queryYear=114` 回應 `stat=ok`，但資料第一列為 `2026-01-01`；parser 因年份不符正確拒絕為 `TWSE official calendar response is invalid`。因此 2025 年官方日曆無法由此端點驗證，沒有用週一至週五或個股有無成交取代官方 authority。TPEx 歷史公告可供後續獨立交叉核對，尚未導入目前稽核器。
- 下一步應先找可機器驗證、具版本與日期的 TWSE／TPEx 2025 及更早歷史開休市資料，再逐檔重算；在來源未成立前，41／11／2 的原因只能視為**稽核阻斷分類**，不是已證實的商品缺棒或休市誤報。維持 54 檔 `unknown`，不啟動回補。
