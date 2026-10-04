## Why

MultiView 目前只能在原頁籤內拖曳商品排序；要把商品移到另一個頁籤，或從正在看的線圖所屬清單移除，仍須進入清單管理畫面。這增加操作步驟，也容易讓「目前線圖顯示的商品」與「頁籤實際收錄的商品」混淆，造成錯誤修改。

## What Changes

- 在線圖商品卡片提供跨頁籤拖放：拖至目的頁籤標題後預設移動至第一位；放開時按住 Mac Option 則複製至第一位。保留現有頁籤內排序行為。
- 在線圖右鍵功能表及卡片標題可見的操作入口提供「從『頁籤』移除『商品』」，明確確認後只修改該頁籤的清單成員資格。
- 提供不依賴拖曳的移動與複製操作，並處理目的地已含同商品、未儲存的排序、系統／個人頁籤、權限與請求失敗等情況。
- 跨頁籤移動與置頂必須由伺服器以一致的清單寫入完成；失敗時不留下只加入目的地或只移除來源的半成品，不觸發下單或其他應用清單異動。

## Capabilities

### New Capabilities

- `multiview-watchlist-direct-manipulation`：MultiView 線圖上的跨頁籤移動／複製、直接移除、操作回饋與清單一致性。

### Modified Capabilities

無。既有 MultiView 與 RealTimeStock 清單隔離要求維持不變。

## Impact

- 前端：`apps/multiview/public/static/app.js`、線圖卡片模板與樣式、互動與無障礙測試。
- 後端：`apps/multiview/worker/app.ts` 的清單 mutation、頁籤身分驗證、排序持久化與相關測試。
- 資料：僅目前使用者的 MultiView `user_tabs`／`user_instruments`；不修改 Shioaji 清單、行情訂閱、交易與其他使用者資料。
