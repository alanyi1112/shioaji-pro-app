## Why

主交易畫面的 Traditional Pivot 目前藏在通用「指標」流程，且沒有把三關價與 CDP 納入同一套參考 K 棒、跨時框投影及清除語意。使用者需要在「指標」旁以直覺的「壓撐」入口統一管理三種價位工具，並讓盤中與收盤後的預設參考日符合台股交易狀態。

## What Changes

- 在主交易畫面 K 線工具列新增「壓撐」按鈕與鍵盤可操作的選單，提供 `PivotPoint`、`三關價`、`CDP` 三個 checkbox；預設全部關閉。
- 將既有 Traditional Pivot 從通用「指標」入口遷移至「壓撐」，沿用既有設定並避免同一商品出現兩份 Pivot 線。
- 三種工具共用使用者在 1D 選定的 reference K 棒；1m、5m、15m、60m 只鏡像同商品同一組 reference 與已啟用的水平價位，不能各自重算或清除。
- 台股盤中若今日有未完成日 K，預設使用上一個完整交易日；收盤並確認今日 K 棒完整後使用最後一根日 K。若無法證明今日資料完整，保持 fail closed，使用上一個完整交易日。
- 取消單一 checkbox 時只清除該公式的線、標籤、readout 與 autoscale；三項全數取消時清除整組壓撐投影。固定歷史 reference 只保留於目前 document session，reload 後依自動規則重選。
- 以版本化純函式與 fixture 固定三套公式，並以共用標籤避碰、短 connector、右側價位標示及有限值 autoscale 呈現最多十五條水平線。
- 本 change 只涵蓋主交易畫面與 STK／IND／WRT，不修改 MultiView 的 panel-local 壓撐工具，不支援 FUT／OPT，不啟用 production 或真實下單。
- 實作前必須先歸檔並同步已完成的 `align-chart-tools-and-add-multiview-minute-klines`，以其 1D-authoritative Pivot projection 作為基準，避免兩個 active change 同時改寫 Pivot 契約。

## Capabilities

### New Capabilities

- `main-chart-support-resistance-tools`: 定義主交易畫面「壓撐」入口、PivotPoint／三關價／CDP 公式、共用 reference K 棒、自動交易日選擇、1D-authoritative 跨時框投影、標籤呈現與個別清除契約。

### Modified Capabilities

- `chart-technical-indicators`: 將 Traditional Pivot 從通用指標 picker 遷移到「壓撐」管理，保留既有 instance 並調整為收盤後可採最後一根完整日 K 的 reference lifecycle。

## Impact

- 主交易畫面：`src/components/candle-chart.tsx`、`src/components/candle-chart.css.ts`、indicator migration 與工具列／popover 互動。
- 計算與狀態：既有 `src/lib/traditional-pivot.ts`、`src/lib/pivot-projection-state.ts`、`src/lib/pivot-primitive.ts`，以及新增的壓撐公式、session completion resolver、共用 projection state 與通用水平線 primitive。
- 測試：三套公式 fixture、盤中／收盤後／週末／休市資料選擇、舊 Pivot migration、跨商品與跨時框同步、最多十五線標籤避碰、清除、快速切換及 stale generation。
- 驗收：僅限本機 `127.0.0.1:5173` 與 Shioaji simulation；不得擴張交易權限、外部資料來源、Cloudflare／Sites 或 MultiView 發布範圍。
