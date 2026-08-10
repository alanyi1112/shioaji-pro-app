## Why

主交易畫面的 Traditional Pivot Point 與 MultiView 採用不同的 reference、投影起點、線型、標籤及 readout，切換時框時也會各自重算，無法把 1D 選定的同一組水準可靠帶到分鐘圖。費波那契回撤的 Option／Alt 目前又被定義成自由價位，而本機 MultiView 只允許日／週／月 K，三者均與目前希望的跨畫面操作方式不一致。

## What Changes

- 將主交易畫面的 Traditional Pivot Point 對齊 MultiView 的版本化 projection contract、歷史 reference 選取、完成／暫估語意、右向七線、線型、標籤避碰、短導引線、readout 與 autoscale 行為。
- 將主交易畫面的 Pivot 改為由 1D 管理：只在 1D 建立、固定歷史、回到最新或刪除；1m、5m、15m、60m 只顯示同商品同一組 1D projection，並在 1D 刪除後同步移除。
- 修改主交易畫面與 MultiView 的費波那契回撤組合鍵：未按 Option／Alt 時維持 A 吸附單根 K 棒 low、B 吸附 high；按住 macOS Option 或 Windows Alt 時改為 A 吸附 high、B 吸附 low。費波那契拓展維持既有自由價位規則。
- 本機 MultiView 的 K 線 interval 選單在既有 `1d`、`1wk`、`1mo` 之上加入 `1m`、`5m`、`15m`、`1h`，其中 UI 將 `1h` 顯示為 `60m`；既有週 K、月 K 與其保存設定 MUST 保留，只有 `intraday` 與其他非法 interval 在本機載入時正規化為 `1d`。既有 Cloudflare／Sites 部署週期與發布驗收不納入本 change。
- 以 Shioaji simulation 的 canonical 1 分 Kbars 與訂閱 Tick 建立本機 MultiView 分 K，5／15／60 分由同一份 1 分 K 聚合；不得把既有成交價／均價「分時」折線冒充 OHLC K 棒。
- 分 K 必須沿用 MultiView 既有 Candlestick、Pivot、費波那契、主副圖技術指標、viewport、history paging、latest-wins、來源狀態與完整 panel PNG 行為；Shioaji 不可用時只能原子切換到明確標示的 delayed fallback，不得混接 OHLCV。
- 驗收限定本機 `127.0.0.1:5174`、Shioaji simulation 與既有安全本機 adapter；不啟用 production、真實下單、Cloudflare realtime、Sites 多帳戶或已停止的正式站 gate。

## Capabilities

### New Capabilities

- `multiview-minute-kline`: 定義本機 MultiView 的 1m／5m／15m／60m canonical K 線、歷史回補、即時 bucket 更新、跨日、聚合、fallback、去重與多 panel 驗收契約。

### Modified Capabilities

- `chart-technical-indicators`: 將主交易畫面 Pivot 改成 MultiView projection 與視覺契約，並由 1D authoritative lifecycle 管理所有支援分鐘時框。
- `main-chart-fibonacci-tools`: 將回撤的 Option／Alt 從自由價位改為 A high／B low 反向吸附，並保留拓展既有自由價位。
- `multiview-workspace-navigation`: 將本機 MultiView allowlist 從日／週／月擴充為 1m／5m／15m／60m／日／週／月，並定義非法舊設定遷移與部署邊界。
- `multiview-taiwan-realtime-market-data`: 擴充本機 Shioaji simulation，讓同一條頁面級 SSE 與一次性 Kbars 歷史支援分鐘 K 即時更新及完整 fallback。

## Impact

- 主交易畫面：`src/components/candle-chart.tsx`、`src/lib/traditional-pivot.ts`、`src/lib/pivot-primitive.ts`、`src/lib/fibonacci-annotations.ts`、indicator store 與相關 unit／browser tests。
- MultiView 前端：`apps/multiview/public/static/app.js`、`chart-annotations.js`、`realtime-charts.js`、interval／URL／localStorage／panel cache／batch coordinator、樣式與可見驗收工具。
- MultiView 本機資料路徑：local Shioaji adapter、realtime coordinator、1 分 Kbars single-flight/cache、分鐘聚合與 source-state contract；不擴張下單路徑或 production 權限。
- API：本機 `/api/instruments`、`/api/candles`、`/api/candles/batch`、`/api/stream` 接受新的本機 interval allowlist；UI `60m` 對應 API canonical `1h`。
- OpenSpec：同步根目錄 capability 與 `apps/multiview/openspec` 中重疊的 Pivot、Fibonacci、interval 及即時 K 線契約，避免雙份規格漂移。
