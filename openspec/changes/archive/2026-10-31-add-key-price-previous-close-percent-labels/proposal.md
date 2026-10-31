## Why

目前分K的 CDP、三關價、Pivot Point，以及日K的費波那契回撤／拓展只顯示關鍵價位，看盤者仍需自行計算它們相對昨收的漲跌幅。直接在價位旁顯示已算好的百分比，可在切換時框及比較多條線時立即判讀，同時維持原本K棒大小與縱軸範圍。

## What Changes

- 在主交易畫面 1m／5m／15m／60m／1D 的 CDP、三關價與 Pivot Point 每條價位標籤旁，常駐顯示較昨收的漲跌百分比（依2026-10-31最新授權納入日K壓撐）。
- 在主交易畫面1D費波回撤及拓展，以日K圖資料序列最後一根close計算百分比；比率、價格與無「較昨收」前綴的百分比放在線段左側，不改圖表視窗。
- 共用 `(關鍵價位 ÷ 比較基準收盤價 − 1) × 100%` 計算。CDP／三關價／Pivot Point以所屬參考K棒close為分母；日K費波依最新授權使用圖表序列最後一根close。分別顯示來源日期與收盤，不混用。
- 百分比顯示小數兩位及正負號，沿用漲跌配色；缺少可驗證昨收、來源身分或價格基準不一致時，保留原價位並顯示 `—` 與原因。
- 擴充標籤量測與避碰；新增文字不得改動K棒大小、面板／價格軸尺寸、縱軸範圍、時間視窗或觸發 fitContent。
- 使用已取得的同商品行情與日K資料；本功能不新增來源下載、訂閱、資料庫寫入或預算需求。

## Capabilities

### New Capabilities

- `key-price-previous-close-percent-labels`：昨收基準的日期與來源身分、純計算及格式化、資料不足狀態、標籤可讀性與視窗不變契約。

### Modified Capabilities

- `main-chart-support-resistance-tools`：分K及日K三種壓撐公式的既有價位標籤加上較昨收百分比。
- `main-chart-fibonacci-tools`：1D回撤與拓展標籤加上較昨收百分比，維持公式、錨點、原費波比率、配色及儲存契約。

## Impact

- 主要接線：`src/components/candle-chart.tsx`、`src/lib/pivot-primitive.ts`、`src/components/fibonacci-overlay.tsx`、`src/lib/fibonacci-overlay.ts`；新增可共用的昨收基準及百分比純函式，沿用既有標籤配置工具。
- 資料來源：只讀既有日K／行情與可用的日線 authority；不得把沒有日期證據的 `contract.reference` 直接當作實際昨收。
- 驗證：正負與零值、休市前一交易日、除權息價格基準、跨日／換股／generation、窄面板／密集標籤，以及新增百分比前後的實際K棒座標與視窗回歸。
- 範圍僅主交易畫面 5173 的上述時框與工具；MultiView、日線MA／BOLL水平價位、其他時框、交易行為、API／watchdog、下載排程、Gate及正式部署不在本次提案範圍。
- 本次交付提案文件，尚未實作、套用或變更執行中服務。
