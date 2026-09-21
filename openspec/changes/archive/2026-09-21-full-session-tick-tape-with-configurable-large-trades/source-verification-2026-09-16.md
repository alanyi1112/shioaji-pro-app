# Shioaji 成交來源核實（2026-09-16）

## 結論

本 change 採用一次性的 `AllDay`、`RangeTime` 與 Snapshot 三方核對，不以歷史 API 高頻輪詢。只有下列條件同時成立，才把台股「全部」標記為已核實：

1. `AllDay` 中 09:00:00（含）至 14:00:00（不含）的逐筆欄位與 `RangeTime(09:00:00–13:59:59)` 依序、依出現次數完全一致。
2. `AllDay` 全部 `volume` 加總與 Snapshot `total_volume` 相等。
3. 歷史 regular-session 成交由開盤起逐筆累加的量，與 live `total_volume` 連續；同累計量視為重播，不同累計量即使時間、價格、張數相同仍保留。

任一條件不成立就維持「部分資料」並保存缺口原因。只有 `AllDay`、`RangeTime` 都空且 Snapshot `total_volume = 0`，才顯示「確認無成交」。

## 官方欄位與使用限制

- [Shioaji Historical Market Data](https://sinotrade.github.io/tutor/market_data/historical/) 說明 `AllDay`、`RangeTime`、`LastCount`，並將 ticks／kbars 定位為盤後與回測資料，不應盤中反覆輪詢。
- [Shioaji Stocks Streaming](https://sinotrade.github.io/tutor/market_data/streaming/stocks/) 的即時 stock tick 提供 `total_volume`、`simtrade`、`intraday_odd`；盤中零股使用不同訂閱。
- 本機 OpenAPI 1.7.1 的歷史 `Ticks` schema 只有 `datetime`、`close`、`volume`、`bid_price`、`bid_volume`、`ask_price`、`ask_volume`、`tick_type`，沒有成交 ID、`simtrade` 或 `intraday_odd`。

因此程式不虛構歷史逐筆旗標。即時資料明確排除 `simtrade` 與 `intraday_odd`；歷史資料只在上述三方守恆成立時，視為該歷史端點的 regular-session 序列。14:00 起的固定價格交易由時間與 `AllDay` 額外列識別，排除在「全部」之外；13:30 後的延後收盤仍保留至 13:59:59。

## 2026-09-16 唯讀實測

商品：台積電 `2330`；交易日：2026-09-16；只執行一次有界讀取，未啟停服務、未下單。

| 證據 | 結果 |
| --- | --- |
| `AllDay` 筆數 | 6,833 |
| `AllDay` 14:00 前筆數 | 6,832 |
| `RangeTime(09:00–13:59:59)` 筆數 | 6,832 |
| 兩者 14:00 前逐列雜湊 | 都是 `064cb7ec940affff2b99294d5198bed59fd42e50ad48aeda194f6b4f2122d0ec` |
| 第一筆 | `2026-09-16T09:00:09.721819` |
| regular-session 最後一筆 | `2026-09-16T13:30:00` |
| RangeTime 成交量加總 | 17,954 張 |
| 14:00 後額外成交量 | 1 張 |
| Snapshot `total_volume` | 17,955 張 |
| API 用量讀取前後 | 都是 7,604,364 / 524,288,000 bytes |

此樣本同時證明：RangeTime 沒有在 6,832 筆截斷、開盤至一般收盤的順序與出現次數一致、14:00 後成交可分離，而且全日成交量與 Snapshot 守恆。它不代表所有商品永遠完整；每次載入仍需執行同一套 fail-closed 核對。

另外從本機合約清單抽查 500 個台股商品的 Snapshot，找到 `14381`（OTC）`total_volume = 0`；其 2026-09-16 `AllDay` 與 `RangeTime` 都是 0 筆。實際開啟 `/?popout=tape&code=14381` 顯示「全部 0／大單 0／當日已確認無成交」，資訊對話框顯示「已由 AllDay、RangeTime 與 Snapshot 確認當日無成交」。這是確認無成交的真實正面證據，不是以 API 空陣列自行推定。

## 資源上限

- 每次正面核實使用 2 次實體歷史請求（`AllDay`、`RangeTime`）與 1 次小型 Snapshot。此文件建立時採用的每日 8 次產品硬上限已於 2026-09-17 撤除，因官方限制沒有該每日次數規則；現行實作改以 1.5 秒間隔、single-flight、跨視窗鎖、完整 fetch＋body timeout、持久失敗冷卻及每日流量證據約束，並保留實際 usage 計數。
- 歷史請求至少間隔 1.5 秒，單次回應上限 48 MiB，fetch 與 body 合計 15 秒；商品鎖最多 45 秒。
- 回應超過 500,000 筆、欄位長度不一致、日期不符、容量不足、總量不守恆或交接累計量跳號，都保留既有資料並顯示部分／失敗，不會冒稱完整。
