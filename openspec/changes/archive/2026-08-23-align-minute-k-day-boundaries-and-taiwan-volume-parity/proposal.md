## Why

主交易畫面的分鐘 K 雖已有跨日分隔線，但目前沿用低對比 grid color；MultiView 的分鐘 K 則尚未實際繪製分日線，使用者難以辨識上一個台北日期的最後一根 K 與新日期的第一根 K。另一方面，主交易畫面的台股成交量使用 Shioaji 整股「張」，MultiView 日 K 卻在 Yahoo／TWSE「股」與盤中 Shioaji「張」之間混用單位，造成同商品、同日期的成交量不一致。

## What Changes

- 將主交易畫面與本機 MultiView 的 `1m`、`5m`、`15m`、`1h` 分鐘 K 跨日分隔線統一為亮黃色、1.2 CSS px，並在主圖、成交量與所有副圖 pane 使用相同 X 座標。
- 以 `Asia/Taipei` 相鄰 canonical candles 的日期變化判定分日線；同日缺口不畫線，日／週／月 K 與既有 `intraday` 分時走勢不套用此能力。
- 將本機台股圖表成交量的共同呈現單位固定為整股「張」；主交易畫面與 MultiView 在相同 Shioaji Kbars 權威資料範圍內必須產生相同日成交量。
- 讓本機 MultiView 台股日 K 優先使用與主交易畫面相同的 simulation-only Shioaji Kbars 聚合結果；Yahoo／TWSE 僅能作為完整、明確標示的 fallback，不得與 Shioaji OHLCV 靜默混接。
- 將 Yahoo／TWSE 的台股「股」正規化為「張」時保留合法小數張，不得四捨五入、無條件捨去或以乘除布林旗標冒充來源一致；Shioaji 整股 Kbars／Tick 不得再乘除 1,000。
- 調整 MultiView 主圖 K 線 readout 為「日期、開、高、低、收、成交量、漲跌」，成交量使用同一根 canonical candle 的「張」值，並移除該列漲跌幅。
- 為主畫面與 MultiView 的 live tail 加入 total-volume delta、倒序、重送、跨 session 與 generation 防護，確保成交量只計入一次。
- 補齊跨日 primitive、歷史 prepend、平移縮放、主副圖對齊、來源切換、單位正規化、盤中 provisional、收盤 handoff 與同商品跨畫面 parity 的自動化及可見驗收。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `kbar-price-volume-readout`: 將主交易畫面的日內跨日分隔線改為明確亮黃色，並固定台股成交量的「張」單位與 live volume 去重語意。
- `multiview-minute-kline`: 明確要求 MultiView 分鐘 K 實際繪製跨日分隔 primitive，並涵蓋多 pane、viewport、歷史補載與生命週期。
- `multiview-taiwan-realtime-market-data`: 統一本機台股日 K 的 Shioaji 權威資料、成交量單位、fallback 原子性與跨畫面 parity。

## Impact

- 主交易畫面：`src/components/candle-chart.tsx`、`src/lib/day-boundary-primitive.ts`、Kbars／live volume 正規化與相關測試。
- MultiView：`apps/multiview/public/static/app.js`、`realtime-charts.js`、`realtime-coordinator.js`、Worker candle payload／來源 metadata、圖表 primitive 與相關測試。
- OpenSpec：上述三個既有 capability 的 delta spec、focused／integration／browser-visible 驗收矩陣。
- 安全與執行邊界維持不變：只使用既有本機 Shioaji simulation 行情能力，不新增 broker write、production、CA、真實下單、遠端 realtime、部署或服務啟停權限。
