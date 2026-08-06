## 1. 回歸契約

- [x] 1.1 新增 Sites 與 Cloudflare 共用頁面級 batch coordinator 的前端 contract test，禁止 production panel path 建立逐 panel `EventSource`
- [x] 1.2 新增新 subscription、in-flight rerun、visible／online immediate refresh 與取消 subscription 的行為測試
- [x] 1.3 保留 `/api/stream` endpoint parity 與 `/api/candles/batch` 八圖上限、逐項失敗隔離測試

## 2. 共用即時更新實作

- [x] 2.1 將 Cloudflare-only poller 改為 Sites／Cloudflare 共用的頁面級 live batch coordinator
- [x] 2.2 讓 in-flight 期間加入的 panel 在目前 batch 完成後立即補跑，且 immediate refresh 能取代既有低頻 timer
- [x] 2.3 確認 panel destroy、商品／週期／Pivot 變更及分類頁籤切換會取消舊 subscription，不會把 payload 套到過期 panel

## 3. 驗證與發布

- [x] 3.1 執行聚焦測試、完整 `npm test`、lint、build、OpenSpec strict、`git diff --check` 與 Free-tier budget gate
- [x] 3.2 精準排除既有 Free-tier verification 與 `add-mainforce-chip-subcharts`，commit／push main 並等待 exact-commit Cloudflare 正式站部署成功
- [x] 3.3 以 Cloudflare 正式站驗證 1／4／8 圖 batch 更新、切頁與 background recovery 無回歸
- [x] 3.4 建立並部署新 Sites 保留站 version，確認實際載入新 asset cache-buster
- [x] 3.5 以既有授權 session 驗證 Sites 保留站至少兩個八圖頁籤的八格皆為本交易日新鮮報價，保存不含個資與秘密的證據
- [x] 3.6 完成 OpenSpec archive、主規格同步、最終驗證、commit／push 與兩個 deployment 的 exact-version 終態
