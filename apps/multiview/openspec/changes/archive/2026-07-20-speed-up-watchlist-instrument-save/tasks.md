## 1. 工作邊界與狀態測試

- [x] 1.1 為單一 TDCC continuous target upsert helper 新增測試，涵蓋 eligibility 後的 user target、相同 symbol 冪等、既有 running／blocked／completed 狀態與其他 targets 不被改寫。
- [x] 1.2 為 `POST /api/instruments` 新增 foreground／background contract 測試，確認 response 不等待 full reconciliation，`waitUntil` 依序執行單一 target 註冊與 prewarm，背景中斷仍保留清單資料。
- [x] 1.3 新增 D1 initialization 共用測試，確認同一 binding 的平行／後續 instrument payload 不重複執行 schema batch，失敗後仍可重試。

## 2. 儲存路徑實作

- [x] 2.1 從 `syncTdccContinuousTargets` 抽出共用的單一 target 狀態計算與 upsert helper，保留 coverage、catalog revision、冪等與既有狀態語意。
- [x] 2.2 更新清單商品 background work，在 eligibility 通過後以 `context.waitUntil` 註冊本次 symbol target並執行日籌碼預熱；從 `saveInstrument` foreground 移除完整 reconciliation。
- [x] 2.3 將 `ensureDb` 的 schema batch 與 localized seed 以同一 D1 binding promise 共用，失敗時清除 cache；不新增或變更 schema。
- [x] 2.4 保留 `/api/instruments` canonical response、使用者／頁籤隔離、商品欄位與前端「商品已儲存」更新流程，補齊必要 regression 測試。

## 3. 驗證與發布

- [x] 3.1 執行 focused tests、完整 `npm test`、lint、build、JavaScript／TypeScript 適用檢查、`git diff --check` 與 `npx openspec validate --all --strict`。
- [x] 3.2 使用瀏覽器在本機與正式站對既有商品做內容不變的冪等儲存，量測按下儲存到「商品已儲存」的 elapsed time，確認清單順序與商品仍正確且畫面不長時間停在 loading。
- [x] 3.3 提交並推送 exact validated source，發布 owner-only Sites version，確認 live API／資產、background target／prewarm 接手與正式站可見結果後記錄驗收證據。
