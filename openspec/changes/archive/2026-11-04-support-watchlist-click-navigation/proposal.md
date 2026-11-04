## Why

使用者需要在自選清單下拉選單以左鍵單擊切換目前分頁，以左鍵雙擊另開同一看盤版面。原生 select 無法可靠區分這兩個動作，且新分頁的清單不得覆寫原分頁的選擇。

## What Changes

- 自訂可鍵盤操作的下拉選單，單擊約 500ms 後選取，雙擊只開一個新分頁且取消單擊。
- 另開 URL 保留目前版型／profile，以 watchlist 參數指定清單；不將未儲存的即時版面宣稱為完整複製。
- 新分頁指定清單優先於全域上次清單，初始化不覆寫全域偏好；目前分頁改選後更新自身已有的 URL 參數。
- 保留右鍵一般行為、外部點擊取消、方向鍵／Enter／空白鍵與 Escape 隔離；不修改服務端清單內容。
- 補記既有實作與真實 Chrome 驗證，不在本次重做瀏覽器交易頁操作。

## Capabilities

### New Capabilities
- `watchlist-click-navigation`: 清單單擊切換、雙擊新分頁及分頁選擇隔離。

### Modified Capabilities
無；既有載入韌性與服務端 CRUD 契約保持。

## Impact

WatchlistPicker、watchlist 樣式／接線、watchlist-window、use-watchlist 與 App URL 接線。四個未完成大案保持；不新增券商登入、訂閱授權或交易行為，不 commit／push。
