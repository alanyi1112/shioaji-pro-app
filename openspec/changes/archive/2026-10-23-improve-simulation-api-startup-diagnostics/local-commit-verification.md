# 日誌改善獨立本機提交驗證

2026-10-23，Asia/Taipei。使用者另明確授權將日誌程式、測試、主規格及歸檔文件精準整理成一個本機commit；不push、不重啟服務或新增請求，交易日曆與其他未完成變更保留。

## 暫存範圍

- `scripts/intraday-monitor-runtime/service-log-wrapper.mjs`及對應`.test.mjs`：完整日誌改善差異；程式僅依賴Node內建模組，不需其他未提交功能。
- `openspec/specs/simulation-api-startup-diagnostics/spec.md`。
- 本歸檔目錄原有9份文件與證據，加本驗證紀錄1份。
- `docs/local-runtime-macos.md`只暫存「Simulation API 啟動錯誤日誌」新增19行，原「常態排程不依賴 Codex」23行留在未暫存變更。

含本紀錄共14個檔案，不包含交易日曆UI／backend／spec、其他active changes、其他歸檔目錄、runtime或observer設定、環境檔、憑證、outputs及截圖產物。沒有使用`git add .`。

## 候選獨立驗證

基底HEAD為`4f33a618b8d74900a714a218923f3a69ffb5f04a`。先完成13個功能／文件檔案的精準暫存，`git checkout-index`匯出獨立候選；該候選tree為`5bd524986c14d93e50a4a87a584f9606a81f80de`。重用已安裝node_modules，沒有重新安裝套件或複製本機.env。

隔離設定只執行日誌與既有watchdog測試，不載入專案Vite gateway；以Node24.19的NODE_OPTIONS preload阻擋HTTP／HTTPS／fetch及socket連線，測試內容只操作暫存目錄與自有fixture子程序。單檔整合案例依其原最小環境執行固定console輸出，不呼叫服務。

- 18:49:48候選Vitest：**2檔59／59通過**（wrapper52、既有watchdog7）；watchdog以注入observe／restart adapter驗證，未操作真實LaunchAgent。
- 候選wrapper的`node --check`通過；候選主規格OpenSpec strict通過，設定`OPENSPEC_TELEMETRY=0`。
- 暫存內容與候選逐檔一致，檔案allowlist、禁止環境／憑證／產物路徑及明顯credential格式檢查通過；測試內秘密字串均為人工fixture，不是本機秘密值。這不是所有可能秘密格式的形式化證明。
- `git diff --cached --check`及工作樹`git diff --check`通過。加入本紀錄後再核14檔暫存邊界，功能程式與測試blob不得改變；不因僅增加驗證文字重跑全套前端／MultiView／build。

## 保留範圍與限制

提交前對474份既有dirty檔案建立內容／刪除狀態指紋，精準暫存沒有改寫這些工作檔；操作文件以index patch切出日誌段，工作檔完整保留。App Support wrapper、RealTimeStock plist及全部observer TOML共23份指紋另行核對，不修改、安裝或重啟正式副本。

本機commit只保存本候選；不以候選測試冒充其他未完成change、所有行情或真實失敗分支驗收。既有自然載入、HTTP400／unknown及未實測限制均保留於原acceptance／verification。commit實際SHA以Git與當次完成回報為準；不將本次提交前HEAD或候選tree冒充最終commit。
