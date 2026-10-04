# 本機精準接線驗證（2026-10-03）

本紀錄接續第三階段；保留原 `schema_pending`、HTTP 503 與來源 ECONNRESET 證據，不改寫成當時已成功。時間採 Asia/Taipei。

## 實際安裝範圍

- 13:06:29（`2026-10-03T05:06:29.141Z`）先以 Node SQLite online backup 保存現有本機 DB，備份通過 `quick_check=ok`，檔案權限 600；共 1,268,523,008 bytes。備份位於本機 Application Support，不納入 repo／上傳。
- 備份：`/Users/alanyi/Library/Application Support/RealTimeStock/MultiView/backups/bollinger-pre-0035-0036-2026-10-03T05-06-29-141Z.sqlite`。
- 在同一個 `BEGIN IMMEDIATE`／`COMMIT` 中只安裝 additive `0035_screener_bollinger_history.sql`／`0036_screener_bollinger_publication.sql`，並追加真實 `d1_migrations` 記錄。不套用其他 change 的 0034，不執行廣泛 migrate／restore／資料清理。
- 新增 8 個布林資料表。既有 `screener_snapshots` 前後均為 12；profile 筆數 0，沒有啟用策略、建立虛構來源 review 或下載歷史。此計數核對不冒充所有舊資料逐筆比對。
- 已安裝 runtime 與 repo 差異核實只有本 change 的前置 hook；先保留原檔 `realtimestock-runtime.before-bollinger-20261003T050629Z`，再以精準 patch 同步可選參數與 watcher 的 `--bollinger-only` 入口。同步後 `cmp` 一致、`zsh -n` 通過。
- 沒有 bootout／bootstrap／kickstart；既有 watcher 的 RunAtLoad／300 秒頻率不變。新輪次會自然讀取新程式；安裝不等於正式每日發布。

## 實際 API／UI

13:07:36（`2026-10-03T05:07:36.726Z`）隔離 Chromium storage／禁止所有 API 寫入與 broker 路徑，唯讀查證：

| 請求 | 次數 | 真實結果 |
| --- | ---: | --- |
| daily-profile GET version=8 | 2 | HTTP 200；`profile=null`，預設未啟用 |
| status GET version=7 | 2 | 舊版唯讀查詢保留 |
| results GET version=8 | 1 | HTTP 200；pending／`v8_preparation_pending`；rows=0 |
| PUT／POST／broker／SSE | 0 | blocked=0，未企圖寫入／建立行情連線 |

`pageErrors=[]`、`consoleMessages=[]`；實際畫面顯示「尚未發布布林三階段報告」，不產生假結果。沒有操作每日儲存、圖表或清單。這些是接線／空報告證據，不是正式來源與結果端到端驗收。

- [實際初始化後畫面](local-initialized-disabled-2026-10-03-1310.png)；檔名不是排程收據時間。
- 唯讀 checker 新增明確 `initialized-disabled` 模式，原 `schema-pending` 模式保留；兩者都拒絕非 GET 與非選股 API，不遮蔽 console 訊息。
- 安裝後 publication／transport focused tests 23／23 再跑通過（不重複加總第三階段測試）。

## 自然 watcher 與剩餘限制

安裝前真實 LaunchAgent：runs=214、last exit code=0、RunAtLoad、300 秒 interval。13:09:05 自然下一輪後 runs=215、last exit code=0、interval 仍為 300 秒；未人工送出 run。

既有原始 `tdcc-watcher.log` 新輪次依序為：

```json
{"state":"skipped","reason":"profile_disabled"}
{"event":"tdcc-watcher-noop","reason":"queue_empty"}
{"state":"skipped","reason":"session_complete_sleeping","effectiveSessionDate":"2026-10-02","nextAttemptAt":"2026-10-05T06:00:00.000Z"}
```

新入口未被舊版的完成休眠擋下，且未啟用的策略沒有下載資料。舊 TDCC queue／選股休眠正常保留，task 5.1 完成；這不是 task 7.3 的正式自動發布成功。

前後 8080／5173／5174 listeners PID 分別為 1273／933／938，保持不變；沒有重啟 API／watchdog／Web／MultiView、增加 broker login／subscription、production、下單、archive、commit 或 push。

TPEx 指定日期來源仍未取得合法回應；來源使用契約、160 日逐商品資料與正式自動發布尚未驗收。不因 schema 安裝解除來源 Gate、不自動儲存每日設定，不具備歸檔條件。
