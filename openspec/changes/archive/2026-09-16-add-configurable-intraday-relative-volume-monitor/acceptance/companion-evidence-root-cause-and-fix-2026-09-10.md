# 2026-09-10 companion evidence 漏收：根因與修正

## 結論

2026-09-10 的 bounded KBar capture 已成功原子落檔，既有 validator 回傳 20／20 檔、每檔 270 個 completed minute、`fullSession=true` 與 `baselineEligible=true`。失敗範圍是每日完整驗收 orchestration：同日 `passive-chart-freshness-2026-09-10.json` 與 `pilot-runtime-assurance-2026-09-10.json` 沒有建立。

本日 capture 可依自身完整性供 2026-09-11 作 baseline；但因盤中被動 UI 觀測不能在收盤後誠實重建，本日固定 `readyForDailyBundle=false`，不列入三件式完整盤中驗收日。

## 直接根因

1. 08:45 heartbeat prompt 只要求啟動、監看及收盤驗證 KBar capture，沒有要求在盤中建立被動 K 線 evidence，也沒有要求由它接續建立同日 runtime assurance。
2. `tomorrow-final-assembly-checklist.md` 雖記載 companion evidence 步驟，但只是人工文件；one-shot launcher、recorder 與 heartbeat 都不會讀取或執行該 checklist。
3. 原有 runtime 只有 DOM observation reader 與成品 validator，沒有把兩次 observation、geometry 與 operation ledger 安全組裝成 immutable evidence 的 builder，導致流程依賴人工拼接 JSON。
4. 原有驗證只在兩日 bundle 組裝時要求 capture 與 assurance 數量一致；沒有同日進度守門器，因此 capture 正常時不會提早揭露 companion evidence 已漏收。

## 已完成修正

- `passive-chart-freshness-evidence.mjs` 新增正式 builder：只接受相同交易日、相同商品與週期的兩次唯讀 observation，要求 visual commit 推進、canvas 可見、完整零 mutation operation ledger，並固定 provider physical usage／ownership／release／headroom 為 `null`。
- `build-passive-chart-freshness-evidence.mjs` 將受信任的唯讀 observation input 轉成 canonical evidence，以同目錄 temporary file、fsync 與 exclusive link 原子建立，既有檔案不覆寫。
- `pilot-daily-evidence-status.mjs` 與 `verify-daily-pilot-evidence.mjs` 建立每日三件式守門：10:00 後缺 chart evidence 為 `attention`；13:34:30 後 capture outcome、chart evidence、assurance 任一缺漏／無效／日期不一致即為 `failed`，固定 `readyForDailyBundle=false`。
- 08:45 自動任務改為明確執行 companion evidence 工作：盤中讀取既有頁面兩次、使用 builder 建檔、立刻建立 runtime assurance，並在每次 heartbeat 執行 daily guard。禁止 reload、navigation、click、另開交易頁或額外 subscription。
- 9/10 仍保留為 9/11 的合法 KBar baseline，但不能冒充三件式完整盤中驗收日。

## 後續驗收方向修訂

後續檢討確認「需要兩個完整 live capture 日」是早期驗收策略，不是量比演算法必要條件。現行方向改為「緊接前一交易日可信 baseline＋一個三件式完整盤中日」即可完成跨日功能驗收；第二個完整盤中日改列非阻擋穩定性追蹤。因此 9/11 若能以 9/10 capture 為 `live_full_session_verified` baseline，且自身 capture、被動 K 線 evidence、runtime assurance、跨日量比重播與護欄全部通過，即可進入人工審閱，不必等待下一個交易日。此修訂不改變本文件對 9/10 companion evidence 漏收根因的事實記錄。

## 不變安全邊界

- simulation-only、feature-off、通知關閉。
- 不啟用 production、不下單、不建立第二個 login。
- 不因 evidence 缺件重啟 capture、行情、5173、5174 或重複 subscription。
- 不補造 2026-09-10 的盤中 UI evidence，也不覆寫任何既有成功或失敗 evidence。
- archive、commit 與 push 仍需另行授權。

## 修正後驗證

- 針對性測試：5 files／18 tests 通過，涵蓋 builder、跨日／錯商品／操作 mutation 拒絕、exclusive create、每日缺件提早告警及 bundle 原有約束。
- 完整非 browser 測試：217 files／2,354 tests 通過。
- `pnpm build` 通過。
- `openspec validate add-configurable-intraday-relative-volume-monitor --strict` 通過。
- `git diff --check` 通過。
- 以 2026-09-10 真實檔案執行每日守門器：capture `present=true／valid=true`；chart 與 assurance `present=false`；結果固定為 `status=failed`、`readyForDailyBundle=false`，原因精確為 `passive_chart_evidence_missing`、`runtime_assurance_missing`。
- 修正後再次唯讀確認 runtime：simulation API、business session、business watchdog、5173 與 5174 均可用；production job 停止、smart-order write master 關閉。未因本次修正重啟服務或建立行情 subscription。
