# 開盤前 Evidence 與安全工具包

## 文件資訊

- Change：`add-configurable-intraday-relative-volume-monitor`
- 日期：2026-09-04（Asia/Taipei）
- 適用範圍：Gate 0 與任務 8.2–8.10 的休市前置準備
- 當期進度：52／60
- 安全狀態：Gate 0 NO-GO、feature-off、simulation-only、通知關閉

## 已完成項目

### 資源預算成為不可竄改的 Stage Plan 契約

Stage Plan 現在必須明確保存人工核定的 CPU basis points、RSS bytes、單日 DB growth bytes、SSE latency ms 與 K 線 freshness ms 上限。這些欄位與 cohort receipt manifest hash 一起納入 plan SHA-256；沒有預算、值不合法或 hash 不一致時不能建立正式 plan。

Evidence validator 除了回報觀測最大值，也會在任一資源超標時加入 reason code 並維持 `readyForHumanReview=false`。DB growth 定義為每個交易日 session 中 `max(databaseBytes) - min(databaseBytes)`，避免把既有 DB 基線大小誤當成本次成長量。

### 正式 Cohort Contract Receipts

`pilot-cohort-receipts.mjs` 與 `prepare-pilot-cohort-receipts.mjs` 接收固定候選名單及已保存的本機 contract export，逐檔核對 STK、TW、TSE／OTC、code 與 canonical `.TW`／`.TWO` 對應。缺少、重複、來源不是 loopback 或 receipt 被竄改時整批拒絕。

工具不會自行存取 contract endpoint；manifest 明示 provider request、subscription transport、service lifecycle 與 broker write authority 全部為 false。正式 Stage Plan 必須綁定同一 manifest hash 及完全相同的 cohort 順序。

### 唯讀 Premarket Preflight

`premarket-readiness.mjs` 與 `verify-premarket-readiness.mjs` 只讀取：

- 已驗證的 Stage Plan；
- 同一份 Cohort Receipt Manifest；
- 既有受控流程保存的 runtime snapshot；
- evidence 目錄的存在、讀寫權限與可用磁碟空間。

preflight 不發出 HTTP 或其他網路請求、不呼叫 provider、不新增或移除 subscription、不啟停服務、不送 broker write。只有 simulation、loopback、production false、feature-off、通知關閉、Gate 0 GO 且當期、ownership 完整、容量足夠、calendar ready、設定 revision 存在、所有 authority false、cohort hash 一致且磁碟足夠時，才輸出 `readyForControlledPilot=true`。

### Acceptance Dossier

`acceptance-dossier.mjs`、`acceptance-dossier-builder.mjs`、`build-acceptance-dossier.mjs` 與 `verify-acceptance-dossier.mjs` 建立 8.9／8.10 的機器可驗證收件契約。dossier 只記錄本 change 核准範圍內的 Gate 0 與固定 20 檔 plan、bundle、review、實際核定 active 數及 reviewer sign-off，並收齊 data quality、resources、UI、accessibility、rollback 與 tests 六類 evidence；50 檔以上另開 change。

每個 evidence reference 都必須是 change 目錄內的正規相對路徑；builder 會從實際檔案自動計算 SHA-256。最終 active 上限不得高於 20 檔實證核定值；未解風險與最終決策都必須人工簽核。canonical dossier hash、任何檔案 hash、簽核或類別缺失時，`readyForArchive=false`。

## 明確未執行

- 未對 simulation API 發出 subscribe／unsubscribe。
- 未取得 provider request 或 subscription transport authority。
- 未重啟 simulation API、MultiView、5173、5174、watchdog 或行情連線。
- 未啟用 production、第二個 login、通知或真實下單。
- 未建立或宣稱正式 20 檔 cohort；實際名單仍須由使用者選定，並以當期本機 contract export 產生 receipts。
- 未完成兩個完整交易日的 shadow evidence，任務 1.2、8.2–8.6、8.9、8.10 保持未勾選。

## 離線驗證結果

```text
Targeted test files: 4 passed
Targeted tests: 13 passed
Project test files: 194 passed
Project tests: 2226 passed
Cohort receipts CLI: passed with synthetic fixture
Stage Plan CLI: passed with synthetic fixture
Premarket preflight: valid inputs, correctly refused NO-GO fixture
Pending dossier: structural and referenced file hashes valid, readyForArchive=false
```

所有 synthetic fixture 都在檔名與內容中標示非正式證據；NO-GO exit code 1 是預期安全結果，不是工具失敗。

## 開盤日接續邊界

正式接續順序固定為：選定 cohort → 保存本機 contract export → 建立 receipts → 人工核定資源預算 → 建立 Stage Plan → 由既有流程保存 runtime snapshot → 唯讀 preflight。只有 Gate 0 reviewer 已另行改判 GO 且 preflight 通過，才可在新的明確 simulation subscription 授權下啟動 20 檔受控試辦。
