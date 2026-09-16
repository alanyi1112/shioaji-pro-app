# 分類盤後下載驗證

日期：2026-09-16，Asia/Taipei。

## 實作結果

- 既有 watcher 每 300 秒喚醒，在 operator lease 內先處理籌碼，再判斷主流程冷卻。
- 法人 16:00、融資券 21:00 開放當日採集。窗口是本機策略，不代表官方接口 SLA。
- 每個市場／類別／日期獨立保存重試與短期 claim，空報表半小時、限流至少一小時（尊重 Retry-After）、格式錯誤六小時、傳輸失敗指數退避；每日最多六次。
- 每輪保留當日缺口名額，另最多補 limit 個歷史日期；成功 receipt 不重抓。
- 原有收盤行情 14:00 gate、TDCC 週排程、v5 完整性發布門檻保持原契約。
- 已安裝 runtime 僅同步選股命令的 --use-system-ca，不重啟服務或更動 launchd 時程。

## 本機證據

- 20:00:53 的有界採集 run `1ed684c6-902e-46bf-a146-07a633e0f402`：上櫃法人成功入庫，報表進度 81/84 → 82/84。
- 上市、上櫃融資券均回報 `publication_window_pending`，nextAttemptAt `2026-09-16T13:00:00.000Z`，換算台北為 21:00。
- 後續實際 watcher log 出現 `screener-chip-independent`，run `6d7b8ae5-9757-4294-ba98-cdbbc1ee6a3e`，同樣等待 21:00，證明排程已讀取新版。
- 21:00 是最早允許時間，實際採集仍受 watcher、lease、系統休眠影響；晚間資料到齊尚待來源發布。

## 檢查

- Node 選股測試與新增窗口、跨市場失敗隔離、持久冷卻、主流程冷卻隔離測試通過。
- recovery Vitest 8 項通過；第一次誤用 Node runner 執行此 Vitest 檔失敗，改用正確 runner 後通過。
- MultiView TypeScript、OpenSpec strict、git diff --check、已安裝 runtime zsh 語法檢查通過。

## 完成邊界

### 完成後休眠追加驗證

- 9/16 晚間確認兩市場融資券均於 21:03 採集驗證，v5 已發布至 9/16。
- 新增唯讀休眠 gate 與到期缺口篩選；Node 選股 90 項測試、TypeScript、OpenSpec strict 與 diff whitespace 檢查通過。
- 本機使用相同 `--scheduled` 入口實際執行，回傳 `session_complete_sleeping`，effectiveSessionDate 為 9/16，nextAttemptAt 為 `2026-09-17T06:00:00.000Z`（台北 9/17 14:00）。
- 五分鐘 watcher 繼續 TDCC 檢查，選股僅執行唯讀 gate；未到期不下載或重算快照。14:00 是程式最早允許時間，實際喚醒取決於 watcher 與電腦運作狀態。

完成本機分類下載與休眠優化；9/16 融資券已下載驗證，v5 已發布。此紀錄不代表其他功能的終驗完成。未 commit、push、部署或更動其他排程。

## 歸檔提交候選驗證

- 依 9/16 使用者授權歸檔本 change 與 recover-invalid-screener-session-once，同步兩份正式規格。
- 提交包含必要選股 v4／v5 底層、migration 與測試相依；不納入成交明細、盤中量比或 Cloudflare 待辦。runtime 僅提交系統憑證參數 hunk，舊 browser fixture 僅補日期型別欄位。
- 從實際 Git 暫存區匯出獨立目錄驗證，借用現有 node_modules，非全新依賴安裝。選股 Node 測試 90/90；根 Vitest 首次 2375/2379，4 個失敗均因 dist 尚未建立；候選 TypeScript 與 Vite build 完成後，兩個失敗測試檔 16/16 通過。首次 pnpm 因借用依賴目錄而拒絕自動 install，後改用已安裝 runner 直接執行；首次漏加排除條件的 Vitest 已中止，不計入正式結果。
- build 保留大於 500 kB bundle 與 ineffective dynamic import 警告。根 OpenSpec strict 47/47；暫存區 diff whitespace 通過。
- 72 個檔案路徑檢查沒有秘密、SQLite、憑證或 outputs；高信心秘密樣式掃描未命中，不代表全面安全稽核。
