## 1. 問題重現與保護契約

- [x] 1.1 建立快取首繪後前景更新的測試契約，覆蓋有效生命週期、提交順序與錯誤狀態分類。
- [x] 1.2 建立圖表資料正規化測試，覆蓋 candle、line、histogram 的 null、undefined、NaN 與非有限值。

## 2. 前端修正

- [x] 2.1 實作可繪製 payload prepare 流程，禁止無效資料進入 Lightweight Charts 或 panel cache。
- [x] 2.2 串行化同一 panel 的快取首繪與前景更新，隔離失效 generation、load token 與延遲圖表工作。
- [x] 2.3 將 canonical payload、last payload 與 cache 移至完整套用成功後提交，失敗時保留上一份可用畫面並顯示正確錯誤類型。

## 3. 驗證與發布

- [x] 3.1 執行 build、完整測試、lint、OpenSpec strict 與 `git diff --check`。
- [x] 3.2 在瀏覽器驗收第 1／2 頁快速往返、`00919.TW`、`00982A.TW`、捲動、游標與可視範圍，確認不再出現 `Value is null`。
- [x] 3.3 歸檔變更、同步主規格並準備同一 commit 的 Sites 保留站與 Cloudflare 正式站發布證據。
