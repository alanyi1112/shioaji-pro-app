## Why

既有分頁可能漏接 HMR 而一直顯示舊版；手動重新整理又會遺失原清單、商品或 K 線週期。使用者要求以後自動載入新版並延續目前看盤狀態。

## What Changes

- 本機 Vite 以磁碟內容版本及 HTML meta 連接每 15 秒的本機 GET；兩次相同新版相隔至少 2 秒才更新，補足漏接 HMR 的情況。
- 一般前端來源變更由可保存狀態的重載流程處理；操作選單、輸入、拖曳、指標設定或已知保存失敗時延後。
- 先擷取各圖視窗，再保存並讀回每分頁 sessionStorage；恢復清單、canonical 商品、工作區、逐圖週期與視窗。
- 保留已儲存的指標及已完成畫線，交接不包含行情快照、帳務、秘密或待送出的交易動作。
- 本次只補規格、驗證與結案，不重新觸發正式頁面更新或更動原生服務。

## Capabilities

### New Capabilities
- `local-web-automatic-update`: 本機前端版本偵測、安全重載與各分頁畫面接續。

### Modified Capabilities
無；沿用 `hmr-selection-continuity` 的身分、取消、短效交接及需求集合保護，再增加自動版本檢查與清單／視窗保存。

## Impact

app-revision Vite plugin、main entry、app-update client／runtime／checkpoint、hmr-view store／hook、App／CandleChart 及指標對話框語意。適用本機 Vite Web，不宣稱桌面安裝包或遠端靜態發布已能自動升級。Node 型別與舊 wiring 斷言失敗分列既有基線缺口，不藉歸檔掩蓋；四個未完成大案、背景監控／採集與 Git index 保持。
