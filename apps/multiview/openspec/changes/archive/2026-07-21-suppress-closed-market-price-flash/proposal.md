## Why

台股收盤後，stream 仍會定期送出相同的最後一根 K 棒，而前端目前每次收到資料都觸發漲跌底色動畫，造成使用者誤以為收盤價仍在變動。「已核對」仍是必要的資料品質資訊，但不應與不實的即時價格更新提示混在一起。

## What Changes

- 只有最新價格相較於畫面上一次已呈現的價格實際變動時，才顯示價格更新動畫。
- 台股已收盤或報價為 `session-close` 時，不顯示整個商品報價欄的紅／綠底更新動畫。
- 收盤後繼續保留「已核對」、「待核對」、「未驗證」等收盤資料品質狀態。
- 補上自動化測試，涵蓋盤中價格變動、重複相同資料與收盤資料三種情境。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `intraday-quote-state`: 明確規範價格更新動畫只能反映盤中實際價格變動，且不得在台股收盤後反覆閃爍。

## Impact

- 前端報價列更新與 stream 事件處理：`public/static/app.js`
- 價格更新動畫樣式與既有狀態：`public/static/styles.css`
- 前端行為與渲染測試：`tests/`
- 不變更 API schema、資料來源或持久化結構。
