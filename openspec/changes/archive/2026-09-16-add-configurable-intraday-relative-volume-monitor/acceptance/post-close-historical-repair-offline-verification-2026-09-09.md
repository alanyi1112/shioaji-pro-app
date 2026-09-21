# 2026-09-09 收盤後歷史 KBar Repair 與 Capture 工具離線驗證

## 結論

收盤後驗證式歷史 1 分 K repair worker、immutable interruption／manifest repository、capture evidence 容量修正、原子 outcome writer、failure sidecar 與 one-shot LaunchAgent 產生器已完成純離線驗證。測試沒有連接 8080、SSE、Shioaji 行情 API，也沒有占用或重啟 5173／5174；production、broker write、通知、retroactive trigger 與既有服務生命週期 mutation 均為 0。

2026-09-09 只保留為 tooling failure：沒有主 capture evidence，所以本次沒有也不得對當日建立 `historical_repaired_verified` manifest。

## 逐商品驗證結果

fixture worker 以兩檔獨立 interruption 執行：

| 商品 | 第一次歷史抓取 | 同來源重抓 | 結果 | baselineUsable | liveCaptureAcceptance |
| --- | --- | --- | --- | --- | --- |
| `2330.TW` | 完整 270 分鐘、重疊一致、總量一致 | payload hash 穩定 | manifest 寫入 revision 1 | true | false |
| `2454.TW` | 完整 270 分鐘 | 第 2 次 payload 變動 | `refetch_payload_unstable`，拒絕寫入 | false | false |

測試另證明第一檔 provider 失敗後仍繼續處理下一檔；部分成功時 `allSucceeded=false`，不會把整批宣稱為成功。13:34:30 前無法核發 post-close authority，instrument、final-volume 與歷史 KBar providers 的呼叫數皆為 0。

每筆 interruption 必須先以 immutable `interruptionId` 寫入 repository；相同 symbol／trade date／stream generation／sequence window 若出現不同 payload，會以 `interruption_evidence_conflict` 拒絕。worker 收到未持久化的臨時 interruption 時回 `interruption_evidence_not_persisted`，且三類 provider 呼叫數仍為 0。

## Capture 最終化修正

- KBar session evidence canonical hash 上限：4 MiB。
- 主／sidecar JSON output 上限：16 MiB。
- 20 檔 × 270 個 completed minute 的完整 fixture 大於通用 1 MiB，但低於專用上限，可產生穩定 SHA-256。
- 成功檔以同目錄 temporary file、`fsync`、atomic hard link exclusive create 寫入；既有檔回 `EEXIST` 且內容不變。
- 最終化失敗只建立 `<output>.failure.json`；主檔保持不存在，sidecar 不可覆寫且固定拒絕 baseline、live acceptance、通知及 retroactive trigger。
- 未來背景 capture 使用 `launch-bounded-kbar-shadow-once.mjs` 產生 `RunAtLoad=true`、`KeepAlive=false` LaunchAgent，不再使用 inferred keepalive。

## 驗證命令與結果

```text
pnpm exec vitest run scripts/intraday-monitor-runtime/historical-kbar-repair.test.mjs scripts/intraday-monitor-runtime/post-close-historical-kbar-repair-worker.test.mjs
2 files passed, 26 tests passed（含 repository v1 → v2 migration）

pnpm exec vitest run scripts/intraday-monitor-runtime/kbar-capture-outcome-writer.test.mjs scripts/intraday-monitor-runtime/kbar-shadow-session-recorder.test.mjs openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/capture-bounded-kbar-shadow.test.mjs
3 files passed, 8 tests passed

pnpm exec vitest run openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/launch-bounded-kbar-shadow-once.test.mjs scripts/intraday-monitor-runtime/post-close-historical-kbar-repair-worker.test.mjs scripts/intraday-monitor-runtime/kbar-capture-outcome-writer.test.mjs
3 files passed, 8 tests passed

pnpm test
213 files passed, 2,329 tests passed

pnpm build
passed

openspec validate add-configurable-intraday-relative-volume-monitor --strict
valid

git diff --check
passed
```

另以完整 20 × 270 capture 驗證 validator 可在超過通用 1 MiB 時重算相同 evidence hash，並以兩個完整 20 × 270 fixture 組裝 deterministic replay bundle；20 檔第二日 trigger count 可重算為 20。對本輪新增／修改但尚未追蹤的 change 檔案執行 trailing-whitespace 掃描，沒有命中。

## Dossier 預組裝狀態

已將 2026-09-08、2026-09-09 失敗證據、收盤後回補離線驗證與最終組裝清單納入 pending manifest，並建立 `acceptance-dossier.prepared-2026-09-09-v2.json`。目前 dossier schema 與 16 個引用檔案 hash 均通過驗證；`readyForArchive=false` 只剩兩個新完整交易日 bundle、20 檔人工審閱、Gate 0／最終 reviewer sign-off、正式 active 上限與未解風險確認，沒有 stale evidence hash。

## 服務未受影響的收尾確認

2026-09-09 16:07（Asia/Taipei）唯讀確認：

| 項目 | 結果 |
| --- | --- |
| simulation API | `127.0.0.1:8080` 正常監聽；version 1.7.1；`simulation=true` |
| stream status | `status=healthy`；`active_connections=6` |
| RealTimeStock | `127.0.0.1:5173` 正常監聽 |
| MultiView | `127.0.0.1:5174` 正常監聽 |
| 2026-09-09 capture label | 不存在 |
| capture process | 不存在 |

## 尚未完成

任務 8.2、8.3、8.9、8.10 仍未完成：必須由下一組至少兩個完整交易日的 20 檔 live capture、第二日 deterministic replay、既有 K 線新鮮度與資源 evidence、人工 reviewer sign-off 及最終 dossier 共同完成。歷史 repair 與離線測試不能取代這些條件。
