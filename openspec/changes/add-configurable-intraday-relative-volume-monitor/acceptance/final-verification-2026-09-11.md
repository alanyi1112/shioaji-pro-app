# 2026-09-11 歸檔候選最終驗證

## 範圍

本紀錄只驗證 OpenSpec change `add-configurable-intraday-relative-volume-monitor` 的本機 simulation 固定 20 檔歸檔候選。沒有啟用 production、沒有 broker write、沒有服務生命週期變更，也沒有執行 archive、commit 或 push。

## 三件式盤中 evidence

- `kbar-shadow-2026-09-11.json`：validator 通過；20／20 檔、每檔 270 個 completed minute、`fullSession=true`、`baselineEligible=true`。
- `passive-chart-freshness-2026-09-11.json`：builder／每日守門器通過；同頁唯讀觀測的 visual commit 推進且 canvas 可見。
- `pilot-runtime-assurance-2026-09-11.json`：builder／每日守門器通過；`previousTradeDate=2026-09-10`，GET-only reconnect 與既有功能狀態均符合要求。
- 每日守門器：`status=complete`、`readyForDailyBundle=true`、`reasons=[]`、`warnings=[]`。

## 功能 bundle

- 可信 baseline：`kbar-shadow-2026-09-10.json`，`live_full_session_verified`。
- 完整盤中日：2026-09-11。
- Calendar source version：`twse-115-tpex-11400754581`；9/10 與 9/11 為官方日曆中的緊接交易日。
- Bundle：`pilot-evidence-bundle-2026-09-10_2026-09-11.json`。
- Bundle hash：`89c613c49b66e156d78f24a8807a6ab2c3acf0bd2c370a0e75113c9fcb265f9c`。
- `verify-pilot-evidence.mjs`：`valid=true`、`readyForHumanReview=true`、`triggerCount=8`、provider physical usage／headroom 均為 `null`。

## 最終指令結果

| 指令 | 結果 |
| --- | --- |
| `pnpm test` | 通過：218 files／2,369 tests |
| `pnpm test:browser` | 通過：11 files／111 tests |
| `pnpm build` | 通過；僅 chunk size warning |
| `openspec validate add-configurable-intraday-relative-volume-monitor --strict` | 通過 |
| `git diff --check` | 通過 |

最終採信測試 logs 建立於 repo 外的 `/tmp/realtimestock-final-20260911-*.log`，不納入 dossier immutable references。另一次與採信 run 重疊執行的非採信全套測試曾在 smart-order repository watchdog timing case 單次失敗；採信 run 的相同版本已完整通過，故列為非阻擋測試排程風險，不隱藏該觀察。

## 結論

實作、三件式盤中 evidence、跨日量比重播、代理人工審閱與最終驗證已具備進入歸檔候選的條件。歸檔、commit、push 仍需分開授權。
