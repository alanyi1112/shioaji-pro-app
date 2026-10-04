## Why

目前「成交明細」雖能查看逐筆成交、大單與分價分布，仍無法快速判斷當日主動買賣金額如何累積，以及大單與非大單對整體淨額的貢獻。新增共用既有完整日成交 session 的即時資金流向，可在不增加行情來源的前提下提供可核對的盤中趨勢。

## What Changes

- 在支援的台股「成交明細」面板新增「資金流向」檢視，與「成交明細／分價量表」並列，不提供「即時／月」切換或跨月統計。
- 依成交方向、成交金額與既有大單分類，按分鐘顯示「整體／大單／非大單」自開盤起的累積淨額折線圖與最新在前的分鐘表格。
- 使用「大單／非大單」而非無法由成交資料證明的「大戶／散戶」語意；未知方向成交不得冒充買進或賣出，並揭露未納入淨額的範圍。
- 沿用成交明細既有 history、SSE、去重、交易日隔離、coverage、IndexedDB 快取及大單設定 replay，不新增行情 subscription、輪詢或後端 endpoint。
- 沿用現行大單資格：開盤瞬間與 13:25 起的合法成交計入整體淨額，但不分類為大單，因此歸入非大單；設定變更時原子重算大單與非大單序列。
- 以增量分鐘 accumulator 維護最多一個交易日的序列，並支援窄面板、獨立視窗、深色主題與有界表格 DOM。
- 只有 `verified` 資料可宣稱截至目前已核實；`loading`、`partial`、`failed` 與 `confirmed_empty` 必須沿用既有成交資料狀態，不能把部分資料顯示成完整即時資金流向。

## Capabilities

### New Capabilities

- `tick-tape-realtime-money-flow`: 定義即時資金流向的成交範圍、淨額公式、分鐘累積序列、大單／非大單分解、圖表與表格、完整性狀態、效能及 simulation 驗收要求。

### Modified Capabilities

無。

## Impact

- 主要影響 `src/components/tick-tape.tsx`、`src/components/tick-tape.css.ts`、`src/lib/tick-tape-session.ts`、新的資金流向 domain accumulator，以及相關 unit／browser tests。
- 重用 `/api/v1/data/ticks`、`/api/v1/stream/data`、既有大單設定與成交明細 IndexedDB，不新增正式資料來源或資料庫 migration。
- 初始範圍限台灣上市／上櫃 `STK` 的當日一般整股成交；不支援期貨、選擇權、指數、權證、零股、試撮、14:00 定價或跨月資料。
- 真實盤中驗收只可使用 Shioaji simulation；不得啟用 production、送出委託或改變既有行情服務生命週期。
