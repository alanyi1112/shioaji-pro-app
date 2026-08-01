## 1. 啟動狀態與降級

- [x] 1.1 在 `useWatchlist` 增加服務問題狀態並辨識 `SessionNotEstablished`
- [x] 1.2 讓 session 不可用時立即結束 boot gate，其他錯誤保留有限度重試
- [x] 1.3 提供不阻塞工作區的手動重新檢查與恢復流程

## 2. 使用者介面

- [x] 2.1 新增模擬服務離線／非服務時間提示列與重新檢查按鈕
- [x] 2.2 降級期間覆蓋 header 的 `LIVE` 狀態，避免誤導

## 3. 驗證

- [x] 3.1 驗證目前 `SessionNotEstablished` 情境可進入工作區並顯示提示
- [x] 3.2 執行 TypeScript 與 Vite production build
- [x] 3.3 執行 OpenSpec strict validation 與 `git diff --check`
