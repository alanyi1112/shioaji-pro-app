## Context

現有 wrapper 使用單檔安裝至 App Support，stdin 不轉送，stdout／stderr 轉成 JSONL。原文只留 hash，且未換行尾訊息可能遺失；child exit 早於 pipe 排空，spawn error 亦缺錯誤碼。正式副本與 repo 分離，初始階段只修改 repo；後續明確授權的檔案安裝另列，不視為服務載入驗收。

## Goals / Non-Goals

**Goals:** 保留固定允許清單的診斷、每次啟動關聯與完整退出時序；所有非固定欄位維持省略；離線證明敏感資料不會進入 log、console 或輪替檔。

**Non-Goals:** 不修復 SDK、不還原過去 hash、不判定行情 ready、不新增探測／登入／下載、不重啟正式服務、不調整 watchdog／launchd 重試政策。檔案安裝僅依後續明確授權執行。

## Decisions

- 保持單檔 wrapper，純函式可 import、CLI 由直接執行 guard 啟動。無新套件或安裝相依。
- 不保存「遮罩後自由文字」。輸入先排除 URL、敏感 key/value、引號值及 PEM，再以固定規則投影 reason／code／HTTP status／stage 與固定摘要；未知一律 unknown。這避免未列出的秘密格式漏出，也保留 DNS、連線、TLS、認證、port、檔案權限及 runtime preflight 的可區分證據。投影屬 pattern match，不冒稱經過獨立根因驗證。
- JSONL schema 升為 `/2`，保留既有 event／hash／bytes／rawMessageSaved=false；加入 attemptId、childPid、elapsedMs、最後診斷與各自 sequence。lastDiagnostic 保留最後未知訊息，lastKnownDiagnostic 另列最後符合規則的訊息；stage 是訊息觀測階段，無獨立 ready 訊號，不能作 business availability 證明。通用 login failed 不推定憑證錯誤，HTTP 403／5xx 不推定認證根因或端點身分。
- 以 stdout／stderr 個別非同步讀取及序列寫入形成背壓，逐行只保留有界分析前綴、完整串流 hash 與原始 byte 計數。超長行標 truncated，不能推論未分析尾段。退出時等待 pipes close，保存無換行尾段；spawn 失敗保存允許清單 code，不回顯 path／argv／env／原始 error.message。
- 既有 5 MiB 與五份輪替保持，私密目錄 0700／檔案 0600。寫入失敗輸出固定錯誤與安全 code，不回顯 OS 原文，也不因 logger 失敗自動重啟或主動殺掉服務。

## Risks / Trade-offs

- 未知 SDK 訊息無法判讀 → 明列 unknown、hash、bytes 與退出結果，後續僅擴充經測試的固定規則；不聲稱萬用還原原文。
- 訊息中包含看似錯誤碼的秘密值 → 先排除敏感欄位／容器，再抽取允許清單；測試跨 chunk、多行與無標籤秘密，輸出永不取用自由文字。
- 初始程式階段未正式換版 → 當時僅回報 repo 候選完成；後續單檔安裝及自然載入分別保存證據，不把離線測試冒充 live failure 驗收。

## Migration Plan

初始程式階段不遷移既有 log、不複製 App Support。後續使用者已明確授權單檔安裝：先備份並驗證原檔 hash，於同目錄準備 0600 暫存檔、核對候選及原檔未漂移後原子替換，再讀回 hash 與權限；不執行會重啟服務的整套 installer。舊版與準備／完成收據保存在 0700 私密目錄，現有程序不動，新版留待下次自然啟動。單檔自足，不需更改 plist 或下載。舊 `/1` 與新 `/2` 必須按各自欄位解讀，不能由歷史 hash 補造過去原因。

2026-10-23 後續唯讀驗收已關聯安裝後的 launchd 新世代、API 父子鏈與同一 attemptId 的 `/2` 真實輸出，詳見 `acceptance/natural-load-2026-10-23.md`。這證明新版正式載入；本次沒有造成重啟，亦沒有獨立證明外部操作不存在。真實啟動失敗、process_exit／spawn error 及完整行情可用性不因載入通過而自動完成。
