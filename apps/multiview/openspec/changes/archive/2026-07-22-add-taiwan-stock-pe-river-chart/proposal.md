## Why

目前主圖只有由 K 線直接計算的技術指標，使用者無法在相同價格座標上判讀台股個股相對於自身歷史本益比區間的位置。新增以交易所歷史本益比與參考 EPS 為基礎的河流圖，可在不混入同業比較或預估獲利的前提下，提供來源透明、可追溯且與官方本益比口徑一致的估值視圖。

## What Changes

- 在每個 chart panel 的「主圖」選單新增預設未勾選的「本益比河流圖」選項。
- 僅對台灣上市、上櫃普通股的日 K 提供此功能；ETF、ETN、TDR、指數、加密貨幣與其他不適用商品不得產生誤導圖形。
- 從 TWSE／TPEx 官方歷史資料取得同日收盤價、本益比與財報年／季，反推交易所當時採用的參考 EPS，並以 D1 保存逐日資料、來源、coverage 與回補狀態。
- 以最近五年有效每日本益比計算 `P10`／`P30`／`P50`／`P70`／`P90`，在主 K 線後方繪製五條價格界線與四個半透明河流帶。
- 新增按需的本益比河流圖 API、限速且可續跑的歷史回補、明確的載入／部分 coverage／失敗／不適用狀態，以及盤中估算與官方已發布資料的區分。
- 在主圖 crosshair readout、縮放／平移／resize、各圖數版型、雙擊單圖與完整 panel PNG 匯出中維持河流圖的正確對齊及生命週期。
- 明確排除同業平均本益比、產業本益比、同業中位數、預估 EPS 與同業估值參考線。

## Capabilities

### New Capabilities

- `taiwan-stock-pe-river-chart`: 規範台股本益比河流圖的商品適用性、官方資料口徑、五年百分位計算、D1 coverage／回補、API 狀態、主圖繪製、readout、互動同步與驗收行為。

### Modified Capabilities

無。

## Impact

- 前端：`public/static/index.html`、`public/static/app.js`、`public/static/styles.css`、panel 圖片匯出與既有主圖互動生命週期。
- Worker／API：新增台股估值資料解析、河流圖查詢、coverage、回補與安全錯誤碼；不得把大量歷史資料併入一般 `/api/candles` 回應。
- 持久化：`db/schema.ts`、Drizzle migration，以及估值逐日資料、fetch state／job／checkpoint 所需 D1 table。
- 自動化：可能新增私有 GitHub Actions 回補 runner 或沿用既有私有 workflow dispatch／ingest 模式；正式串接前必須確認官方來源授權、自動化限制、頻率、歷史範圍與實際 schema。
- 驗證：新增純函式、API、D1、retry／coverage、前端 contract、browser 可見互動與 PNG 匯出測試；不新增前端秘密或第三方付費依賴。
