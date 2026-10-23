# Simulation API 啟動錯誤日誌候選驗證

2026-10-23，Asia/Taipei。本輪依使用者授權只修改程式並離線驗證，不安裝、重啟、登入、增加下載或修改兩站／自然驗收 observer。

## 修改結果

- 單檔 wrapper 提供 JSONL `/2`：attemptId、childPid、sequence、elapsedMs、允許清單 reason／code／HTTP status／觀測 stage 與固定摘要。所有原文、stack、URL、帳號／憑證／token、任意 argv／環境及未知字串均不保存，rawMessageSaved 固定 false。
- 輸入先排除敏感欄位與容器。一般 login failed 只記初始化失敗，HTTP 403／5xx 不推定憑證錯誤或遠端身分；所有診斷屬 pattern_match，不冒稱已確認根因或行情 ready。
- 程序 close 且 stdout／stderr 排空後保存退出，補存未換行尾段、spawn_error 與安全 code。最後未知錯誤與較早可識別錯誤分列，不用較早錯誤取代最後訊息；sequence 是 wrapper 觀測順序，不宣稱兩個 pipe 的原始因果順序。
- 分析上限每行前 16 KiB，完整行仍串流計算 hash／bytes；超限明列 analysisTruncated。雙 pipe 透過 await 寫入背壓，沒有無界 pendingWrites 佇列。保留 0700／0600、5 MiB／五份輪替，拒絕 log symlink，寫入失敗只輸出固定訊息與安全 code。

## 已執行驗證

使用既有 Node 24.19.0 與已安裝依賴，未安裝／下載套件。

```sh
/opt/homebrew/Cellar/node@24/24.19.0/bin/node node_modules/vitest/vitest.mjs run scripts/intraday-monitor-runtime/service-log-wrapper.test.mjs scripts/realtimestock-watchdog.test.mjs
/opt/homebrew/Cellar/node@24/24.19.0/bin/node --check scripts/intraday-monitor-runtime/service-log-wrapper.mjs
OPENSPEC_TELEMETRY=0 openspec validate improve-simulation-api-startup-diagnostics --strict
git diff --check
```

- 最終 16:25:31 執行：兩個測試檔 **59／59** 通過（日誌 52、watchdog 7），含已知錯誤判讀、JSON 原因鏈、敏感容器及無標籤秘密不外洩、跨 chunk／UTF-8、無換行尾段、雙 pipe 快速退出、ENOENT／EACCES、signal、超長行、私密權限／輪替、失敗固定輸出、不同 attemptId，以及 repo 外單檔副本與最小環境的 CLI 整合。
- syntax check、此 change 的 OpenSpec strict 與整個工作樹 diff check 通過。未以此宣稱其他 mixed dirty 功能完成，也未重跑整套前端／build，因本輪僅修改 Node wrapper、測試及說明。
- 原始失敗保留：首輪 43／45，抓到 spawn 負值退出碼被轉為 254 的程式錯誤與 symlink fixture 讀取方式錯誤；修正後 46／46。後續單檔複製測試為 58／59，抓到 macOS `/var`／`/private/var` 別名使直接執行 guard 未啟動；改為 realpath 比對後 59／59。沒有修改測試期待來隱藏上述程式錯誤。

## 正式環境未換版

16:25:10 唯讀比對本輪前後共 24 份 App Support runtime／已安裝 wrapper、RealTimeStock LaunchAgent plist 與 Codex observer TOML，SHA 全部相同，沒有新增／刪除設定。listener 仍為 Shioaji PID12404／8080、Web PID958／5173、MultiView PID964／5174，與本輪前相同；沒有為檢查發出新 health／info／Snapshot 請求。

- 已安裝 wrapper SHA 仍為 `b27bd76407487a497abf2701e3ae42bfec5da2e448f68f1c11db4c3b84d0eeb5`；候選只留 repo，正式服務仍使用舊版。
- 未改 API／watchdog／gateway／正式 bundle／mode／DB／名單／日曆／排程，未操作兩站或自然驗收追蹤。DB／WAL 與自然載入 latest.json 的唯讀 metadata 核對亦未見本輪測試時間的新寫入。
- HEAD 保持 `4f33a61`，staged 0；未 commit／push／歸檔／部署，也未更動其他 mixed dirty 工作。

## 限制

未製造真實 API 啟動失敗、未做正式換版驗收。舊 log 無法還原原始錯誤；新 SDK 未識別的錯誤仍明列 unknown。後續正式安裝與服務換版需另獲授權，不能由本次程式驗證推定已生效。

## 最新追加：已授權單檔安裝（2026-10-23 16:30:39）

使用者後續明確要求：「請將新版日誌 wrapper 正式安裝到 App Support，保留舊版備份並核對 hash；不要重啟服務、登入或增加下載，讓新版於下次自然啟動時生效，不影響兩站與自然驗收追蹤。完成後回報，先不 commit／push。」本段為最新安裝狀態；前述未安裝敘述保留為程式驗證階段歷史，不代表現在仍未複製檔案。

### 備份與 hash

- 正式檔案：`/Users/alanyi/Library/Application Support/RealTimeStock/bin/service-log-wrapper.mjs`，14970 bytes、目前使用者擁有、0600、非 symlink。
- 新版 repo 與安裝後讀回 SHA-256 均為 `7d124d71f90be70641fa0826f6d08954aa0c579f692ac39ae81bc898abb57e66`。
- 舊版安裝前與備份讀回 SHA-256 均為 `b27bd76407487a497abf2701e3ae42bfec5da2e448f68f1c11db4c3b84d0eeb5`。
- 私密備份目錄：`/Users/alanyi/Library/Application Support/RealTimeStock/service-log-wrapper-backups/20261023T083039Z-fc9fd76a/`（0700）；`service-log-wrapper.previous.mjs`（0600）完整保留舊版，`prepared.json`／`installed.json`（0600）保存準備與安裝收據。
- 先驗 source／destination 身分、權限及 hash，備份 fsync 後再次驗 hash；同 bin 目錄以 0600 臨時檔準備候選，核對 source／destination 未漂移後 `os.replace` 原子替換並 fsync，最後獨立讀回安裝檔與備份內容及權限。沒有執行整套 runtime installer。

### 安裝後唯讀核對（16:31:17）

- 以 LaunchAgent 真正使用的 Node 26.0.0 對已安裝檔案執行 `--check`，exit 0；只作 syntax check，不執行 wrapper／子程序。先前 59／59 為 Node 24.19.0 的離線功能證據，本次來源 hash 未變，沒有重跑測試或製造真實失敗。
- 除本次明確授權安裝的 wrapper 外，其餘 23 份正式 runtime／RealTimeStock plist／Codex observer TOML 前後 hash 全相同，沒有新增或刪除設定。兩站與自然驗收追蹤未操作。
- simulation wrapper PID12403、runs94 維持相同；Shioaji PID12404／8080、Web PID958／5173、MultiView PID964／5174 均與安裝前相同。watchdog 原 30 秒週期保持、上次 exit0；沒有手動執行 watchdog。
- 現有日誌末筆仍為 `realtimestock-redacted-service-log/1`，符合舊程序已載入舊版；只證安裝完成，**不冒稱新版已在現有程序生效**。下次自然啟動才由既有 plist 路徑載入 `/2`；不新增排程或立即探測。
- 未發 health／info／Snapshot／login／broker／站台請求，未增加下載、重啟或 signal 現有服務。HEAD=`4f33a61`、staged0，未 commit／push／歸檔／部署。

## 最新追加：自然載入證據整理與結案判定（2026-10-23 17:28 Asia/Taipei）

本次依使用者「先整理新版日誌自然載入的驗收證據，確認是否可結案；不要重啟服務或新增請求，先不 commit／push」辦理。前述未載入敘述保留為安裝當時歷史；目前已核對既有 launchd 安裝後的新世代及同一 API attempt 的 JSONL `/2`。

- 完整判定、Gate、原件定位及限制見 [`acceptance/natural-load-2026-10-23.md`](acceptance/natural-load-2026-10-23.md)；允許欄位機器證據見同目錄JSON，SHA=`c985a1b902ffd485058b758f23ae52d77a5b737e979c339696ceed470e979ba0`。
- 安裝hash／備份／權限、launchd wrapper PID956、API PID1200／PPID956與8080 listener、精確plist／完整命令綁定均一致。16:56:04的`wrapper_start`、`process_start`與實際stdout／stderr使用同一attemptId，1,803筆sequence連續、rawMessageSaved=false，29份正式檔案／observer設定前後SHA未變。
- **新版正式載入驗收通過，本change可結案、待另次歸檔。** 原8項加本輪2項證據整理任務為10／10；尚未archive、同步主spec、commit／push或部署，不把OpenSpec的all_done本身當作live證據。
- 180筆HTTP400及2筆unknown原樣保留；不推定根因。目前程序未退出，沒有真實process_exit／spawn失敗驗收；先前59／59離線證據保留，本輪未重跑。既有watchdog healthy只作被動旁證，不擴張至完整行情或其他change。
- 沒有重啟、signal、登入、請求、下載或調整正式服務／observer；只寫本案repo文件與操作說明。沒有獨立外部操作稽核，因此精確結論為「觀察到既有launchd新世代載入，本次未重啟」，不宣稱已排除所有外部操作。

### 本次文件與證據檢查

- `OPENSPEC_TELEMETRY=0 openspec validate improve-simulation-api-startup-diagnostics --strict`：valid。
- `OPENSPEC_TELEMETRY=0 openspec instructions apply --change improve-simulation-api-startup-diagnostics --json`：10／10、remaining0、all_done。
- 獨立JSON讀回核SHA、同attempt樣本、筆數／sequence與退出限制，並重讀29份正式檔案指紋、HEAD及staging：全部通過；JSON SHA未變。不是重跑wrapper或程式測試。
- 全工作樹`git diff --check`通過；本輪只修改本change的proposal／design／tasks／verification、增加兩份acceptance文件並更新`docs/local-runtime-macos.md`，其他mixed dirty work保留。既有observer保持原樣，未以結案判定代替歸檔授權。
