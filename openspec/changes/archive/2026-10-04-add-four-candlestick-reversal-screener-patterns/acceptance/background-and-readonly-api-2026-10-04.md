# 背景 OHLC 能力與唯讀 API 實作驗證

時間：2026-10-04 22:53（Asia/Taipei）。接續使用者「進行下一階段」，完成 tasks 3.1–3.4、4.1–4.3 的程式與隔離測試；總進度 **17／27**。本文件不代表 UI 或真實全市場驗收完成。

## 完成的程式

- 新增 additive migration `0040_screener_candlestick_publication.sql`、Drizzle schema 與本機 SQLite writer 白名單。五張獨立資料表保存 staging／published／failed、逐股完整 OHLCV、head、追加收據與準備狀態，不改每日布林 profile。
- 新增 repository、背景 publisher 及既有 scheduled watcher 的獨立接線。只讀已驗證官方日曆／臨時休市公告原文及已凍結來源選擇，取最近最多 64 個共同 session；不下載來源、不建立 login／subscription，也不從 v8 close-only 推算開高低。
- 保留逐股缺日／非法 OHLC 理由；已知價格不可比較的 provenance 會傳入 evaluator。來源未提供完整除權息事件資料時，不能宣稱已驗證所有價格事件。
- 發布鍵綁定日期、母體、來源、mapping、calendar、formula／capability；獨立有界 lease、完整 staging 重讀驗證後 atomic head，失敗 staging／收據留存、合法重試另立 snapshot。同鍵完成不追加成功收據，穩定休眠不寫 state。
- 新增 GET-only v9 status／results 與 5173 gateway 契約，回傳逐棒原值、前期窗、子條件精確 evidence、來源版本／hash、三態守恆及固定快照 cursor。舊分支只接相同日期／母體；缺舊能力為 unknown，停用新分支回舊契約。
- 證據包含在結果回應；展開證據不需要額外 HTTP。每列／總讀取／HTTP 大小皆有上限，查詢不建立 schema、不寫 profile／清單、不觸發背景準備。

## 隔離測試結果，不冒充真實行情

使用 Node **24.19.0**：

1. `node --test` 執行 `stock-screener-v9-publication.test.mjs`、`stock-screener-v8-publication.test.mjs`、`stock-screener-source-selection.test.mjs`：**61／61**。
2. 舊 route 與 idle 回歸：`stock-screener-route.test.mjs`、`stock-screener-idle.test.mjs`：**16／16**。
3. 六個 Vitest 核心／查詢／v7／v8／技術／布林回歸：**126／126**。

合計 **203／203**。新 publisher 測試使用隔離 SQLite 與人工 fixture，不是當日 watcher 或官方行情。

v9 副作用測試保存的 handler 呼叫計數：status 1、篩選 1、分頁 1、證據額外端點 0；global `fetch` 0、查詢 SQL 寫入 0。SQL 讀取另有計數，並驗證完整分頁集合與 rowsHash 改動重新拒絕。這是單元契約計數，**不是 Chromium 的真實逐請求 network counts**，不能代替 task 6.4。

並行發布、最後一批遭竄改、舊 head 保留、失敗收據保留及重試、不相容能力／price basis／calendar／母體 hash、過期底稿 stale、非法 cursor 均有測試。v8 profile CAS、來源比較容差與限流／日曆／休眠既有測試仍通過。

## 本輪發現與修正的失敗

- 第一版 nested MultiView TypeScript 檢查拒絕 BigInt literal，因該專案 target 為 ES2017；改用 `BigInt()` 建構子，保留精確整數公式，不修改 target 或放寬價格比較。
- 第一版新測試的 fixture 時鐘未到新日期收盤，以及把不存在的 `outcome.evidence` 當結果欄位，修正測試日期與 `matches` 契約後通過。
- 舊布林兩項來源審查測試使用實際日期，今天先被 fixture 日曆效期擋下。以 Node test mock 固定該兩項測試的 Date，保留 `source_contract_pending` 原斷言；正式程式與正式日曆日期未修改。
- 讀取來源 review 改為依 ID 快取原紀錄，仍對每份 manifest 核對 provider／review hash／mapping／price basis，不能因同一 review 已讀過就跳過不同 manifest 的驗證。

初次失敗的工具輸出未刪除；上述修正後重新執行相應測試。

## 真實本機唯讀預檢與未完成項

`lsof` 證實既有 Node PID 957 仍監聽 `127.0.0.1:5174`。初次 sandbox curl 連線失敗；以核准的唯讀本機請求重查成功，沒有因此重啟服務。

真正 `GET http://127.0.0.1:5174/api/stock-screener/status?version=9` 回 HTTP 200：

```json
{"version":9,"state":"pending","reason":"v9_schema_pending","snapshotId":null,"canUseResults":false,"formulaVersion":"candlestick-reversal-v1","capability":"candlestick-ohlcv-history-v1","catalogVersion":"candlestick-video-taiwan-study-2026-10-04-v2","rows":[]}
```

這證明新 route 已載入且缺 schema 時誠實回 pending，**不是正式發布成功**。本輪未對使用者真實資料庫套用新 migration、未手動呼叫正式 publisher／下載器；真實自然 watcher 發布及逐股獨立稽核留在 6.3。尚未完成五按鈕／收合參數／說明／結果 evidence 的 UI 接線、Chromium 視覺測試或圖表／雙清單有界操作驗收；5.1–5.5、6.1–6.5 保持未完成。

根目錄 `tsc -b`、MultiView `tsc --noEmit`、Vite build 通過；build 有既有 >500 kB bundle 提醒，不宣稱零警告。此 change strict validation 與 `git diff --check` 通過；另檢查此 change 及本輪新增文字檔的 whitespace，不將 repo 其他 dirty work 當本 change 完成。

未 archive、commit、push，未改 broker login／subscription、服務生命週期、交易草稿、每日 profile 或使用者清單。
