# 2026-10-15：分頁跨日修正與真實盤中門檻驗收

時間均為 Asia/Taipei。使用者明確要求修正「分頁仍查10/14、顯示0筆」，並在不影響原全日驗收下完成盤中門檻切換。本輪沒有啟停服務、重新登入、選新商品、啟用production／CA／下單、代跑本機排程或修改舊failed／partial。

## 根因與修正

- 原面板使用空相依`useMemo`，把台北日期固定在載入時；頁面雖從status讀到10/15，results及本機事件路徑仍查10/14。09:37既有分頁顯示0筆，但今日正式SQLite已有112筆，並非行情遺失。
- 改以日期state及10秒本機日期檢查，另外在focus／visibilitychange重新核對，涵蓋背景分頁暫停計時器後回到前景。日期真的變更才切換日期範圍；同日檢查不重建lease或SSE。
- 跨日清除前日結果／cursor及盤後狀態，舊非同步請求與舊stream回應由cleanup的stopped旗標拒絕；新結果也核對自身日期。門檻確認後的結果刷新使用同一日期scope，不混入舊日。名單、設定與未儲存草稿不因換日清空。
- 生效後清除／隱藏「門檻已保存、等待確認」的過期提示；真正pending仍顯示上一有效門檻，保存錯誤仍保留。

## 隔離驗證及正式前端載入

先在`/private/tmp/intraday-date-candidate.IscG35`副本修改／驗證，不觸發現行Vite監看。23項Chromium面板測試通過，包含台北跨日、遲到的昨日HTTP回應／SSE、cursor隔離、同日不重建連線、保留7倍未存草稿、快捷CAS及生效提示。原固定9/4 fixture初次被新的日期隔離正確拒絕，補上fixture自己的固定時間後完整23／23通過；不是移除日期檢查以取得測試成功。

隔離型別檢查最初因副本缺scripts／fixtures依賴而失敗，補齊唯讀依賴後通過；build最初缺SHIOAJI_VERSION，補齊後通過。Node24型別與最終候選build通過，保留原chunk>500kB警告。正式工作區面板23／23及型別檢查亦通過。這些是程式回歸，不代替下列真實操作。

載入前確認無頁面未儲存草稿，原全域1.5倍／revision15及200項名單不變。只修改前端component與測試，沒有修改Vite config或runner相依模組、沒有手動整頁reload。前端Fast Refresh會關閉並重接本機頁面lease／事件stream；這不是額外broker行情連線。原daily owner PID84453、API PID83566、Web971、MultiView977與原API generation不變。

09:40既有頁面已顯示當日10/15及112筆結果；原09:39分鐘160份完整，active160／degraded0。最終畫面顯示228筆（live22／historical206），日期10/15、stream connected及1.5倍真正生效；未把右側圖表既有歷史範圍當作今日行情或圖表修復實證。

## 真實盤中切換

正式session=`session-2026-10-15-4aebd580e4d9e0aec51695d1`；同一owner PID84453，generation=`simulation:29420527-3b87-4c11-88d5-e6e5763af570`。不可變行情session仍revision15，比較版本獨立推進。使用原既有頁面三快捷按鈕，不提交全名單或測試資料。

| 操作 | 真正HTTP時間／CAS | 原owner durable生效 | 封閉水位 | 後續完整分鐘 |
| --- | --- | --- | --- | --- |
| 1.5→2 | 09:40:52.116；15→16 | 09:40:52.783 | 160檔09:39 | 09:40各160份 |
| 2→3 | 09:41:25.441；16→17 | 09:41:26.085 | 160檔09:40 | 09:41各160份 |
| 3→1.5 | 09:42:20.771；17→18 | 09:42:21.653 | 160檔09:41 | 09:42各160份 |

三張不可變receipt transitionHash依序：

- `e320d731b5f86b2c77c87e7931c07dd921ca7c873a99998e973fd53eac76c0bd`
- `83e91f2fec57152dd30a40140a9c21e4b7a2ff66fe03aa91bbb8f02ea3554801`
- `696f66847c462ba31ee42b46b92694ec18e245d6dcfd8df62df5cd5fef40445b`

以正式read-only journal reader重新核對initial／head／完整hash chain、owner／日期／generation／structure／config proof，全部成立。三次共480份watermark逐一核對SQLite今日與前日同分鐘整數累積量，再依各商品有效門檻以BigInt交叉相乘重算：差異0、unknown0。

09:43:11第一次讀取09:42時只有118份，獨立驗證器當時嚴格拒絕「完整」，未宣稱通過；09:43:40真正到齊160份才完成驗證，原早期snapshot保留。09:47:41交接查核顯示09:44／09:45／09:46各160份，仍running／current／fresh、active160／degraded0、切換failure0，沒有因revision16–18停止留存。

操作後全域精準恢復原1.5倍，正式revision18；200項items hash前後均為`3d02c87764ecd0c0c1271969260654c06c1d40ab6501b17789dd8b6032f1daf5`。原112筆trigger的payload及hash全數不變。沒有並發使用者設定差異被覆寫。

## 網路、通知及來源不中斷

- Chrome原分頁真實HAR涵蓋09:37:35.476–09:45:41.817；有界切換窗口為09:40:47.991–09:43:40.641。窗口內專用threshold PUT恰3筆、expectedRevision15／16／17、不同idempotency key、HTTP均200；request只含schemaVersion／idempotencyKey／expectedRevision／threshold，沒有items或草稿。
- 此窗口的登入請求0、subscribe／unsubscribe0、新stream請求0、全config寫入0。原runner的同一FD25、同一socket device及`127.0.0.1:49266→8080`連線保持ESTABLISHED，owner claim hash及generation不變。前端修正的本機stream重接發生在獨立載入窗口，不冒稱全程所有頁面事件連線都從未重接。
- 既有快照、帳務及交易回報讀取輪詢仍在；窗口內snapshots22次等已逐路徑計數，**不宣稱全系統HTTP為0、provider用量增量可獨占歸因或精確流量節省**。專用門檻路徑不持有broker訂閱port，未為此驗收發送任何login／subscribe或新商品請求。
- 三次切換靜默重判分別35／14／65筆，共114筆，receipt的retroactiveNotificationCount=0、notificationAuthority=false，所有reclassified事件kind=historical。以原API簽發cursor作最多4頁的唯讀分頁查核，114筆全部實際可讀且notificationAuthority=false；不是只用最早100筆結果推論全部。未替使用者開啟聲音或系統通知，原trigger不重播成新通知。
- 未在本次短暫console捕捉中看見Maximum update訊息，不等於原React更新深度根因已修復或整頁零錯誤。08:38／昨日API退出的觸發者仍未確認；本次只證明這個有界驗收窗口來源不中斷。

## 本機證據與判定

私密根目錄：`/Users/alanyi/Library/Application Support/RealTimeStock/Acceptance/intraday-threshold-20261015.oUrQkN/`。HAR／原始快照不放入repo；目錄保留before／after、每步實際status／config／SQLite／journal／socket、截圖及唯讀重驗腳本。

- `threshold-switch-final.har` SHA256=`c302f5360fdd227b625ea407ae08bb4067e0c03bdecf736e33eaad1f6381e5bb`。
- `receipt-formula-verification.json` SHA256=`c211ab13e49b91947fa63efcc8c5ee226814074b2536ccd303fc9a053745d883`；保留最初network pending，由另張`network-verification.json`在09:46:56完成，不回寫原證據。
- `network-verification.json`、`results-pages.json`、`handoff.json`及`final-applied.png`保存實際操作和結果；第一份HAR、早期尚未到齊snapshot及所有舊失敗保留。

8.6依真實證據完成，主change47／49；7.4仍待今日真正全日收尾與獨立盤後基準，7.6仍待完整dossier。沒有以此盤中切換追認歷史failed／partial，不自行歸檔、commit或push。

收尾檢查：本change strict validation、git diff --check及本輪9份程式／文件文字whitespace檢查通過。主Codex驗收追蹤已同步47／49與「不得重複8.6操作」，ACTIVE及原每日08:05／09:05／14:05／17:05規則、原聊天目標不變；未新建排程或更改本機工作。前端正式檔案與已驗證候選內容一致，未提交Git。
