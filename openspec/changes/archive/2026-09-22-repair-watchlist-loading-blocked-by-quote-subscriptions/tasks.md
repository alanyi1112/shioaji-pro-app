## 1. 訂閱請求與狀態

- [x] 1.1 為行情訂閱 POST 增加 bounded timeout 與 abort，並補 timeout 行為測試
- [x] 1.2 將 watchlist 訂閱狀態拆成 pending／subscribed，只有必要報價種類全部成功才完成，失敗後可由後續載入重試

## 2. 清單載入流程

- [x] 2.1 在 canonical 合約解析後立即發布清單列，將行情訂閱及 migration 同步改為不阻塞畫面的背景工作
- [x] 2.2 依 list id 在同清單刷新時保留列、切換清單時清空，並以 latest-wins `finally` 收斂 loading

## 3. 回歸驗證

- [x] 3.1 增加瀏覽器測試，證明訂閱永遠不完成或失敗時清單仍顯示且 loading 結束
- [x] 3.2 增加瀏覽器測試，覆蓋 pending 去重、失敗後重試、同清單保留列與跨清單 latest-wins
- [x] 3.3 執行相關 unit／browser tests、TypeScript build、OpenSpec strict validation 與 `git diff --check`

## 4. 線圖請求連線飢餓修復

- [x] 4.1 為 Vite loopback 開發環境建立市場脈動 SSE 的等價 hostname 分流，且不改動 Tauri、明確 API base 或非 loopback 路徑
- [x] 4.2 增加 origin 選擇回歸測試，覆蓋 `127.0.0.1`／`localhost` 雙向分流與不應改寫情境
- [x] 4.3 在實際瀏覽器確認 SSE 已分流，切換商品後 1D K 線可完成載入，並執行相關 tests、build、OpenSpec strict validation 與 `git diff --check`
