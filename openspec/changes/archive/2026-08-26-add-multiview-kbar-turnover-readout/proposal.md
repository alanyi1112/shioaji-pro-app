## Why

MultiView 的 K 棒 readout 目前只顯示 OHLCV，使用者在多圖、單圖、forming K 棒及指定日期 1 分 K 中都無法直接比較每根 K 棒的實際成交值。主交易畫面已建立只採用 Shioaji 精確 `Amount／amount／total_amount`、不可估算且以萬元呈現的契約，MultiView 應在維持自身 panel／cache／generation 邊界下提供相同語意。

## What Changes

- 在 MultiView K 棒 OHLCV readout 的成交量後加入「值」，可見文字使用 `值 …萬`，tooltip／accessible name 使用 `成交值 …萬元`；歷史、latest fallback、crosshair、forming K 棒及完整 panel PNG 必須顯示同一 canonical candle 的值。
- 本機 simulation Shioaji 1 分 K 只採用同列合法 `KBars.Amount`；5／15／60 分及日 K只在 bucket 內所有來源值完整時加總。Yahoo、國外商品、指數或任何沒有精確來源契約的資料顯示 `值 —`，不得以 close、volume、average price 或目前既有 `weightedAmount` 推算。
- 將 Shioaji Tick `amount／total_amount` 納入 MultiView 既有商品、台北交易日、source time、sequence、connection、generation 與 total-volume cursor lifecycle；重送、倒退、矛盾、zero-volume snapshot、舊 session 或欄位不安全時只讓成交值 fail unavailable，不污染合法 OHLCV／volume。
- 升版 local coordinator、chart payload、canonical candle、page-scoped Kbars cache與 target-date atomic snapshot 契約，避免撤回成交值能力前建立的舊 payload／cache 被誤當成目前完整資料。
- 保留 1／2／4／8 panel 的 latest-wins crosshair／readout 排程、窄版換行、panel lifecycle、單圖日 K 指定日期 drill-down及完整 panel PNG；不得因新增成交值重建 chart、overlay、技術副圖或籌碼 readout。
- 明確維持成交值左軸、turnover series、設定 checkbox、額外價格軸、Cloudflare／Sites realtime、D1 turnover persistence、production、CA、broker authority與交易操作不在範圍。

## Capabilities

### New Capabilities

- `multiview-kbar-turnover-readout`: 定義 MultiView K 棒成交值的精確來源、萬元格式、crosshair／latest／forming 顯示、可存取性、unavailable 行為、panel layout及不得恢復軸線或估算的邊界。

### Modified Capabilities

- `multiview-minute-kline`: canonical 1 分 K、5／15／60 分聚合與 forming Tick lifecycle 增加精確成交值 availability，並維持既有 simulation-only、single-flight、generation 與 panel pipeline。
- `daily-minute-drilldown`: MultiView 單圖指定日期 1 分 K 的 staged response、validation、atomic commit及返回日 K流程增加成交值 availability，不得從其他日期或 realtime 補接。

## Impact

- 主要影響 `apps/multiview/public/static/realtime-coordinator.js`、`realtime-charts.js`、`chart-payload.js`、`daily-minute-drilldown-contract.js`、`app.js`、`index.html` 與相關樣式。
- 需要升版本機 simulation Shioaji Kbars／SSE payload validator、canonical candle schema、page-scoped cache fingerprint、target-date snapshot及 focused／integration／browser fixtures。
- 需要更新 `apps/multiview/docs/local-runtime.md`、根目錄 README、OpenSpec 驗收矩陣及 127.0.0.1:5174 實際頁面證據。
- 不新增套件，不修改交易／智慧下單資料流，不取得 broker authority，不要求 deployment、production、CA、真實下單或遠端資料庫 migration。
