# 官方 OHLCV 來源與責任鏈盤點

## 既有 v3 責任鏈

- `apps/multiview/worker/stock-screener-sources.ts`：驗證 TWSE／TPEx 全市場日報 schema、日期與 canonical row。
- `src/lib/stock-screener-ohlcv.ts`、`apps/multiview/worker/stock-screener-ohlcv-repository.ts`：價格十進位字串、OHLC 邊界與較新完整資料覆蓋政策。
- `apps/multiview/drizzle/0029_plain_strong_guy.sql`：`screener_daily_ohlcv` 及 market／symbol 日期索引。
- `scripts/stock-screener-ohlcv-bootstrap.mjs`：60 個共同交易日、`market + session` targets、bounded fetch、checkpoint、receipt 與 retention。
- `apps/multiview/worker/stock-screener-v3-publisher.ts`／`stock-screener-v3-repository.ts`：全母體 technical evidence、日期 gate、immutable v3 snapshot 與 CAS publication。
- `apps/multiview/worker/stock-screener-v3-route.ts`：固定 query schema、三態、排序／cursor 及 DB-only GET。
- `src/lib/stock-screener-domain.ts`、`stock-screener-technical-patterns.ts`、`stock-screener-api.ts`：共用 criteria、公式、decoder 與 evidence。
- `src/components/stock-screener-panel.tsx`：draft／applied 隔離、偏好、狀態、結果、指定 K 線與明確加入「選股」清單。
- `scripts/verify-stock-screener-v3.mjs` 與 focused／browser tests：全市場與 UI 驗收入口。

不可退化邊界：v1／v2／v3 snapshot 版本隔離、全市場守恆、P／D／technical 日期一致、GET 不抓 provider／不寫 DB、點選不自動加入清單、不啟停 runtime、不產生交易或行情訂閱。

## 2026-09-02 實際官方回應核對

以官方 2026-07-24（民國 115 年）交易日做唯讀 schema probe：

| 市場 | 官方 URL | 狀態／日期 | 商品表 | OHLC 欄位 | 成交量欄位與單位 |
| --- | --- | --- | --- | --- | --- |
| TWSE | `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=20260724&type=ALLBUT0999&response=json` | HTTP 200、`stat=OK`、`date=20260724` | 「每日收盤行情」1372 rows；實作仍以官方名冊限縮普通股 | `開盤價`、`最高價`、`最低價`、`收盤價` | `成交股數`，單位為股 |
| TPEx | `https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=2026%2F07%2F24&id=&response=json` | HTTP 200、`stat=ok`、`date=20260724` | 「上櫃股票行情」及「管理股票」兩 tables；實作仍以官方名冊限縮普通股 | `開盤`、`最高`、`最低`、`收盤` | `成交股數`，官方格式說明單位為股 |

兩市場表內同時包含成交金額，但 v4 的 `volume_shares` 只接受 `成交股數`；不得用成交金額、最後買賣量、張數或 Shioaji Snapshot 推算。價格為官方未還原盤後新臺幣欄位。requested date 必須與 response `date` 完全一致；TWSE 必須恰有一個含 `證券代號` 的目標 table，TPEx 必須恰有「上櫃股票行情」與「管理股票」兩個同 schema tables，其他 schema／日期一律 fail closed。

來源為 TWSE／TPEx 公開盤後報表。未發現可依賴的保證 request quota，因此 operator 必須維持 bounded request、完整 body timeout、Retry-After、冷卻與 checkpoint；不重發布原始全量 payload，只保存必要 canonical rows、欄位 mapping、URL、hash 與 fetchedAt。使用者查詢／UI 不得直接呼叫這些 URL。

## v4 公式契約摘要

| 分支 | 固定契約 |
| --- | --- |
| 糾結 | SMA5／10／20；每日 spread = `(max-min)/SMA20*100`；連續 2–10 日，門檻 0.1–5.0% |
| 準備突破／跌破 | 糾結終於 D、SMA5 尚未穿越 SMA20、gap 由 P 至 D 收斂，close 嚴格位於三線之上／下 |
| 黃金／死亡交叉 | 糾結終於 P，SMA5 由 `<=` 轉 `>` SMA20，或由 `>=` 轉 `<` |
| Price pivot | 中心 high／low 嚴格勝過左右各 2 根；第二中心距 D 為 2–3 日、兩中心距 5–30 日、價差至少 1% |
| 一般型背離 | 同一 price pivot 日取 OBV、RSI5、RSI10、KD-K、MACD line／hist；價格創低而指標抬高，或價格創高而指標降低 |
| MACD histogram | 多頭兩點在零下、空頭兩點在零上；可另要求中間到達／穿越零軸；不含 hidden divergence |

手算邊界由 unit fixtures 固定：spread 恰等門檻可通過；D 的 SMA5 恰等 SMA20 不算完成交叉；pivot 相等不成立；第二 pivot 未有兩根右棒為 unknown；間距 5／30、新鮮度 3 與價差恰 1% 皆採含邊界；任一必要指標尚未有值為 `indicator_warmup`。
