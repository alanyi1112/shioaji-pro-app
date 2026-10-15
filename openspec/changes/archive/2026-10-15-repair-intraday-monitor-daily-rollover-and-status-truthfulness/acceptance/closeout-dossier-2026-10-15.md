# 跨交易日驗收 dossier 與結案缺口（2026-10-15）

全部時間 Asia/Taipei。17:36 以原始檔、SQLite readOnly 及本機唯讀 status API 核對；沒有執行採集器、稽核器或排程，不改使用者設定、行情連線、服務或收據。

## 判定與適用契約

本案 7.6 的跨日 dossier 已完成，包含跨兩個適用交易日的盤前、盤中、最終收尾及失敗語意；**本 change 仍不是 ready for archive**，因 7.7 要求的 scheduler「實際 next trigger 獨立讀回」尚未取得。不得以 CalendarInterval 或自行推算明日 13:35 取代該證據。

依已同步並歸檔的量比簡化案遷移矩陣，日常基準使用 v2／每日 160 檔契約，舊 v1 固定雙抓、ticks 與全日 capture 不再是本案日常成功的必要條件；被取代的條件不是驗收通過。歷史原始 live partial 不變，今日尾筆例外產品通過亦不追認其他日期。

## 兩個連續適用交易日的完整鏈

| 原證據 | 2026-10-08 | 2026-10-12 |
| --- | --- | --- |
| session 日期／官方前日 authority | 10/8／10/7 | 10/12／10/8 |
| 原 08:20 | session_created，08:20:05.800–08:20:34.762 | session_created，08:20:03.693–08:20:40.672 |
| 原 08:35／08:45 | 兩者 step_complete | 兩者 step_complete |
| sessionId | session-2026-10-08-cc623bceb2428e0331aed1c9 | session-2026-10-12-a3eb4dee341e8e9dce2346a6 |
| saved／locked revision（當日盤中查核） | 9／9 | 9／9 |
| control-plane requested／accepted | true／true | true／true |
| 有第一筆合法 KBar 的商品 | 160；最早 09:01:02.513 | 160；最早 09:01:02.651 |
| 當日前日基準重驗 | 10/7→10/8，160 合法 manifest | 10/8→10/12，160 合法 manifest |
| 最終原 observations | 43,198 | 43,198 |
| 原 live 完整性 | 158 完整／2 partial | 158 完整／2 partial |
| 缺 13:30 商品 | 2603.TW、5284.TW | 3665.TW、6239.TW |
| 原 closeReceipt | accepted=false、close_incomplete | accepted=false、close_incomplete |
| 原 08:50 最終收據 | failed／daily_minute_volume_execution_failed | failed／daily_minute_volume_execution_failed |
| 原收尾時間 | 13:34:36.332 | 13:34:35.794 |

兩日同 cohort hash `e7743272b46c6a207313b2767a910ae6072ff956a8bdd2ff3ceee5c6cbaf6985`，但 sessionId、基準及來源 generation 各自獨立。10/12 的 09:02 後 current、sealed-minute 整數公式、92 筆結果、通知 Gate 及 10:29 UI 實證見 [原跨日查核](cross-day-2026-10-08-12.md)。原 13:40 coverage_incomplete 及盤後唯讀 UI 不改判。

10/12 18:01 已確認 API degraded／daily_close_partial、current=false、evidence_stale、通知權=false；UI 留存 94 筆結果、顯示 158／2 與下一交易日 160 就緒。詳見已歸檔相依案的 [受控載入紀錄](../../archive/2026-10-15-simplify-intraday-relative-volume-runtime/acceptance/authorized-web-reload-2026-10-12.md)。這是正確的安全拒絕／唯讀語意，不是將 partial 稱為 live 成功。

## 後續真實受控換代與現況

- 10/15 原 08:20 建立 session，08:40 late-boot 原收據仍如實 failed／generation_mismatch；未刪除或改寫。
- 原 08:45 保存 transition `3bfd012491e946be3d5b6c231854e249944251e062462217cd502b2663bbe130`，同 session 由 `simulation:7b2fbecb-6cf4-45ed-8aae-982465f4c234` 續接至 `simulation:29420527-3b87-4c11-88d5-e6e5763af570`。原收據逐項保存 simulation、business session、2330 Snapshot、官方日期、artifact／revision 與 noCurrentResults；沒有 broker write、production 或 service-lifecycle 權限。
- 原 08:50 隨後啟動，160 檔首筆 KBar 最早 09:01:02.538；這是首筆資料前的受控換代實證，不代表資料已流動後可以任意重綁，也不代表 API 退出觸發原因已查明。
- 10/15 原 live 43,197 observations、157 完整／3 partial，原 08:50 failed／13:40 partial 不改寫。2355.TW、6191.TW、6449.TW 的尾筆補算與例外產品判定由已結案簡化案獨立呈現，不混入 original live coverage。
- 17:36 API 日期為 10/15、session phase=closing、current=false；使用者後續 saved revision=53，而原行情 session revision=15，故 config_revision_mismatch 不取得新監控／通知權。頁面仍留存今日 245 筆結果並顯示收尾例外與原 157／160。這是盤後原 session 不再有 current authority 的正確投影；沒有覆寫使用者門檻或名單來消除 mismatch。
- 動態 daily-status 為 feature_off／no_plan、planned=0；固定 cohort 的真實成功不能代替動態名單 live 驗收。

## 基準、原流量及排程邊界

本輪以 `DatabaseSync(..., { readOnly: true })` 逐份執行 `isDailyMinuteVolumeBaseline`，核 schema、manifest body hash、資料列 payloadHash／manifestId 一致、source／target、270 分鐘及 provenance。10/7→10/8、10/8→10/12、10/12→10/13、10/14→10/15、10/15→10/16 各 160／160，均 TSE 121／OTC 39、每組 43,200 分鐘且固定 cohort 一致。各組獨立 closeTotalCheck 仍 not_observed 160，不能宣稱獨立總量對帳完成；10/14→10/15 是已授權 operator 補件，不能冒充原生排程。

10/15 原 PID 11434 的 13:35 工作於 16:29:23.551 產生 attempt-02 complete160；16:29:24.013 同原程序產生 same-key-noop，新增下載 0／reservation 0，原 receipt hash `bf438489a071ca9676f38c279d85bc57e008b8cf33f79257102e64fbed0cab87`。本輪沒有重新執行 collector 來製造此證據。

`launchctl print` 可核原 postclose label、已載入 Node24 路徑、13:35 CalendarInterval、runs=1／last exit=0，但未提供 scheduler 計算的下一次實際 fire timestamp；本機 `premarket/schedule-receipts.json` 是既存 schedule 配置證據，不能把它或 Codex heartbeat next_run_at 當成原 postclose LaunchAgent 的 future trigger。7.7 因此維持未完成；不得為補證而重載／重裝排程。

原收據 requests／responseBytes 與先前 provider raw usage／保守 carry 各自保留。此次未向 broker 讀用量或新增來源錨點，不宣稱精確獨占節省；300 MiB 政策不修改。

## 可重驗來源及限制

- 私密唯讀來源稽核：`/Users/alanyi/Library/Application Support/RealTimeStock/Acceptance/remaining-closeout-20261015.wIOQt3/readonly-source-audit.json`，SHA-256 `1b8f89937755312ebadbd7474d5fa2d87d98dcafd662c104006564349c4ae38d`。保存 36 份原件 hash，讀取前後一致，包含三日 session、原四個時點收據、summary、late-boot 與真實 transition；不將私密原件加入 repo。
- 原來源 root：`Application Support/RealTimeStock/IntradayMonitor/`；正式 SQLite、`session-state/sessions/`、`premarket/receipts/`、`daily-run/` 與 `daily-minute-volume-collection/` 保持原狀。
- Node24 current-session-authority Vitest：14／14；同輪 view-model 8／8、Chromium 25／25、型別／build 成功。最初誤以 node --test 啟動 Vitest 檔案，因 runner 未初始化而失敗；改以既有 Vitest runner 後通過，未修改程式掩蓋失敗。
- 無法由本次讀取重建已遺失的上游 raw frame、原資源峰值、完整瀏覽器歷史 console 或實際 physical headroom，均維持 unknown；不把空 console 捕捉當全頁無錯誤。
- 本輪僅補 dossier／驗證與已授權的另一 UI 案規格同步／歸檔。未更動服務、排程、券商 session、監控 config 或原證據，未 commit／push。
