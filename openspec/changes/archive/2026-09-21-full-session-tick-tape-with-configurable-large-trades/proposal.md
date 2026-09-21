## Why

成交明細目前只載入最近 120 筆，全部與大單各保留 120／500 筆，無法查看開盤以來完整成交。大單條件寫死，也無法依使用者設定重新篩選整日資料。

## What Changes

- 全部頁籤提供目前商品從開盤至今的完整成交，歷史補齊後接續即時資料，保留完整日資料並以虛擬列表顯示。
- 大單頁籤提供當日所有符合目前設定的成交，取消 500 筆淘汰；設定改變後按時間重播整日資料。
- 可設定金額、張數、動態樣本數、百分位數、暖機筆數與整組 AND／OR。預設為 100 萬元、10 張、前 120 筆、P80、暖機 30 筆、AND。
- 大單維持台股整股、排除試撮，時間嚴格晚於 09:00:00 且早於 13:25:00；這個時段限制不縮短全部頁籤。
- 設定持久保存，主面板與獨立視窗一致；資料載入中、缺口、失敗與真正無成交需明確區分。

## Capabilities

### New Capabilities

- `tick-tape-full-session-history`：完整交易日成交資料、歷史與即時銜接、缺口處理、持久快取及虛擬列表。

### Modified Capabilities

- `tick-tape-large-trade-tab`：可調整的大單條件、AND／OR、重新分類、完整日結果與設定同步。

## Impact

- `src/components/tick-tape.tsx`、`tick-tape.css.ts`、`src/lib/tick-tape-large-trade.ts`、`src/lib/shioaji.ts`、stream 銜接及相關測試。
- 新增共享的交易日資料儲存與設定管理；歷史查詢依既有 Shioaji API 能力與限制有界執行。
- 不改動 160 檔量比基準或排程；不新增交易、production 或服務生命週期操作。本案只處理成交明細與衍生篩選。
