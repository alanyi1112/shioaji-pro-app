## Why

重開機後 TDCC 控制端將目標同步例外壓成 invalid_response；日 K 把未驗證誤呈為泛化失敗；選股舊 pending cache 與新版 review 不符，阻斷其他已完成快取重用。需要可重現、保持安全守門的修復。

## What Changes

- 保存 TDCC 安全階段診斷，重現並修復確證問題。
- 分開日 K 傳輸失敗與資料未驗證，保留逐商品缺口。
- 舊 pending 不阻斷 original complete cache 純重用；不換綁、不重置嘗試。
- 以離線回歸及受控本機操作驗收，保留休市設定、來源 blocked 與跨日自然驗收。

## Capabilities

### New Capabilities
- `local-after-reboot-data-recovery`：本機背景資料恢復與安全診斷。

## Impact

影響 MultiView TDCC route/runner、日 K runner 與來源準備器。涉及本機受控操作但不授權真實下單、commit、push 或歸檔；零下載另行守門。

## 本輪擴充範圍

依使用者追加授權，實際補齊盤後、籌碼與選股資料至上一個已完成交易日；必要時可受控載入及補跑。以共用日曆與使用者休市設定決定目標，保持 simulation、安全來源／額度 Gate、原失敗與未完成自然驗收，不 commit／push／歸檔。

## 重開機用量銜接追加範圍

依 10/24 使用者要求，修正原始 API 用量與持久額度身分缺少跨程序接續的問題。分開原始計數與單調保守扣帳，同帳戶完整舊收據通過後將前段全額加新段全額，不變更原政策、quote reserve、quota identity 或釋放舊預留。保持所有既有安全 Gate，僅補已授權的 10/20 一次來源請求，實際驗證 v8／v9 發布至 10/22。影響限本機 verified-reset ledger、新增回歸及本 change 文件；休市設定、凍結 bundle 與未完成自然驗收保持。

## 本機版本整理授權（2026/10/24）

前述不 commit 的限制屬實作當時的授權邊界。後續使用者另行授權依相依範圍分批建立本機 commit：A 用量銜接、B 來源重用與單日上限、C 共用日曆消費、D TDCC 診斷與週資料恢復，以及 E 本 change 文件。各批均須精準 stage，從實際 index 隔離匯出並離線驗證；不 push、不重啟或新增請求、不歸檔。既有 cooldown、來源 review 更新器及其他未完成變更不隨本批提交。提交完成不代表自然驗收完成。
