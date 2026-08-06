## Context

目前 `worker/indicators.ts` 固定產生單一 RSI14，採 14 根漲跌幅的 rolling SMA；KD 則直接以 RSV9 作 K，D 使用包含前置零值的 SMA3。使用者提供的參考軟體採 RSI5／10 雙線與 KD 9／3／3 遞迴平滑，日線可見值為 K 29.08、D 38.85、RSI5 26.05、RSI10 36.71，週線可見值為 K 42.36、D 56.95。前端目前已畫 RSI 30／70、KD 20／80，但 RSI 缺少 50。

副圖設定必須全域套用 1／2／3／4／6／8 圖。現有前端 payload cache 只包含 symbol 與 interval，Worker D1 payload cache 也不包含參數；SSE URL 同樣沒有參數，且前端收到新 candle 時沒有更新技術指標 series。因此設定、快取與即時更新必須一起調整，避免同一畫面混用不同算法或舊值。

## Goals / Non-Goals

**Goals:**

- 以可測試的參數模型產生參考軟體風格的 RSI5／10 與 KD 9／3／3。
- 讓 MACD 12／26／9、ATR14 與 RSI、KD 參數可由小齒輪視窗設定，並全域保存、套用及還原。
- 讓 candles、歷史補載、prefetch、SSE、前端 cache 與 readout 使用同一份設定簽章。
- RSI 顯示 30／50／70，KD 顯示 20／80，且橫線不遮擋主要資料。
- 維持緊湊副圖功能表和 viewport-safe 操作。

**Non-Goals:**

- 本次不加入 DMI、BIAS、KDJ 的 J 線或主圖 MA／布林參數設定。
- 不把參數保存到 D1，也不在不同瀏覽器或裝置間同步。
- 不保證不同資料商或除權息處理不同時仍能逐分相同；週／月 K 邊界由日 K 聚合統一，公式數值驗收以相同 candle fixture 為準。

## Decisions

### 使用單一版本化全域參數物件

前端以 `localStorage` 保存版本化物件，預設為 RSI 5／10、KD 9／3／3、MACD 12／26／9、ATR 14。每個 panel 共用同一物件；設定成功後遞增前端 load generation、清空 panel payload cache 並重新載入所有 panel。相較每個 panel 各自保存，這符合使用者確認的全域行為，也避免 8 圖時難以辨識各圖公式。

### Worker 正規化 allowlist 參數並納入 cache key

`/api/candles` 與 `/api/stream` 使用相同解析函式，只接受整數與有界範圍；缺值或不合法值回復安全預設。正規化後建立穩定簽章，傳入 `computeIndicators` 並納入 D1 payload cache key。相較只在前端重算，此方案讓初次 payload、歷史暖機、SSE 與測試共享單一 TypeScript 公式來源。

### RSI 採 Wilder 遞迴平均並回傳雙序列

RSI 先以各週期最初 N 根漲跌幅的 SMA 作初始平均，其後使用 `(前平均 × (N - 1) + 本期值) / N`。payload 回傳 `rsi.short` 與 `rsi.long`，並附正規化參數；前端各畫一條線、兩個讀值。這與台股軟體常見 RSI 慣例相符，也能清楚表達 5／10 雙週期。

### KD 採 K、D 初始值 50 的兩段遞迴平滑

RSV 使用最近 N 根最高、最低及本期收盤；有足夠 N 根後，以 `K=(前K×(rsvWeight-1)+RSV)/rsvWeight`、`D=(前D×(kWeight-1)+K)/kWeight`，兩者初始值為 50。參考軟體畫面只提供 9／3／3，沒有可調初始值，因此初始值固定為 50，不在 UI 暴露。

### 週線與月線由交易所時區的日 K 聚合

Yahoo 原生 `1wk` 會使用不同的週界，原生 `1mo` 也會把未完成月份的最新交易日誤作獨立月 K，兩者皆無法對上參考軟體。Worker 在週／月線請求時改抓 `1d` 歷史：週線依商品交易所時區將週一至週日歸為同一週，月線依交易所時區的曆月歸組；開盤取第一筆、最高與最低取期間極值、收盤取最後一筆、成交量加總。歷史 candle store 分別使用版本化 provider identity，避免與既有原生週／月 K 混用。

### 基準線附著於各指標第一條 series

沿用 Lightweight Charts `createPriceLine`，RSI 在 short series 建立 30、50、70，KD 在 K series 建立 20、80。使用細虛線、隱藏軸標籤，避免成為新的資訊遮擋。

### SSE 收到 candle 後以完整 indicators 重畫技術副圖

stream payload 已帶完整 indicators；前端更新本機 candle 後，以最新 payload indicators 取代舊值並重畫已選技術 series／readout。重畫成本可接受，且比逐條推導增量狀態更不易與 Worker 公式漂移。

## Risks / Trade-offs

- [參考軟體使用不同資料源或除權息處理] → 使用相同 candle fixture 做公式測試；週線與月線統一由日 K 依交易所時區聚合，其他正式資料差異另以 provider 與除權息診斷，不扭曲公式配合單一截圖。
- [參數組合增加 D1 cache 筆數] → 參數採嚴格界限與穩定簽章，不接受任意文字；既有 TTL 維持有界生命週期。
- [全圖重載造成短暫網路負載] → 清除前端快取後由既有 prefetch 併發限制與 Worker history cache 吸收，設定視窗只在按下「套用」時觸發一次。
- [payload shape 改為 RSI 雙序列] → 同一變更同步更新前端、SSE 與契約測試，並提高 candle cache contract version，避免讀到舊 shape。

## Migration Plan

1. 先發布 Worker 公式、參數解析、cache version 與新 payload shape，再由同一 Sites version 發布前端。
2. 瀏覽器沒有新版設定時使用參考預設；舊版不存在相同 storage key，不需資料 migration。
3. 若需 rollback，回復前端與 Worker 同一 commit；D1 中含新版 cache key 的資料會自然過期，不影響歷史 candle store。

## Open Questions

- 無阻擋問題。參考截圖沒有揭露 RSI 初始化細節，採台股軟體常見 Wilder 初始 SMA；若相同 candle fixture 仍無法對上，必須先確認資料源與未完成 K 線後再調整公式。
