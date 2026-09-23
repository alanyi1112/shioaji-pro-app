## 1. 根因與版面同步修復

- [x] 1.1 以穩定商品鍵取代 `TickTape` layout effect 的 `contract` 物件參照比較
- [x] 1.2 加入 guarded scroll state 同步，避免未改變的 `scrollTop` 重複 dispatch
- [x] 1.3 確認真正切換上下文與新成交閱讀錨點仍符合既有行為

## 2. 回歸測試

- [x] 2.1 增加等價 `contract` 重新 render 不重置捲動位置的瀏覽器測試
- [x] 2.2 執行成交明細 session 與相關分價量表／資金流向 focused tests
- [x] 2.3 執行 TypeScript、build 與既有測試，記錄任何不屬於本 change 的失敗

## 3. OpenSpec 與實機驗證

- [x] 3.1 通過本 change 與全專案 OpenSpec strict validation
- [x] 3.2 重新載入本機交易終端，確認不再顯示 `Maximum update depth exceeded` 啟動失敗畫面
- [x] 3.3 執行 `git diff --check` 並確認沒有混入無關變更
