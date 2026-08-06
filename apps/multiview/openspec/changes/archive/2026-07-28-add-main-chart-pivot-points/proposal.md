## Why

現有主圖缺少可依前一個完整交易週期計算支撐與壓力水準的 Pivot Point，使用者必須離開多圖工作區另行查找。新增預設關閉的 Traditional Pivot，可讓日內、日、週、月圖在不增加預設畫面負擔的情況下，直接比較價格與一致的 P／R／S 水準。

## What Changes

- 在每個 chart panel 的「主圖」功能表新增預設未勾選的「Pivot Point」checkbox，維持各 panel 既有主圖指標選取與功能表 viewport-safe 行為。
- 採固定 Traditional Pivot 公式，顯示 P、R1、R2、R3、S1、S2、S3；第一版不新增公式類型或參數設定。
- `1m` 至 `4h` 使用前一個完整交易日，`1d` 使用前一日，`1wk` 使用前一週，`1mo` 使用前一月的最高、最低與收盤價計算；不得使用尚未完成的參考週期或把前一根日內 K 棒冒充前一交易日。
- Pivot 預設關閉時不得增加高週期行情請求；勾選後，candles、即時 stream、cache key 與前端 series 必須使用相同 Pivot 啟用狀態及週期口徑。
- 在主圖以可辨識的 P／R／S 標籤、價格與水平階梯線呈現歷史及目前有效水準，並整合十字線 readout、縮放平移、多圖重建、商品／週期切換與完整 panel PNG 匯出。

## Capabilities

### New Capabilities

- `main-chart-pivot-points`: 定義主圖 Pivot Point 的預設選取、Traditional 公式、週期映射、資料完整性、P／R／S 視覺與 readout、生命週期及匯出行為。

### Modified Capabilities

- `codex-sites-rewrite`: 擴充 Workers 市場資料與指標 contract，使 `/api/candles`、`/api/stream` 與 cache 在使用者啟用 Pivot 時提供一致的高週期參考與 Pivot payload，未啟用時維持 lazy 行為。
- `chart-indicator-menu-viewport-safety`: 將新增的「Pivot Point」納入多圖主圖功能表的緊湊排列、完整可見與鍵盤操作要求。

## Impact

- 影響 `public/static/index.html`、`public/static/app.js`、`public/static/styles.css` 的主圖 checkbox、series、標籤、readout、功能表排列與靜態資產版本。
- 影響 `worker/indicators.ts`、`worker/market-data.ts`、`worker/app.ts` 與 candle history／cache 整合；日內 Pivot 需安全取得相同商品、相同市場時區的日線參考資料。
- 需更新指標計算、Worker API、cache／stream、HTML contract、互動、PNG 匯出與正式站瀏覽器驗收測試。
- 不新增外部資料供應商、D1 schema、使用者秘密、交易訊號、警報或買賣建議。
