## Context

`savePersonalInstrument` 在 UI 顯示「商品儲存中...」後，會等待 `POST /api/instruments` 回傳完整 instrument payload。Worker 目前先 upsert `user_instruments`，接著同步呼叫 `refreshTdccContinuousTargets`；後者重讀 setup、完整商品目錄與所有使用者商品，處理官方 baseline／新上市集合，並對每個 active target 逐一讀 coverage、狀態及 upsert。正式站目前有 38 個 targets，因此單次互動式儲存至少增加 38 組逐項 D1 操作，另有完整 catalog 批次寫入。

籌碼來源下載已透過 `context.waitUntil` 背景執行，但 target reconciliation 仍留在 foreground，違反既有「API 先回應」規格。此 change 必須保留 D1 使用者隔離、全站 symbol 去重、continuous scheduler 與 background prewarm 的可靠性，同時避免以不穩定的 wall-clock 單元測試取代可驗證的工作邊界。

## Goals / Non-Goals

**Goals:**

- 讓 `POST /api/instruments` 的 foreground 只包含 schema ready、單筆清單 upsert 與回傳 canonical instrument payload 所需工作。
- 讓合格台股的單一 continuous target 註冊及日籌碼預熱在 `context.waitUntil` 執行，完整 reconciliation 不阻塞 API response。
- 保留 durable scheduler 對完整 target 集合、停用商品、官方新上市與背景中斷的最終一致性責任。
- 以 query boundary、背景 promise 生命週期、冪等性及正式站 elapsed time 驗證改善。

**Non-Goals:**

- 不改變「我的清單」表單、排序、頁籤、登入身分或 API response schema。
- 不改變籌碼資料來源、回補範圍、retry、coverage、TDCC validator 或免費來源限制。
- 不導入新 queue 服務、外部資料庫或前端 optimistic state protocol。

## Decisions

### 1. Foreground 不再執行完整 target reconciliation

`saveInstrument` 完成 `user_instruments` upsert 後，直接排入 background work 並建立 canonical response；不再 `await refreshTdccContinuousTargets`。完整 reconciliation 保留在 durable scheduler、受保護 continuous control plane 與商品目錄 ingest 等原本需要全量集合的流程。

替代方案是只把既有 `refreshTdccContinuousTargets` 整段放進 `waitUntil`。雖可縮短畫面等待，但每次儲存仍會重掃全 catalog 並大量寫入 D1，造成不必要的背景資源與競態，因此不採用。

### 2. 背景工作只 upsert 本次合格 symbol

從 full sync 的單一 target 狀態計算與 upsert 抽出可重用 helper。`scheduleWatchlistChipPrewarm` 在背景先以既有 eligibility 驗證 symbol，再冪等 upsert 該 `user` target，最後執行該 symbol 的日籌碼預熱。helper 不停用或重寫其他 targets，也不掃描官方 catalog。

單一 target helper 與 full reconciliation 共用相同 coverage、既有 blocked／running 狀態、completed weeks 與 timestamp 語意，避免兩條路徑產生不同狀態機。未提供 catalog revision 時保留既有非空 revision，不以空字串覆蓋。

### 3. D1 schema 初始化在同一 binding 生命週期只執行一次

以 `WeakMap<object, Promise<void>>` 快取 `ensureDb` 的 schema batch 與 localized seed promise；同一 Worker isolate／D1 binding 的並行與後續 request 共用同一初始化工作，失敗時移除 cache 以允許下一次重試。這不取代版本化 migration，也不改變 schema，只避免 `instrumentPayload` 的平行讀取重複執行整批 `CREATE ... IF NOT EXISTS`。

### 4. 保留完整 response，先降低伺服器工作量

API 仍回傳 `instrumentPayload`，前端仍以 canonical payload 更新所有清單與圖表選項。這可避免新增 optimistic merge、失敗 rollback 與 system／personal tab scope 回歸；若正式站量測仍不符目標，再另立 change 評估 compact response。

### 5. 驗收以結構性 contract 為主、elapsed time 為正式站證據

自動化測試 MUST 證明 foreground save 路徑不呼叫 full reconciliation、`waitUntil` 包含單一 target upsert 與 prewarm、相同 symbol 重跑冪等且不改寫其他 targets、schema initialization 可共用。正式站使用既有商品做內容不變的儲存，量測從按下按鈕到「商品已儲存」的 elapsed time，並在 response 後確認商品仍存在及 target／prewarm 可由背景或 scheduler 接手。

## Risks / Trade-offs

- [background lifetime 在 target upsert 前中斷] → `user_instruments` 已是 durable source of truth；下一次 scheduler full discovery 仍會建立 target。
- [同一 symbol 同時由儲存與 scheduler upsert] → 使用相同 primary key、冪等 SQL 與既有狀態保留規則。
- [停用商品不再於儲存 request 即時 full reconcile] → 不建立新的預熱；durable scheduler 在下一週期依所有有效清單重建並停用孤兒 target。
- [冷 isolate 仍需 schema ready 與 canonical payload 查詢] → 本 change 保留正確性優先；以快取初始化降低 warm request 成本並記錄正式站量測。
- [將 request 傳入 background 使用] → background 只讀 URL／identity headers 與 D1 binding，不再讀已消耗的 request body。

## Migration Plan

1. 部署不含 schema migration 的 Worker 變更與測試。
2. 以既有清單商品做冪等儲存，確認 foreground response、使用者隔離與 canonical payload。
3. 檢查 background target／prewarm 狀態及下一 scheduler 可接手；保留既有 full sync control-plane 路徑。
4. 若發生回歸，可回滾至前一 Sites version；D1 schema 與已保存資料不需回復。

## Open Questions

- 無；若 canonical payload 的剩餘讀取時間仍過長，另立 change 設計 compact response 與前端 optimistic merge。
