## 1. 置底操作

- [x] 1.1 在每個籌碼 pane 右鍵功能表加入固定顯示的「置底」操作、accessible name 與 disabled 狀態
- [x] 1.2 在 manager 實作整組移到最後一個可見群組位置，保存一次順序並只觸發一次 layout refresh
- [x] 1.3 在 controller destroy 清理置底 listener，且置底不得重新請求資料

## 2. 回歸測試

- [x] 2.1 新增置底功能表、首尾狀態、manager 排序、保存與 lifecycle contract 測試
- [x] 2.2 更新靜態資源版本並確認正式 HTML 載入新版腳本

## 3. 驗證與發布

- [x] 3.1 執行 lint、build、完整測試、OpenSpec strict validation 與 `git diff --check`
- [x] 3.2 以瀏覽器驗證置底、disabled 狀態及重新載入後保留順序
- [x] 3.3 發布 private Sites 正式版本並驗證正式 HTML、資源與 health
