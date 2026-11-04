# 三組前端功能規格補齊與歸檔（2026-11-04）

## 結果

依使用者本輪明確授權完成三個獨立 OpenSpec change，補齊 proposal、design、tasks、delta specs 與 verification，全部 28 項任務完成後同步正式規格並以精確路徑歸檔。沒有 commit 或 push，Git HEAD 與完整 index 前後一致。

| 功能 | 歸檔位置 | 任務 |
| --- | --- | --- |
| K 線載入、三行資訊隱藏、年線與歷史暖機 | [improve-candle-chart-loading-and-year-ma](../../openspec/changes/archive/2026-11-04-improve-candle-chart-loading-and-year-ma/verification.md) | 10／10 |
| 自選清單左鍵單擊／雙擊 | [support-watchlist-click-navigation](../../openspec/changes/archive/2026-11-04-support-watchlist-click-navigation/verification.md) | 8／8 |
| 自動更新並接續看盤狀態 | [preserve-trading-view-on-automatic-update](../../openspec/changes/archive/2026-11-04-preserve-trading-view-on-automatic-update/verification.md) | 10／10 |

20 個歸檔檔案包含原 .openspec.yaml；搬移當下逐檔 SHA 相同，後續只對三份 verification 補充「沒有主動 runtime 操作」與 fixture 圖可能被既有版本偵測看見的區別，前後 hash 另存。最終 20 檔 manifest 存於 closeout-result.json，不以搬移前的 manifest 冒稱後續文件未變。

## 正式規格同步

新增 main-chart-daily-history-display、watchlist-click-navigation、local-web-automatic-update 三份正式規格；修改 chart-technical-indicators 的完整主圖組合條款，加入 SMA240 及經驗真的展示日線；將 main-chart-support-resistance-tools 的舊 reference 顯示條款更名並改為隱藏三列、保留選單回到最新。兩份既有規格另外 21 個 requirement 逐段確認未變。

## 驗證與證據邊界

- K 線 111／111、日線／指標 111／111、Chromium 66／66、版本／store／URL 24／24、Node gateway／plugin 7／7；App TypeScript 通過。各集合分列，不把 fixture 當成新自然行情事件。
- 歸檔前完整 strict 89／89，歸檔後完整 strict 86／86（82 份正式規格及保留的 4 個 active changes）。歸檔內三案另由 artifact graph done、任務全勾、delta 與正式規格逐段一致性檢查確認。
- 首次正式規格同步有兩份 Purpose 太短，strict 為 87／89；補具體用途後重驗通過，原失敗與修正後 log 均保存。
- 先前 Node 型別 3 個既有錯誤、native wiring 2／3 的舊斷言失敗，以及 Chromium 既有 act 警告分列保留；未宣稱全專案 build 或全部測試成功。
- 本輪 24 個相關程式來源 SHA 前後相同，不重新安裝、不主動操作正式頁面、不執行原生服務啟停／登入／訂閱／採集／排程命令。測試重新產生一張既有 key-price fixture 圖，新 passing fixture 移到證據目錄；此類產物可能被既有前端監聽／版本檢查看見，未對零自動重載或零券商流量作保證。

## 四個未完成大案保持

| 原案 | 進度 |
| --- | --- |
| support-intraday-monitor-late-boot-premarket-catchup | 109／118 |
| sync-monitor-roster-postclose-baselines | 94／96 |
| add-manual-special-market-closures | 29／30 |
| repair-local-after-reboot-data-recovery | 18／20 |

四案 51 個檔案的集合與 SHA 完全相同，沒有勾選新任務、修改自然驗收結論或搬移。它們仍是唯一四個 active changes；其餘先前歸檔內容及本輪前的工作區程式保持。

本機證據：[outputs/openspec-ui-closeout-20261104](../../outputs/openspec-ui-closeout-20261104)，包含 write-scope、各測試 log、source manifest、保護指紋、同步差異、搬移前後 manifest、最終 readback 與 Git HEAD／index 對帳。
