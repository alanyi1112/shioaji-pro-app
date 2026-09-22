## Why

目前收盤後選股結果的「加入清單」只會寫入 Shioaji 自選清單「選股」，使用者仍須到 MultiView 重複建立頁籤並逐檔加入，且兩邊狀態可能不一致。需要把同一個明確動作擴充為可驗證、可重試的雙端同步，讓選股結果同時持久存在於 Shioaji 與 MultiView，又不干擾目前觀看中的清單、圖表或交易狀態。

## What Changes

- 將選股結果的「加入清單」動作擴充為兩個彼此獨立且冪等的持久化目標：Shioaji「選股」清單與 MultiView「選股篩選」個人頁籤。
- MultiView 若尚無名稱精確為「選股篩選」的個人頁籤，則由後端以單一原子流程建立頁籤並加入 canonical 台股商品；頁籤或商品已存在時不得重複建立。
- 加入結果須分別保留兩端成功、原已存在或失敗的真實狀態；只有兩端都經後端確認後，介面才可顯示整體完成，部分成功時須指出未完成端並允許安全重試。
- 新增固定用途、loopback-only 的同源 gateway／MultiView mutation 邊界，避免從 5173 使用任意跨來源寫入或開放通用代理。
- MultiView 已開啟的頁面須在重新聚焦或可見時以 single-flight 唯讀刷新收斂「選股篩選」內容，不使用輪詢，也不得自動切換作用中頁籤或圖表。
- 同步流程不得發出委託、切換 production、改動 runtime 生命週期、建立隱性行情訂閱，或觸發未經要求的資料回補。

## Capabilities

### New Capabilities

- `multiview-stock-screener-list-sync`: 定義 MultiView「選股篩選」個人頁籤的唯一性、商品驗證、冪等建立／加入、跨頁面收斂及副作用邊界。

### Modified Capabilities

- `stock-screener-watchlist-integration`: 將既有單一 Shioaji 清單 mutation 擴充為雙端可驗證同步，並定義部分成功、重試與整體 UI 狀態。

## Impact

- 影響選股結果加入流程與狀態呈現：`src/components/stock-screener-panel.tsx`、`src/lib/stock-screener-watchlist.ts` 及相關測試。
- 影響本機 5173 gateway 與啟動設定，新增固定用途的 MultiView 清單同步 API，不提供任意 URL 或通用 mutation 代理。
- 影響 MultiView worker 的個人頁籤／商品寫入路徑、D1 transaction 與驗證測試，以及 MultiView 前端的 focus／visibility 收斂行為。
- 沿用既有 `user_tabs`、`user_instruments` 與商品 catalog，不新增外部套件、正式行情來源或交易權限。
