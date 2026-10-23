# 新版日誌自然載入驗收與結案判定

觀測時間：2026-10-23 17:28:07～17:28:08，Asia/Taipei。使用者本次授權：整理既有自然載入證據、確認是否可結案；不重啟服務、不新增請求，先不 commit／push。

## 判定

**新版 wrapper 正式載入 Gate 通過，本 change 可結案並進入待歸檔狀態。** 本輪只整理證據與說明，未歸檔、同步主規格、commit 或 push。原程式／離線驗證與安裝任務 8／8 保留，本輪補列兩項證據任務後為 10／10。

目前證明既有 launchd 在安裝後的新 wrapper／API 世代實際輸出 JSONL `/2`；本輪未重啟，也沒有獨立的外部操作稽核可證明沒有其他人操作。16:54:09 的新開機與 16:56 的啟動時間一致，但不將時間關聯擴張成已證明啟動原因。

## 原件與最小證據

- 機器可讀證據：[`natural-load-2026-10-23.json`](natural-load-2026-10-23.json)，SHA-256 `c985a1b902ffd485058b758f23ae52d77a5b737e979c339696ceed470e979ba0`。
- JSON 僅保存型別／允許值已檢查的事件欄位、固定診斷、hash、檔案權限、程序及前後設定指紋；不複製原始日誌、argv、環境、自由文字、summary、URL 或 stack。
- 日誌原件留在 App Support `logs/simulation-api.jsonl` 與 `.1`～`.5`；此次有界讀取共 26,447,774 bytes，低於 32 MiB。各檔讀取當下前綴的 byte 數與 SHA 已保存；原件持續增寫／輪替，行號只對應該次 snapshot，不保證未來檔名內容不變。
- 安裝／備份原件沿用 `service-log-wrapper-backups/20261023T083039Z-fc9fd76a/installed.json` 及舊版檔案；未改寫或還原。

## Gate 核對

| Gate | 真實證據 | 結果 |
| --- | --- | --- |
| 安裝身分 | 16:30:39.617085 安裝；repo／App Support SHA 均為 `7d124d71f90be70641fa0826f6d08954aa0c579f692ac39ae81bc898abb57e66`；安裝收據一致 | 通過 |
| 備份與私密權限 | 舊版／備份 SHA `b27bd76407487a497abf2701e3ae42bfec5da2e448f68f1c11db4c3b84d0eeb5`；installed wrapper／目前 log 0600、bin／logs 0700，皆目前使用者所有且非 symlink | 通過 |
| 安裝後新世代 | 新開機 16:54:09；使用者 launchd job `com.alanyi.realtimestock.simulation-api` running、runs1、PID956／PPID1，16:56:00 開始 | 通過 |
| 真正入口綁定 | `ps -ww` 的完整命令在記憶體內與 plist `ProgramArguments` 空白串接結果逐字相等；同時核對 wrapper／log 精確路徑；不輸出或保存完整 argv | 通過 |
| API 父子鏈與 listener | Shioaji PID1200／PPID956、16:56:04 開始，8080 唯一 listener 為1200，程序 owner 一致 | 通過 |
| 同一次 `/2` 啟動 | attemptId `53637686-55fc-4b4d-9d02-8e2ce1710a58`；wrapper_start 16:56:04.028、sequence0／elapsed10；process_start 16:56:04.045、sequence1／elapsed17／childPid1200 | 通過 |
| 實際雙 pipe 輸出 | 同 attempt 的 stderr sequence2／16:56:04.255 與 stdout sequence3／16:56:04.265，childPid1200；均保留合法 messageHash／bytes，rawMessageSaved=false | 通過 |
| 跨輪替連續性 | 該 attempt 共1,803筆，sequence0～1802連續，at／elapsed單調、所有rawMessageSaved=false；stdout1,800筆、stderr1筆，parseErrors0／partialLines0 | 通過 |
| 正式設定不變 | App Support bin／mode、RealTimeStock plist、全部 observer TOML 共29份獨立檔案，整理前後 SHA 全相同；launchd job PID／runs未變，HEAD／staging未變 | 通過 |

## 保留的錯誤與未實測範圍

- 該 attempt 的診斷含 **180 筆 HTTP 400**（`http_error`／stage unknown）與 **2 筆 unknown**，原件／hash 保留。這證明允許清單分類在真實輸出運作，不能推定錯誤端點、帳務原因、金鑰失效或深層根因；未為此新增 HTTP／Snapshot／登入。
- 目前程序仍在執行，本 attempt **未出現 process_exit**；不把尚未退出誤報為缺陷，也不製造退出取證。spawn error、非零退出、未換行尾段、截斷與敏感值負例依先前 Node24.19 的59／59離線測試；本輪只改文件，沒有重跑測試或 import／執行 wrapper。
- 全部六份既有輪替檔都讀取並保存 snapshot hash；1803筆與連續性只針對本 API attempt，不代表其他歷史世代都完整，也不宣稱真實秘密輸入已全面測試。
- 既有 watchdog state 檔mtime為17:27:51.884，healthy、generation956、armed=true、連續失敗0、restartCount0、lastReason=available。這是被動讀取既有檢查結果，不是本輪新增業務探測，亦不取代完整行情、所有商品訂閱或其他 change 的自然驗收。
- 保留既有 Node26 正式程序，不在本案調整 runtime；先前59／59是Node24.19離線證據，不改稱Node26全套測試通過。

## 取證方式與副作用邊界

僅用檔案read／stat／SHA、`launchctl print`、`ps`、`lsof`、`sysctl`、Git唯讀指令與OpenSpec文件檢查。讀JSONL時固定32MiB總上限，逐行解析；以目前listener PID找process_start，再以UUID聚合同一attempt，核sequence／時間／elapsed與允許欄位後才輸出。原`ps`命令顯示含空白路徑，不以shell分詞推定身分，改用完整字串比對plist；原argv不落檔。

未執行runtime/status/watchdog/collector/maintenance入口，未發HTTP／info／health／Snapshot／SSE／行情／兩站請求，未登入、下載、signal、重啟或調整任何服務、資料、權限與observer。既有程序及排程自然產生的活動不被誤稱為本輪觸發。

原`simulation-api` observer及其他追蹤維持原設定；本輪將證據留給既有observer自行沿原成功條件收尾，不在本次整理中代為刪除或改排程。共用日曆、名單同步與兩站驗收仍各自接續。
