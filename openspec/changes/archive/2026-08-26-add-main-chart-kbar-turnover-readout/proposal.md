## Why

交易主畫面的 K 棒價量 readout 目前只顯示以「張」為單位的成交量，使用者無法在游標所指或最新 K 棒上直接判讀該時間單位的實際成交值。Shioaji Kbars 與即時 Tick 已提供可驗證的 `Amount`／`total_amount`，應以同一根 canonical K 棒顯示精確成交值，而不是以收盤價乘成交量估算。

## What Changes

- 在交易主畫面紅框所示 K 棒價量 readout 的「量」之後加入「值」，台股整股 STK 依序顯示為 `量 910張　值 9,355萬`。
- 畫面、tooltip 與 accessible name 全部以「萬元」表達成交值；tooltip／accessible name 使用完整語意，例如 `成交值 9,355萬元`，不顯示換算前的元金額。
- 歷史 K 棒只採用 Shioaji `KBars.Amount`；5／15／60 分與日 K 由相同 canonical 1 分 K 的成交值加總。形成中 K 棒只採用可驗證的 Tick `amount`／`total_amount` 增量，並與商品、交易日、source time、sequence、generation及既有成交量 lifecycle 綁定。
- 資料缺漏、無效、倒退、重放或來源單位不可信時顯示 `值 —`，不得使用 `close × volume × 1,000`、平均價或其他推測值補算。
- 指定日期 1 分 K drill-down 必須保留同一來源的精確成交值，使交易主畫面切入歷史日期後仍遵守相同 readout 契約。
- 本 change 明確只重新支援交易主畫面的文字 readout；2026-08-24 已撤回的成交值左側縱軸、成交值圖線／設定、MultiView 成交值、gateway／Worker turnover payload及其他視覺化能力仍維持不支援。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `kbar-price-volume-readout`：在主交易畫面的台股整股 K 棒 readout 加入精確成交值、萬元格式、不可用語意與歷史／形成中一致性要求。
- `daily-minute-drilldown`：指定日期 1 分 K 的原子 snapshot 與 readout 必須保留 Shioaji `Amount`，但不得因此恢復成交值軸或 MultiView turnover contract。

## Impact

- 主要影響 `src/lib/types/market.ts`、`src/lib/utils/kbars.ts`、主圖 readout／即時累加相關 domain、`src/components/candle-chart.tsx`、指定日期 drill-down contract及其 focused／integration／browser tests。
- Shioaji REST／SSE 仍為既有 simulation 行情來源，不新增 broker write、下單、production、CA、真實委託或帳號授權。
- 不修改 `apps/multiview/` 的圖表、payload、cache fingerprint或左側價格軸，不新增外部依賴。
- 目前暫停中的 `add-durable-smart-order-panel-and-protective-exits` 保持獨立，不重排、不勾選也不修改其 tasks／evidence。
