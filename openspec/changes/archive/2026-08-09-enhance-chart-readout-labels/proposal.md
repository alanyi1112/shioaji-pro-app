## Why

目前 K 棒游標資訊雖已顯示開高低收量與技術指標數值，但 BOLL、均量與均線組的數值缺少逐項標籤，使用者無法快速辨識每個數值的意義；價格欄位也需要一致地以對應交易日的昨收判斷漲跌顏色。此次調整讓紅框內的資訊能直接閱讀，降低看盤時對照圖例或記憶指標順序的成本。

## What Changes

- K 棒第一列的開、高、低、收／最新價格數值依對應交易日的昨收判色：高於昨收顯示紅色、低於昨收顯示綠色、相等或無法取得可靠昨收時維持中性；成交量維持中性，不以價格昨收判色。
- BOLL readout 以「上、中軌、下」的順序顯示數值，並在各數值前顯示對應標籤。
- 將 readout 中的 `VolMA` 顯示名稱改為「均量」，並在各數值前顯示 `5MA`、`10MA`、`20MA` 等週期標籤。
- 將 readout 中的 `MA組` 顯示名稱改為「均線」，並在各數值前顯示 `5MA`、`10MA`、`20MA`、`60MA`、`120MA` 等週期標籤。
- 由目前圖表已載入的 canonical 原始 1 分 K 依台灣交易日期建立「交易日 → 前一個已完成交易日收盤價」索引，供 STK、IND、WRT 的歷史 K 棒（包含週末或休市日畫面上的最新 completed session）判色。
- 當日 STK、IND、WRT 仍使用目前有效的 contract／index reference；歷史第一個已載入交易日或缺少完整前一交易日資料時維持中性，不得拿目前 reference、同日上一根 K 棒或推測值代替。
- FUT／OPT 因夜盤跨日與交易日歸屬不能只靠日曆日期判斷，維持既有保守規則，不套用上述歷史昨收索引。
- 保留既有 indicator picker 名稱、series 計算、繪圖顏色與使用者顯示偏好，除非它們是紅框 readout 的必要顯示文字。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `kbar-price-volume-readout`: 增加 BOLL、均量與均線數值的明確順序、逐項標籤、標籤顏色與窄版完整顯示規則。
- `reference-price-coloring`: 補充由已載入 canonical 原始 K 棒建立歷史昨收索引、重新載入／prepend 後更新，以及禁止沿用目前交易日 reference 的判色規則。

## Impact

- 主要影響 `src/lib/kbar-readout.ts`、`src/components/candle-chart.tsx`、`src/components/candle-chart.css.ts`、`src/lib/indicator-defs.ts` 與其測試。
- Kbars payload 只有 OHLCV，歷史昨收必須由既有 `rawRef` 的完整交易日資料建立；不得新增 API endpoint、外部資料來源或無界回補請求。
- 不改變 indicator 計算公式、K 線繪圖、主圖／副圖配置、訂單流程或 simulation／production 安全邊界。
