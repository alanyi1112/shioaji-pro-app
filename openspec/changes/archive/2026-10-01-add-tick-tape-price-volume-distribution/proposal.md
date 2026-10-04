## Why

目前「成交明細」只能逐筆查看當日成交與大單，無法快速看出成交量集中在哪些價位、各價位買賣方向及大單分布。新增與既有完整日成交 session 共用資料的「分價量表」，可在不增加另一套行情來源的前提下提供可核對的價位分布。

## What Changes

- 在「成交明細」面板新增「成交明細／分價量表」檢視切換，並保留既有「全部／大單」、大單設定及資訊入口。
- 為台股 `STK + TSE/OTC` 依實際成交價彙總當日整股、非試撮成交，顯示成交價、買方／賣方／未知方向成交量圖、大單佔比、總佔比與成交量。
- 顯示總成交均價及大單成交均價；沒有大單時以不可計算狀態呈現，不以 `0` 冒充價格。
- 沿用既有可設定大單分類器，使用「大單」而非無法驗證身分的「大戶」語意；設定變更時同步重算分價統計。
- 標示目前價、開盤價與當日高低成交價位，進入分價量表時將目前價附近帶入可見範圍。
- 沿用成交明細既有歷史成交、SSE、去重、連續性與 coverage 狀態；資料不完整時明示部分資料，不將部分統計宣稱為完整全日結果。
- 以增量價位 bucket 維護統計，避免每一筆即時成交都重新掃描完整日最多 500,000 筆資料。

## Capabilities

### New Capabilities

- `tick-tape-price-volume-distribution`: 定義分價量表的資料範圍、彙總公式、買賣方向、標記、完整性狀態、互動及即時更新要求。

### Modified Capabilities

無。

## Impact

- 主要影響 `src/components/tick-tape.tsx`、`src/components/tick-tape.css.ts`、`src/lib/tick-tape-session.ts`、相關 domain／browser tests 與成交明細 UI。
- 重用 `/api/v1/data/ticks`、SSE tick、IndexedDB 快取與既有大單設定，不新增正式行情來源或後端 endpoint。
- 初始範圍限台股上市／上櫃普通整股成交；期貨、選擇權、零股、試撮及 14:00 定價交易不納入本功能。
- 需以 Shioaji simulation 的真實盤中歷史＋SSE 做驗收；不得啟用 production 或真實下單。
