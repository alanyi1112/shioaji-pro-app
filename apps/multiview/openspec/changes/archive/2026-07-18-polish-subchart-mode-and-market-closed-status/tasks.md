## 1. 副圖模式控制

- [x] 1.1 移除工具列常駐副圖模式說明列，將選項文案改為「單一副圖」與「多層副圖」
- [x] 1.2 讓 4／6／8 圖的模式下拉選單套用原生 disabled、ARIA 與灰色樣式，切回 1／2／3 圖時恢復可操作及原偏好
- [x] 1.3 更新 HTML／前端 contract 測試，涵蓋文案、無額外說明列及 disabled 狀態切換

## 2. 台股休市報價狀態

- [x] 2.1 在報價狀態 formatter 加入台北週末及既有休市 metadata 判斷，顯示「休市」
- [x] 2.2 保留最近交易日既有 verification 與 freshness 優先順序，避免只因跨日降級為「未驗證」
- [x] 2.3 新增星期六、星期日、已核對前收與 stale cache 的回歸測試

## 3. 驗證與部署

- [x] 3.1 執行完整測試、build、`git diff --check` 與 `openspec validate --all --strict`
- [x] 3.2 部署私有 Sites 正式版本並以已登入瀏覽器驗收 2 圖、4 圖與週末休市可見結果
