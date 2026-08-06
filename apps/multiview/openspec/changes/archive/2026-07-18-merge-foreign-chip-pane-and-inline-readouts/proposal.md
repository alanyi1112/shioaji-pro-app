## Why

籌碼副圖目前同時使用右側 series 標籤與浮動 tooltip，會遮住柱狀圖、折線與相鄰 pane；外資買賣超及外資持股又分成兩張副圖，增加長頁面高度。需要把逐日資訊整合到標題列，以更緊湊、可比較且不遮圖的方式呈現。

## What Changes

- 將「外資買賣超」與「外資持股」合併為單一「外資買賣超＋持股」副圖，以買賣超柱與持股比折線共用日期、使用獨立數值尺度。
- 移除籌碼副圖的浮動 tooltip；共用十字線移動時，將該日期的讀值與必要明細更新到副圖標題同一列。
- 沒有游標時，標題列顯示最新可用資料；游標離開後回復最新資料。
- 以分段 readout、間距與可換行版型區隔標題、日期、主要值、次要明細、狀態與控制項，避免文字互相擠壓。
- 移除會遮住資料圖形的 series title／last-value 標籤，包括 TDCC 的「持股比例」與「週增減」。
- 所有有方向性的讀值採台股慣例：增加或正值顯示 `+` 且為紅色，減少或負值顯示 `-` 且為綠色，零值使用中性色。
- 融資、融券讀值不再顯示模糊的「增減」文字，改為明確的正負號與紅綠色；餘額、買進、賣出、償還及資券互抵仍保留清楚標示。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `taiwan-stock-chip-subcharts`：合併外資副圖，將逐日讀值由浮動 tooltip 改為標題列 inline readout，移除遮圖標籤並新增正負號與紅綠語意。

## Impact

- 籌碼副圖 registry、使用者已保存 pane selection 的相容 migration、dataset request 聚合與 series 建立。
- 副圖 header／readout DOM、十字線同步、TDCC 缺值顯示、CSS 緊湊版面與 responsive 行為。
- 副圖選單與 contract 測試；不修改市場資料 API schema 或 D1 資料表。
