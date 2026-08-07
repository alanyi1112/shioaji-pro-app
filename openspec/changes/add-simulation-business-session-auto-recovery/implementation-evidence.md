# 實作與驗收紀錄

## 實作範圍

- 新增 simulation-only business-session watchdog 與 repo 外 allowlist state。
- 5173 新增 document-scoped 2330 Snapshot monitor，並將自動與手動 watchlist recovery 合併為 single-flight。
- 5174 新增 page-scoped demand reconciliation、per-symbol bounded retry 與去識別化 recovery metrics。
- 未新增 production、CA、帳戶或交易 API 路徑。

## Runtime 寫入前基準

- `runtime_mode=simulation`
- 8080／5173／5174 PID：`71133`／`52706`／`71191`
- watchdog job：`stopped`
- D1：schema `0021`、`integrity=ok`、`schema_coverage=ok`
- 盤後 market／chip／tdcc／pe：全部 `completed`
- 個人狀態：37 rows，material hash `1a2d01df6c9b88db69cac2bf0842adefcaaddbe900ec7b364ca485d4a7da8259`

## 安裝與受控 simulation 驗收

`pnpm local-runtime install` 成功後：

- simulation、watchdog、5173、5174 與兩個盤後 pipeline job 均 loaded。
- production-readonly job stopped。
- watchdog `healthy`、failure 0、restart 0、last reason `available`。
- API `simulation=true`、health `healthy`、2330 business Snapshot `available`。
- D1 integrity／coverage 均 `ok`，盤後四群組均 `completed`。

受控執行只針對 simulation API job 的 `launchctl kickstart -k`：

- 8080 由 PID `76045` 換成 `76355`，2 秒內恢復 business Snapshot。
- 5173 維持 PID `76048`，既有頁面最後為 `LIVE`，`OFFLINE` 不可見，自選清單仍已載入。
- 5174 dev server 在 upstream 斷線時自行退出一次，由其既有 KeepAlive 於 1 秒內以 PID `76359` 恢復；watchdog action 與程式碼均未操作 5174 job。
- 原 MultiView 頁面恢復為單一 SSE、8 個 active demand；`subscribeCount` 由 8 增為 16，證明頁面自行補回全部 demand。
- 隔離 fixture 已驗證連續三次 `SessionNotEstablished`、90 秒 grace、2／5 分鐘退避、三次上限、circuit-open、5173 自動 watchlist backoff 及 MultiView 首次失敗後成功／持續失敗無 request storm。

驗收後 D1 仍為 schema `0021`、integrity／coverage `ok`；個人狀態仍為 37 rows 且 material hash 完全相同。安裝 migration 依既有流程新增一份備份，資料內容未變。兩個盤後 pipeline job仍 loaded，production-readonly job仍 stopped；驗收未操作任何下單控制或交易 API。

## 自動驗證

- RealTimeStock：25 files、162 tests passed；`tsc -b` 與 Vite production build passed。
- MultiView：472 tests passed；vinext build、ESLint、TypeScript no-emit 與 governance passed。
- OpenSpec：14 items strict validation passed。
- `pnpm audit`：No known vulnerabilities found。
- `git diff --check`、changed-file secret scan、watchdog plist/state allowlist scan passed。
- watchdog plist／state directory／state 權限分別為 `0600`／`0700`／`0600`；stdout/stderr 固定為 `/dev/null`。
