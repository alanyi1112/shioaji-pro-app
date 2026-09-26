## 1. 修正安全開頁入口

- [x] 1.1 移除「版面 → 盤中選股」依 `window.open` 回傳值顯示的錯誤阻擋 alert，保留同步 `noopener` 開頁及來源 workspace 不變
- [x] 1.2 更新版面選單 browser test：`noopener` 可能回傳 `null` 但不得顯示誤報，且仍須驗證 URL、來源版面與選單行為

## 2. 驗證與交付

- [x] 2.1 執行盤中選股開頁單元測試、版面選單 browser test 與 TypeScript 檢查，確認沒有改動行情／訂閱／交易流程
- [x] 2.2 執行 OpenSpec strict validation 與 `git diff --check`，記錄驗證結果與未涵蓋的瀏覽器原生阻擋情境

## 3. 使用者實測回報補驗

- [x] 3.1 核對 2026-09-26 09:44 使用者截圖與 5173 實際提供的模組，保留舊頁誤報及 HMR 斷線證據
- [x] 3.2 不重啟服務，重載既有看盤頁並實點「盤中選股」，核對新分頁、來源版面與無自製 alert
