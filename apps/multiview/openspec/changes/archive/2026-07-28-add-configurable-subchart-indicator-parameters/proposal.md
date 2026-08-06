## Why

目前副圖的 RSI 與 KD 計算方式、週期和使用者提供的參考軟體不同，造成日線、週線與月線讀值無法直接核對；副圖功能表也沒有參數入口，使用者無法自行調整。需要提供全域技術指標設定，並以參考軟體的 RSI、KD 慣例作為新預設，讓多圖中的讀值與判讀基準一致。

## What Changes

- 在副圖功能表「技術指標」旁加入小型齒輪按鈕，開啟 viewport-safe 的全域參數設定視窗。
- 提供 RSI 雙週期、KD 期間與兩段平滑權值、MACD 快慢線與訊號線週期、ATR 期間的設定、驗證、套用與還原預設。
- 將 RSI 預設改為參考軟體的 5／10 雙線 Wilder 平滑，並在副圖顯示 30／50／70 橫線。
- 將 KD 預設改為參考軟體的 9／3／3 遞迴平滑，K、D 初始值為 50，並在副圖顯示 20／80 橫線。
- 週線與月線改由交易所時區的日 K 聚合，避免資料商原生週／月 K 邊界與未完成期間處理不同於參考軟體。
- 參數套用到所有圖表，保存於目前瀏覽器；變更後清除受影響的前端 payload cache、重新載入各 panel，並讓 candles、歷史補載與 SSE 使用相同參數。
- 增加固定數值測試、API 參數與 cache 契約測試、設定 UI 與參考橫線測試。

## Capabilities

### New Capabilities
- `configurable-subchart-indicators`: 規範全域副圖技術指標參數、參考 RSI／KD 計算、設定介面、持久化、資料更新與基準橫線。

### Modified Capabilities
- `codex-sites-rewrite`: 調整 Workers 指標 payload 與多圖副圖的 RSI／KD 預設、讀值及全域重載行為。

## Impact

- 前端：`public/static/index.html`、`public/static/styles.css`、`public/static/app.js`。
- Worker：`worker/indicators.ts`、`worker/market-data.ts`、`worker/candle-history.ts`、`worker/app.ts` 的指標參數、週／月線聚合、payload 與 cache key。
- API：`/api/candles` 與 `/api/stream` 增加經 allowlist、範圍驗證的技術指標 query 參數；不增加秘密或外部服務依賴。
- 測試：`tests/indicators.test.mjs`、副圖互動與 Worker API 契約測試。
