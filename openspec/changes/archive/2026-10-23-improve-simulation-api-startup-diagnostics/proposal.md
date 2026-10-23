## Why

simulation API 重開機後曾連續啟動失敗，但現有 JSONL 只保存訊息 hash，無法分辨失敗原因。需要保留可判讀且不包含帳號、金鑰、token 或回應原文的錯誤證據。

## What Changes

- 以固定允許清單保存錯誤類別、錯誤碼、HTTP 狀態與觀測階段；未知訊息維持省略，不保存自由文字。
- 每次 wrapper 啟動建立獨立關聯 ID，串接子程序、時間、錯誤與退出結果；補存未換行尾訊息及 spawn 失敗。
- 限制逐行緩衝與待寫入量，保留超限／略過計數及私密檔案權限、輪替。
- 增加完全離線的秘密洩漏、錯誤判讀與生命週期測試，說明程式完成與正式換版的差別。

## Capabilities

### New Capabilities

- `simulation-api-startup-diagnostics`: simulation API 的去識別化啟動錯誤與程序關聯紀錄。

### Modified Capabilities

無。

## Impact

程式修改階段只修改 repo 的 service log wrapper、測試與本機操作文件；不新增套件、不操作 broker 或網路。後續使用者已明確授權僅安裝 App Support wrapper 檔案，須保留舊版備份、核對 hash，讓新版於下次自然啟動生效；不啟停服務、不改 LaunchAgent、兩站或自然驗收 observer。commit、push、歸檔與任何服務重啟仍未授權。

2026-10-23 後續使用者授權整理既有自然載入證據並判定能否結案；僅新增 repo 驗收文件並更新說明，不執行被觀測程式、不重啟或新增請求。自然載入 Gate 已通過，真實失敗分支及完整行情驗收的限制另列；歸檔／commit／push 仍分開處理。
