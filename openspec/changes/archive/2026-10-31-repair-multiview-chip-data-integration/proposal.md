## Why

MultiView 籌碼資格、日籌碼預熱及 TDCC 更新仍只讀舊 user_instruments，漏掉 user_system_tab_instruments 中的商品。00406A 日線因此誤報不支援，既有持股歷史也無法顯示。選股與 MultiView 雖共用 D1，已驗證資料仍分離，且自然更新失敗只留下不精確的 invalid_response。

## What Changes

- 統一已啟用清單商品的來源，涵蓋個人與系統頁籤，保留使用者隔離及商品資格。
- 以來源收據、日期、單位及 mapping 驗證為界，共用可相容的籌碼資料，保留各產品不相容欄位與未知值。
- 查明並修復排程已重現的程式錯誤，保留原失敗收據、冷卻、資源與來源 Gate。
- 驗證 00406A 實際資料與畫面；真實缺資料分列，不補零、不追認成功。

## Capabilities

### New Capabilities
- `shared-local-chip-data`: 本機籌碼商品身分、來源收據及共用資料契約。

### Modified Capabilities

## Impact

僅本機 MultiView、選股籌碼資料路徑及其測試文件；不涉及交易 API、盤中量比、遠端部署、其他專案或排程頻率調整。
