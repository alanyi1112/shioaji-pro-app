# Gate 0：盤中成交量來源與單位 mapping

## 文件資訊

- Change：`add-configurable-intraday-relative-volume-monitor`
- 對應任務：1.3
- 查證時間：2026-09-04 12:46–12:50（Asia/Taipei）
- Runtime：Shioaji HTTP API 1.7.1，`simulation=true`
- Fixture：`fixtures/shioaji-volume-mapping-1.json`
- Validator：`node gate-0/verify-volume-mapping-fixture.mjs`
- 結論：**台股整股 Tick `total_volume` 與 1 分 K `Volume` 可映射為 canonical `common_lot`（張）；`daily_quotes.Volume` 是股。歷史來源必須先套用 regular-session 與完整度規則，不能用日總量替代分鐘基準。**

## 實際欄位 mapping

| 用途 | API／event | 原始欄位 | 原始單位 | canonical 欄位／單位 | 必要判斷 |
| --- | --- | --- | --- | --- | --- |
| 即時累積量 | `tick_stk` SSE | `total_volume` | 張 | `cumulativeVolume`／`common_lot` | `security_type=STK`、`intraday_odd=false`、`simtrade=false`、日期與時間合法、值為非負安全整數且不倒退 |
| 即時單筆量 | `tick_stk` SSE | `volume` | 張 | `tickVolume`／`common_lot` | 只用於判斷是否為真實成交；量比主狀態不得自行加總此欄位 |
| 歷史分鐘量 | `POST /api/v1/data/kbars` | `Volume[]` | 張／分鐘 | 逐分鐘 `volume`／`common_lot` | `datetime[]` 與 OHLCV 欄位等長、只納入 regular session、缺分鐘不得自動當 0 |
| 歷史分鐘累積量 | 同上 | regular-session `Volume[]` 累加 | 張 | `cumulativeVolume`／`common_lot` | 同一交易日由早到晚單調累加；跨日重設；完整度另外保存 |
| 成交金額 | Tick `amount`／`total_amount`、Kbar `Amount[]` | decimal string 或 number | TWD | 非量比必要 evidence | 不得拿金額反推缺失成交量 |
| 日量交叉檢查 | `POST /api/v1/data/daily_quotes` | `Volume[]` | 股 | 除以 1,000 後為張 | 僅供 scope／單位檢查；含不同交易 session，不能當同分鐘基準 |

既有正式 volume contract `taiwan-stock-common-lot/1` 已將 `shioaji`、`shioaji-kbars`、`shioaji-realtime` 定義為 `common_lot` provider，與本次 live evidence 一致。

## Live Tick 實證

從既有 `GET /api/v1/stream/data/tick_stk` 取得一筆 3231 regular-lot event：

```json
{
  "code": "3231",
  "date": "2026-09-04",
  "time": "12:46:54.249715",
  "close": "197.5",
  "volume": 3,
  "total_volume": 68971,
  "amount": "592500",
  "total_amount": "13543118000",
  "simtrade": false,
  "intraday_odd": false
}
```

`volume=3` 對應 3 張，成交價 197.5 元時 `3 × 1,000 × 197.5 = 592,500`，與 `amount` 完全一致，提供直接的單位交叉證據。`total_volume=68,971` 因而直接正規化為 68,971 張，不乘除 1,000。

Tick event 自身沒有可跨 reconnect 使用的 provider sequence。盤中監控必須由 transport authority 補上 `connectionGeneration` 與該 generation 內的單調 ingest sequence；不能拿 arrival order 當跨 generation 的全域序號。

## 1 分 K bootstrap 實證

對 3231 查詢 2026-09-03 單日 Kbars：

- 回傳欄位：`datetime`、`Open`、`High`、`Low`、`Close`、`Volume`、`Amount`。
- 266 根，第一根 `09:01`，最後一根 `13:30`。
- regular-session `Volume` 合計 95,737 張。
- 09:01 `Volume=2,614`、`Amount=492,685,500`；以約 188 元乘上 2,614,000 股，量級與金額一致。
- 13:30 `Volume=4,104`、`Amount=773,604,000`。

09:01–13:30 理論上有 270 個 minute keys，但實際只有 266 根。這表示 Kbars 是有成交分鐘集合，不是自帶完整 carry-forward 的 270 列 baseline。缺分鐘只有在來源連續性與 session 範圍另行證實後才能沿用前值；否則必須標示 incomplete。完整度與 200 檔成本仍由任務 1.4 驗證。

## 交易時間與排除條件

`POST /api/v1/data/ticks` 的同日最後三筆包含：

```text
13:24:58.856570 volume=1
13:30:00.000000 volume=4104
14:30:00.000000 volume=154
```

因此歷史 ticks 不能只按交易日期使用；14:30 資料必須由 regular-session filter 排除。即時 Tick 還必須拒絕：

- `simtrade=true`；
- `intraday_odd=true`；
- 不是台股 STK 或不是使用者設定的 canonical contract；
- 日期不等於 session authority 的交易日；
- exchange time 不在 regular session；
- `total_volume` 非有限、負數、非安全整數或小於同 generation 前值；
- 舊 connection generation 或重複／倒退 ingest sequence。

`date` 與 `time` 是交易所 wall-clock 欄位，canonical timezone 固定為 `Asia/Taipei`；`receivedTime` 必須由 runtime 另行記錄，不能覆蓋 exchange time。

## Daily quote 只作單位與 scope 交叉檢查

3231 在 2026-09-03 的 `daily_quotes.Volume=97,294,860` 股，即 97,294.86 張；它不等於 regular-session 1 分 K 合計 95,737 張。此差異與同日 14:30 tick 證明 daily quote 涵蓋範圍不同，所以：

- daily quote 可以驗證 `share ÷ 1,000 = common_lot`；
- daily quote 不可填補缺分鐘；
- daily quote 不可按比例拆成分鐘量；
- daily quote 不可替代上一交易日同分鐘 baseline。

## 可重現驗證

```sh
node openspec/changes/add-configurable-intraday-relative-volume-monitor/gate-0/verify-volume-mapping-fixture.mjs
```

validator 固定檢查 Tick／Kbar 的張單位、daily quote 的股轉張、14:30 排除及「日總量不得等同 regular-session 分鐘累積量」。fixture 不含帳號、token、憑證或其他秘密值。
