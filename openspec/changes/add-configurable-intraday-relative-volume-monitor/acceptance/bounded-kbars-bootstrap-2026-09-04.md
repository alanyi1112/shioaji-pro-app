# 一次性 Kbars bootstrap 實作與驗收

## 文件資訊

- Change：`add-configurable-intraday-relative-volume-monitor`
- 對應任務：4.5、4.6
- 驗收日期：2026-09-04（Asia/Taipei）
- 模式：feature-off、simulation-only
- 上游依據：Gate 0 任務 1.3、1.4 的欄位 mapping 與 200 檔容量量測
- 安全邊界：沒有啟用 production、subscription、週期 Kbars polling、第二個 login、通知或 broker write

## 完成內容

### 上一交易日 baseline

`bounded-kbars-bootstrap.mjs` 實作一次性、有界 queue。每個已啟用商品只發出一個 Kbars request，日期範圍同時涵蓋上一交易日與當日；政策固定限制：

```text
max configured contracts    200
request start spacing       >= 260 ms
per-request hard timeout    <= 8,000 ms
total hard deadline         <= 75,000 ms
periodic polling            false
simulation                  true
endpoint                    loopback HTTP only
```

provider preflight 與 Kbars fetch／response body 都接受 `AbortSignal`，並另由 `Promise.race` 硬逾時收斂；provider 即使忽略 abort 也不能讓單次工作無界等待。非 simulation、來源版本不符、非 loopback endpoint、超過 200 檔或要求週期 polling 時一律拒絕。

baseline 與 bootstrap manifest 保存：交易日、時區、requested／actual minute range、expected／actual minute count、原始與 canonical 單位、來源版本、coverage receipt、完整度、原因、取得時間與 SHA-256 hash。SQLite evidence repository schema 由 v1 單調 migration 至 v2；資料以 revision 保護，清理時也納入 manifest。

### 晚開頁的當日 bootstrap

provider 明確宣告具 coverage receipt，且可信 coverage verifier 也證實完整 requested range 時，系統才會：

1. 建立自 09:01 至最新 completed-minute watermark 的 cumulative series；
2. 將無成交分鐘明示為 `carry_forward` 或 `known_zero`；
3. 保存來源為 `shioaji-kbars-bootstrap` 的 historical observations；
4. 使用既有精確量比 evaluator 重播；
5. 只建立 immutable `historical` trigger，不取得通知權限。

目前 Shioaji 本機 Kbars endpoint 沒有 coverage receipt／watermark，因此正式 local provider 固定宣告 `coverageReceiptAvailable=false`。在沒有額外可信完整度證據時，即使 HTTP 200 且 response 結構合法，也只保存實際 rows 與 `coverage_unverified`：

- baseline 維持 `incomplete`／`waiting_baseline`；
- 今日 `monitoringEffectiveFrom` 保存 activation minute；
- `earlierMinutesBackfilled=false`；
- 不把缺分鐘補 0、不建立 historical observation 或 trigger；
- 不推論開頁前是否曾達標。

## Evidence 冪等與衝突規則

- payload hash 只涵蓋實質證據，排除 `fetchedAt`，因此同一資料於不同時間重跑不會產生新 revision。
- bootstrap observations 重跑時可忽略單純接收時間差異，但 contract、日期、分鐘、來源、版本、累積量或連續性不同仍會衝突。
- incomplete baseline 只可在未被 trigger 引用、既有重疊分鐘完全一致時，單調升級為更多 rows 或 `complete`。
- 已被 trigger 引用或重疊值改變時拒絕覆寫，避免歷史事件失去引用證據。

## 自動化驗證

針對性測試：

```sh
pnpm exec vitest run \
  src/lib/intraday-relative-volume-monitor-domain.test.ts \
  scripts/intraday-monitor-runtime/evidence-repository.test.mjs \
  scripts/intraday-monitor-runtime/bounded-kbars-bootstrap.test.mjs
```

結果：3 個測試檔、26 項測試全數通過。涵蓋 schema invariant、repository v1→v2 migration、完整度單調升級、batch revision、260ms start-to-start 節流、每檔一次兩日 request、fetch／preflight hard timeout、simulation／loopback／200 檔上限拒絕、無 coverage receipt fail-closed、完整來源 historical replay、無通知權限及跨 `fetchedAt` 重跑冪等。

全專案測試：

```text
Test Files  190 passed (190)
Tests       2213 passed (2213)
```

建置：`pnpm build` 成功完成 TypeScript project build 與 Vite production build；僅保留既有 large chunk warning，沒有新增 build error。

## 結論與剩餘邊界

任務 4.5、4.6 的 fail-closed 實作與 deterministic acceptance 已完成。因 Gate 0 的 subscription ownership／transport authority 仍為 NO-GO，bootstrap runner 目前不接到 feature-on activation path，也不會因開啟頁面自行抓取或訂閱；這是預期安全狀態，不代表盤中監控已可啟用。後續須先取得可信 coverage verifier 或其他具完整度 receipt 的來源，並完成 Gate 0 其餘阻擋條件，才可進入 20 檔 simulation shadow 階段。
