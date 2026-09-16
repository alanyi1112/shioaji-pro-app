# Gate 0：200 檔 Kbars bootstrap 容量與完整度量測

## 文件資訊

- Change：`add-configurable-intraday-relative-volume-monitor`
- 對應任務：1.4
- 量測時間：2026-09-04 13:32–13:38（Asia/Taipei）
- 模式：Shioaji HTTP API 1.7.1，`simulation=true`
- 日期範圍：上一交易日 2026-09-03、當日 2026-09-04
- 樣本：100 檔 TSE + 100 檔 OTC 的合法四碼 STK，共 200 檔
- 探針：`probe-bootstrap-capacity.mjs`
- 安全邊界：唯讀 Kbars；沒有 subscription、Snapshot／ticks 輪詢、production、第二個 login 或 broker write

## 結論

**200 檔可以用每檔一個 Kbars request，在 75 秒 deadline 內完成一次性 bootstrap；但當次 response 沒有 cache receipt 或 source coverage watermark，且上一日只有 97／200 檔具完整首尾錨點，因此不能把 200 個 HTTP success 視為 200 個完整 baseline。`baselineBootstrapQualified` 維持 false。**

這項量測只核准一次性、有界 bootstrap 的成本模型，不核准以 Kbars 週期輪詢取代盤中 subscription。正式 runtime 必須將成功取得且通過逐商品完整度檢查的資料寫入本機 repository；同一來源版本與日期應重用本機 evidence，不得在每次開頁重新抓取 200 檔。

## Request bucket 與批次能力

官方 market-data API 限制為 50 requests／10 秒。Kbars endpoint 一次只接受一個 contract，但同一 request 可涵蓋兩個日期。本次採：

```text
request count              200
contract per request       1
date range per request     2026-09-03..2026-09-04
request start spacing      260 ms
theoretical rate           38.46 requests / 10 seconds
per-request timeout        8,000 ms
total deadline             75,000 ms
periodic polling           false
```

第一次以「response 完成後再等待 260ms」執行，75 秒仍未完成，證明該序列策略不符合 deadline。第二次改為精確 start-to-start 260ms，仍保留相同 38.46／10 秒上限，成功完成。

## 200 檔成本

| 指標 | 結果 |
| --- | ---: |
| requests | 200 |
| HTTP 200 | 200 |
| failed | 0 |
| 總耗時 | 53,096.8 ms |
| request latency p50 | 41.8 ms |
| request latency p95 | 105.0 ms |
| request latency max | 195.7 ms |
| response bytes total | 3,382,972 |
| response bytes p50 | 14,671 |
| response bytes p95 | 29,602 |
| response bytes max | 32,614 |

因此 200 檔冷啟動不是同步頁面 render 的快速工作；它應由有界 background bootstrap 執行，UI 顯示逐商品 `waiting_baseline`，而不是在 53 秒完成前宣稱監控中。

## 結構完整度與 session 錨點

每個 response 都檢查 `datetime/Open/High/Low/Close/Volume/Amount` 欄位存在且等長、regular-session minute key 唯一且嚴格遞增、`Volume` 為非負安全整數。

| 檢查 | 2026-09-03 | 2026-09-04 |
| --- | ---: | ---: |
| 結構合法 | 200／200 | 200／200 |
| 首筆 09:01 且末筆 13:30 | 97／200 | 196／200 |
| minute rows min | 0 | 0 |
| minute rows p50 | 21 | 270 |
| minute rows max | 266 | 270 |

上一日樣本包含 row count 為 0、首筆晚於 09:01 或末筆早於 13:30 的商品。這些可能代表無成交 carry-forward、停牌、商品狀態差異或來源缺漏；Kbars response 沒有 coverage watermark，不能只靠 HTTP 200 分辨。因此：

- `structurallyValid=true` 不等於 `completeness=complete`；
- 缺分鐘不得直接補 0；
- carry-forward 只有在交易日、商品狀態與來源涵蓋範圍另有證據時才合法；
- row count 0 或無法證實 session 範圍的商品必須維持 `waiting_baseline`／`baseline_incomplete`；
- 不得只用 2026-09-04 的高錨點比例推論其他交易日也完整。

## Cache 觀察

200 筆 response 均沒有 `Cache-Control` 或 `Age`。量測後對前 5 檔做一次 warm repeat，HTTP 皆為 200，延遲為 38.4–71.9ms，但 repeat latency 不能證明命中 provider 或 server cache。

因此當期可確認的是：

```text
upstreamCacheReceipt=unavailable
httpCacheHeadersPresent=false
localRepositoryReuseRequired=true
```

正式實作必須用本機 baseline evidence 的 `symbol + trade date + source version + payload hash` 作 cache identity；沒有完整 evidence 時只重試受影響商品，且使用有界 backoff，不得每分鐘重抓全部 200 檔。

## Gate 判定

```text
bootstrapBatchMeasured=true
bootstrap200Within75Seconds=true
marketDataBucketRespected=true
perRequestDeadlineMeasured=true
responseStructureValid=200/200
previousSessionAnchored=97/200
todaySessionAnchored=196/200
upstreamCacheReceipt=unknown
semanticCompletenessProvable=false
baselineBootstrapQualified=false
```

任務 1.4 的量測已完成，但結果是 data-quality NO-GO，不會把 Gate 0 升為 GO。後續 4.5／4.6 必須以逐商品完整度、交易日曆、商品狀態與本機 evidence reuse 實作 fail-closed bootstrap。
