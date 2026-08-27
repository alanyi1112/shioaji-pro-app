# 快速單九欄位三層 mapping

## 版本與安全邊界

| 欄位 | 值 |
|---|---|
| schema | `smart-order-quick-field-mapping/2026-08-21.1` |
| mapping revision | `smart-order-shioaji-stock-event-and-quote-mapping/2026-08-21.1` |
| 查核日期 | 2026-08-21（Asia/Taipei） |
| machine-readable source | `scripts/smart-order-runtime/quick-field-mapping.mjs` |
| delivery | 只接受既有 simulation login 的 `Tick`／`BidAsk` subscription；不得以 snapshot／ticks／Kbars polling 代替 |
| authority | mapping 本身不授予 activation、readiness、write master 或 broker write authority |

本表完成 task 0.5 的「官方 UI 語意 → 本地 schema／單位 → Shioaji subscription 欄位／品質」mapping。它不完成 task 9.1 的策略 condition evaluator，也不改變任何 feature gate 或 write master；Runtime 仍須同時取得 current subscription lineage、freshness、calendar、account、risk、Gate manifest及其他 readiness conjunct。

## 九欄位 exact mapping

| local field | 官方 UI 名稱／語意 | comparator／本地單位 | Shioaji event／欄位／來源單位 | transform | 必要品質 |
|---|---|---|---|---|---|
| `last_price` | 成交價／最新一筆整股成交價 | `gte`／`lte`；`price_decimal` | `Tick.close`；price decimal | canonical positive decimal | subscription、normal-lot、non-simtrade、fresh、current lineage |
| `bid_price` | 買價／最佳一檔買價 | `gte`／`lte`；`price_decimal` | `BidAsk.bid_price[0]`；price decimal | canonical positive decimal | 同上，另須 book not crossed；空買方逐欄 disabled |
| `ask_price` | 賣價／最佳一檔賣價 | `gte`／`lte`；`price_decimal` | `BidAsk.ask_price[0]`；price decimal | canonical positive decimal | 同上，另須 book not crossed；空賣方逐欄 disabled |
| `up_amount` | 上漲／正價差 | `gte`／`lte`；`price_decimal` | `Tick.price_chg`；signed price decimal | direction=`up`時取正 magnitude；`down|flat`取canonical `0` | 只有來源缺失或格式不符才逐欄 disabled |
| `down_amount` | 下跌／負價差的正 magnitude | `gte`／`lte`；`price_decimal` | `Tick.price_chg`；signed price decimal | direction=`down`時取 absolute magnitude；`up|flat`取canonical `0` | 只有來源缺失或格式不符才逐欄 disabled |
| `up_percent` | 漲幅／正百分比 | `gte`／`lte`；`percent_decimal` | `Tick.pct_chg`；signed integer basis points | direction=`up`時exact除以100，例如`33 → 0.33`；`down|flat`取canonical `0` | 必須與有效的`price_chg`同方向；衝突時整筆拒絕，來源缺失或格式不符才逐欄 disabled |
| `down_percent` | 跌幅／負百分比的正 magnitude | `gte`／`lte`；`percent_decimal` | `Tick.pct_chg`；signed integer basis points | direction=`down`時absolute後exact除以100；`up|flat`取canonical `0` | 必須與有效的`price_chg`同方向；衝突時整筆拒絕，來源缺失或格式不符才逐欄 disabled |
| `tick_quantity` | 單量／當筆整股成交量 | `gte`／`lte`；`CommonLot` | `Tick.volume`；normal-lot CommonLot | positive safe integer | `volume > 0`，且`total_volume >= volume` |
| `total_quantity` | 總量／本交易日累計整股成交量 | `gte`／`lte`；`CommonLot` | `Tick.total_volume`；normal-lot CommonLot | positive safe integer | 同一trade date、nondecreasing語意；跨日另建head |

## 時間、sequence、ownership 與 reconnect

- `Tick.date/time`或`BidAsk.date/time`必須完整解析成`Asia/Taipei` exchange time與canonical trade date；本機 receive time不得早於exchange time。
- 每個production SSE connection建立新的opaque connection lineage；每筆quote由該connection的單調本機sequence排序。duplicate identity、sequence倒退／碰撞、舊connection event與reconnect前stream authority一律fail closed。
- `simtrade=true`或`intraday_odd=true`在任何欄位 projection 前整筆拒絕。Task 5.7a 的保護觸發只接受`last_price`，`BidAsk`即使跨線也不得觸發。
- Runtime與browser demand使用不同opaque handle並在`contract + quoteType`上refcount／dedupe；browser不能釋放Runtime demand。Production只建立一個由managed sidecar持有的quote coordinator與同一既有login SSE；same-code跨exchange若無法唯一解析，事件整筆拒絕。
- disconnect使confirmation與head立即不current；reconnect必須先換lineage、重新subscribe、取得新confirmed stream與新fresh head。舊head只可顯示last eligible time，不得恢復condition eligibility。
- 任一官方欄位缺失或格式不符時只disabled受影響欄位；contract、時間、量、方向、crossed book、lineage或event schema矛盾則整筆fail closed。

## 查核來源

- 永豐金快速單公開 UI 說明：九種候選名稱與比較方向。
- Shioaji 官方股票 streaming 文件：`Tick.close`、`price_chg`、`pct_chg`、`volume`、`total_volume`、`simtrade`、`intraday_odd`及`BidAsk.bid_price`／`ask_price`。
- Shioaji 官方 subscribe 文件：`Tick`／`BidAsk` subscribe、unsubscribe與`intraday_odd`選項。

本文件與machine-readable definition的SHA-256會記入`evidence.md`。任何mapping revision、Shioaji schema或source digest漂移，都必須讓既有Gate manifest失效並回到observe-only；不得以環境變數、browser值或同名欄位繞過。
