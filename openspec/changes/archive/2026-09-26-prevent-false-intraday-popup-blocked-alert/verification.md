# 驗證紀錄

2026-09-26（Asia/Taipei）

- `pnpm exec vitest run src/lib/intraday-stock-selection-window.test.ts`：通過，2 項測試；確認專用 URL 與同步 `noopener` 開頁呼叫。
- `pnpm exec vitest run --config vitest.browser.config.ts src/components/hud-header.browser.test.ts`：通過，8 項測試；其中 `window.open` 回傳 `null` 時不顯示錯誤阻擋 alert，來源版面 callback 不被觸發，選單照常關閉。
- `pnpm exec tsc -b --pretty false`：通過。
- `openspec validate prevent-false-intraday-popup-blocked-alert --strict`：通過。
- `git diff --check`：通過。檢視目標檔案差異，本次僅移除盤中選股入口的回傳值誤判與調整相應測試；未改行情、訂閱、交易或服務生命週期程式。

限制：自動化測試以 mock 回傳值驗證來源頁邏輯，未實測使用者瀏覽器原生 popup 阻擋指示；不同瀏覽器的提示方式由瀏覽器決定。本變更不宣稱能從來源頁精確判定分頁是否成功開啟，也不把未開頁顯示成監控已啟動。

## 使用者回報後補驗（2026-09-26 09:44–09:48，Asia/Taipei）

- 失敗證據：使用者 09:44 截圖仍出現「瀏覽器已阻擋盤中選股新分頁」的舊版自製 alert；先前僅通過程式測試，不能視為實際瀏覽器驗收成功。
- 原因線索：repo 原始碼搜尋不到該警告文案，5173 即時提供的 `workspace-layout-menu.tsx` 模組也只有 `openIntradayStockSelectionWindow(); close();`，沒有該 alert。既有 Chrome 看盤頁的 console 曾在 09:46:38 記錄 Vite HMR WebSocket 連線失敗；伺服器端 WebSocket 握手則回應 `101 Switching Protocols`。這些證據符合既有分頁暫時未取得新模組的情況，但無法單獨證明 09:44 截圖的確切分頁更新時序。
- 恢復與實測：未重啟任何服務；重載既有 `127.0.0.1:5173/` 看盤頁後，console 於 09:48:00 記錄 `[vite] connected.`。在該頁實點「版面 → 盤中選股」，新分頁開至 `/?layout=intraday-stock-selection`；來源頁的選單關閉、未出現 JavaScript alert，仍保留原看盤商品與自選清單。
- 未涵蓋：沒有模擬真正被 Chrome 阻擋的新分頁，也沒有證據可把單次 HMR 斷線歸因於前端或 Vite 伺服器的持續性故障。若未來再次出現舊文案，先核對該舊頁的 HMR console 與刷新狀態，不以單次原始碼測試取代 live 驗收。
