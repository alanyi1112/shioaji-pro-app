## Why

主交易畫面的 Traditional Pivot 目前藏在通用「指標」流程，且沒有把三關價與 CDP 納入同一套參考 K 棒、跨時框投影及清除語意。使用者需要在「指標」旁以直覺的「壓撐」入口統一管理三種價位工具，並讓盤中與收盤後的預設參考日符合台股交易狀態。

## What Changes

- 在主交易畫面 K 線工具列新增「壓撐」按鈕與鍵盤可操作的選單，提供 `PivotPoint`、`三關價`、`CDP` 三個 checkbox；預設全部關閉。
- 「壓撐」按鈕與相鄰「指標」同為 toolbar 的直接 flex child，沿用相同文字大小、位置、內距、高度、寬度及正常／active 視覺語言，並額外保留清楚可見的按鈕框線；三個公式列右側各提供設定圖示，可個別調整並保存整組線條的顏色、粗細與實線／虛線／點線樣式。
- 壓撐樣式對話框在 React `StrictMode` 下 MUST 安全處理顏色、粗細與線型事件，不得因延後執行的 state updater 讀取已失效 SyntheticEvent 而造成全頁啟動失敗或閃退。
- 台股普通股票與 ETF 的即時報價、漲跌價差及相關報價欄位 MUST 依各自升降單位顯示必要小數位；ETF 以 canonical contract category 判斷，只有 metadata 缺失時才使用代號 fallback。
- 將既有 Traditional Pivot 從通用「指標」入口遷移至「壓撐」，沿用既有設定並避免同一商品出現兩份 Pivot 線。
- 三種工具共用使用者在 1D 選定的 reference K 棒；1m、5m、15m、60m 只鏡像同商品同一組 reference 與已啟用的水平價位，不能各自重算或清除。
- 任一公式已啟用時，1D 游標模式直接點選其他合法已完成 K 棒即以該根 H／L／C 重算，不再要求先啟動「固定歷史」；所有價格線以該根 K 棒為左側起點向右延伸。
- 台股盤中若今日有未完成日 K，預設使用上一個完整交易日；收盤並確認今日 K 棒完整後使用最後一根日 K。若無法證明今日資料完整，保持 fail closed，使用上一個完整交易日。
- 壓撐價位只在右側線標籤顯示，左上角只保留共用 reference 的自動／固定、日期、完成狀態及「回到最新」控制，不重複列出各 level 值。取消單一 checkbox 時只清除該公式的線、標籤與 autoscale；三項全數取消時清除整組壓撐投影。固定歷史 reference 只保留於目前 document session，reload 後依自動規則重選。
- 以版本化純函式與 fixture 固定三套公式，並以共用標籤避碰、短 connector、右側價位標示及有限值 autoscale 呈現最多十五條水平線。
- MultiView 各 panel 的「主圖」選單加入 `三關價` 與 `CDP`，與既有 `Pivot Point` 共用該 panel 的 reference K 棒、直接點選／回到最新、向右投影、右側標籤、autoscale 及日／週／月參考週期契約；三項開關保持 panel-local，不與主交易畫面的 canonical indicator store 混用。
- MultiView 以來源週期保存每組壓撐設定與 reference：月、週、日及分鐘長週期建立的線，MUST 留置於相同或更短週期；checkbox、直接選棒、回到最新與取消只管理目前來源週期，繼承線只能回到原來源週期取消。
- 本 change 涵蓋主交易畫面與 MultiView 的壓撐公式一致化；主交易畫面仍只支援 STK／IND／WRT，不支援 FUT／OPT，不啟用 production 或真實下單。
- 實作前必須先歸檔並同步已完成的 `align-chart-tools-and-add-multiview-minute-klines`，以其 1D-authoritative Pivot projection 作為基準，避免兩個 active change 同時改寫 Pivot 契約。

## Capabilities

### New Capabilities

- `main-chart-support-resistance-tools`: 定義主交易畫面「壓撐」入口、PivotPoint／三關價／CDP 公式、共用 reference K 棒、自動交易日選擇、1D-authoritative 跨時框投影、標籤呈現與個別清除契約。
- `multiview-main-chart-support-resistance`: 定義 MultiView「主圖」的 Pivot Point／三關價／CDP panel-local 開關、共用 reference K 棒、既有分鐘／日／週／月週期投影、直接選棒與個別清除契約。
- `taiwan-quote-price-formatting`: 定義普通股票與 ETF 的報價／漲跌價差顯示精度、商品辨識、級距邊界及非台股 fallback。

### Modified Capabilities

- `chart-technical-indicators`: 將 Traditional Pivot 從通用指標 picker 遷移到「壓撐」管理，保留既有 instance 並調整為收盤後可採最後一根完整日 K 的 reference lifecycle。

## Impact

- 主交易畫面：`src/components/candle-chart.tsx`、`src/components/candle-chart.css.ts`、壓撐公式樣式設定、indicator migration 與工具列／popover 互動。
- 報價顯示：`src/lib/utils/ticksize.ts`、`src/lib/utils/format.ts`，以及自選清單、排行榜、報價摘要、五檔、逐筆成交與 tray 等台股報價面板。
- 計算與狀態：既有 `src/lib/traditional-pivot.ts`、`src/lib/pivot-projection-state.ts`、`src/lib/pivot-primitive.ts`，以及新增的壓撐公式、session completion resolver、共用 projection state 與通用水平線 primitive。
- MultiView：`apps/multiview/worker/pivot-points.ts`、`apps/multiview/public/static/index.html`、`apps/multiview/public/static/app.js` 與相關 worker／DOM contract tests。
- 測試：三套公式 fixture、盤中／收盤後／週末／休市資料選擇、舊 Pivot migration、跨商品與跨時框同步、最多十五線標籤避碰、清除、快速切換及 stale generation。
- 驗收：僅限本機 `127.0.0.1:5173`、`127.0.0.1:5174` 與 Shioaji simulation；不得擴張交易權限、外部資料來源、Cloudflare／Sites 或 MultiView 發布範圍。
