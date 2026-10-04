# 備援 schema 安裝與 Gate 驗證（2026-10-03）

時間為 Asia/Taipei；使用者授權接續下一步。本紀錄不是正式來源 review、160 日完成、自動發布或備援成功的證據。既有 failed／partial 紀錄及早期未安裝狀態原樣保留。

## 真實安裝成功

- 18:03:34.581 建立新 Node SQLite online backup，18:03:39.330 transaction 完成。唯一 local DB 為既有 MultiView `state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite`，沒有廣泛執行 migrate 或還原舊備份。
- 備份：`/Users/alanyi/Library/Application Support/RealTimeStock/MultiView/backups/bollinger-pre-0037-0039-2026-10-03T10-03-34-581Z.sqlite`；1,268,523,008 bytes、權限 600、`quick_check=ok`；不納入 repo。
- 只執行 `0037_screener_daily_quotes_cache.sql`、`0038_screener_source_selection.sql`、`0039_broker_bandwidth_reservations.sql`，在同一 `BEGIN IMMEDIATE`／`COMMIT` 中追加 `d1_migrations` 記錄。新增 10 個資料表；快取、source registry／selection／comparison、broker observation／reservation／receipt 皆為 additive。
- 安裝前後全部既有非 SQLite 內部 schema 的排序 JSON SHA-256 相同：`adb123732050920d74ad5fe24cadc51843f2fad7daf36a16a9eeb3fbd8edb1bd`。
- 舊 `screener_snapshots` 均為 12 筆；`screener_bollinger_profiles`、publications、batches、receipts、daily、rows、state、head 均為 0。head 排序查詢 JSON hash 均為 `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`。此核對不冒充整個 1.2 GB 舊資料逐列比對。
- 8080 Shioaji PID 1273、5173 Web PID 933、5174 MultiView PID 938 前後未變。未啟停服務、另登入／訂閱、production、下單、archive、commit 或 push。

## 真實本機驗證

18:04:17.301，隔離 Chromium storage 並禁止非選股 GET API，取得 profile=null；結果 HTTP 200、pending／`v8_preparation_pending`、rows=0。daily-profile GET 2 次、v7 status GET 2 次、v8 results GET 1 次，合計 5 次；nonGet=0、blocked=0、pageErrors=[]、consoleMessages=[]。畫面明示尚未發布，不操作每日儲存／圖表／清單。此 pending UI 不代替 task 7.4 的正式結果驗收。

18:05:25.889，以真實本機 DB 及 concrete admission 檢查未配置預算政策的路徑：

```json
{"allowed":false,"reason":"broker_policy_pending","http":0,"receiptsBefore":0,"receiptsAfter":1,"reservations":0}
```

追加收據為 `denied`、payload `{"reason":"broker_policy_pending"}`；未刪改任何舊收據，未送 usage／Snapshot／daily_quotes。這是安全拒絕的實證，不是假稱來源或預算已成立。

## 第一方文件與仍缺證據

- [Shioaji 官方每日行情](https://github.com/Sinotrade/Shioaji/blob/master/plugins/shioaji/skills/shioaji/references/MARKET_DATA.md)：明示按日期取得每日行情與 column-oriented HTTP JSON，支援本 change 使用日期批次而非逐檔分鐘 K 的方向。
- [Shioaji 官方使用限制](https://sinotrade.github.io/tutor/limit/)：歷史查詢建議盤後且需快取；交易日 08:00 重置流量。這不等於有本帳號即時 reset identity／當前其他工作承諾，不據此填新 epoch 清掉舊債務。
- [TWSE 使用條款](https://www.twse.com.tw/zh/terms/use.html)仍要求採同意的下載方式；政府開放資料例外不能直接代替目前指定日期歷史入口的適用性 review。使用者授權接續實作不冒充資料提供方授權。
- 既有監控的 `baseline-bandwidth-budget.mjs`／`dynamic-baseline-delta-budget.mjs` 是各自預算，不是這份集中 ledger 的即時 producer。缺少來源相容性／使用範圍 review、至少兩份獨立可驗實測、可信 quota identity、其他工作的即時承諾。未把未知承諾填 0、沒有刷新靜態時間戳冒充新觀測。

## 回歸與任務狀態

相關 Node 128／128，retention 另 4／4，總計 132／132 通過；本輪未重跑 Vitest／Chromium fixture 的全部套件，前輪 242 項結果仍為前輪紀錄。實際 Chromium pending UI 為上述獨立驗證。

OpenSpec 此 change 的 strict validation、`git diff --check` 及本輪五個新增／修改文字檔的 whitespace 檢查均通過；未清理其他 change 或生成檔。

tasks 保持 34／41；1.1、8.1、8.4、7.2–7.4、8.8 仍未完成，沒有為 schema 安裝放寬 Gate 或刪除備援範圍。主規格尚未同步，未歸檔。
