## 1. 判定與啟動入口

- [x] 1.1 建立晚開機時間窗、台北日期、固定排程缺席與日曆／基準先決條件的純判定函式及邊界測試
- [x] 1.2 新增獨立 `RunAtLoad` LaunchAgent 與 `--startup-catchup` CLI；登入過早／過晚／休市時安全 no-op，不改動四個固定時點
- [x] 1.3 實作登入後至 08:59:00 的有界唯讀就緒重查；不得自行登入、重啟服務或無限背景輪詢

## 2. Session 與證據

- [x] 2.1 實作晚開機 exclusive claim、append-only 準備／失敗收據與 08:20／08:50 缺席來源欄位，不覆寫任何原始收據
- [x] 2.2 在正式本機雙市場日曆、160 檔基準與完整 simulation Gate 通過且今日零資料活動時建立唯一 session；已有相同 session 時冪等接續，identity 不符 fail closed
- [x] 2.3 新增晚開機 generation anchor 驗證，必須連結同日準備收據及 session／baseline／generation，原正常與人工復原路徑仍維持原限制

## 3. 單次採集與真實狀態

- [x] 3.1 讓固定 08:50 與晚開機入口共用每日獨占 capture-start claim，並保留既有 run registry 第二層防重
- [x] 3.2 在 08:50–08:58:59 通過重驗後，晚開機入口只啟動一次既有 capture；失敗留痕、不刪鎖或重複訂閱
- [x] 3.3 將 late-start／cold-start risk 與首筆 KBar／canary／freshness 狀態區分，不能將晚開機成功冒稱固定排程或完整日驗收

## 4. 驗證與安裝

- [x] 4.1 補齊 08:18／08:42／08:55／08:58／09:00、基準缺失、服務延遲、重複登入、固定排程競態、休市與 generation 不一致的回歸測試
- [x] 4.2 執行 focused tests、TypeScript／Node 檢查、OpenSpec strict validation 與 `git diff --check`，保存結果
- [x] 4.3 在 08:59 後確認入口只會 no-op，安裝並讀回新增 LaunchAgent 的實際啟動設定，不啟停既有 API／watchdog／Web／MultiView
- [ ] 4.4 下一適用交易日以真實晚登入保存 claim、收據、session、單次採集與首筆 KBar／canary 證據；未完成前不得標為 live acceptance 完成
