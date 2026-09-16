# 2026-09-15 exact 160 盤中驗收 NO-GO dossier

## 審閱結論

- 決策：`NO_GO`
- reviewer：Codex（依使用者明確授權代理審閱）
- reviewedAt：`2026-09-15T13:49:42+08:00`
- 正式 active limit：維持 `20`
- production／broker write：未授權且未執行
- 160 activation：未執行

本日不能作為 Stage 160 的完整盤中驗收日。主要原因是 live KBar 從 09:10 才開始、缺少 09:01–09:09，四檔又在 13:28 後沒有形成可驗證的收盤尾段；同日被動圖表 freshness evidence 亦未建立。即使歷史 REST 之後能讀回缺少分鐘，也不能改寫開盤當時的 live availability 失敗。

## 排程與啟動時序

- 原訂主 heartbeat：08:45（Asia/Taipei）。排程器將 `DTSTART;TZID=Asia/Taipei:20260915T084500` 誤存為 UTC，computed fire time 成為台北時間 16:45，當日上午沒有主 automation run。
- 備援 automation：08:55:53 建立 run，但未能補回已錯過的開盤前準備。
- simulation API 冷啟動：08:49:30。
- exact 160 capture 啟動：08:50:43，process PID 95277。
- 第一批 live SSE：09:11:02，內容為 09:10 KBar。
- runner 結束：13:34:30，未在 13:30 或 13:31 提前封存。

## Live 資料結果

evidence DB 對 `trade_date=2026-09-15` 的唯讀查詢結果：

- observations：41,752。
- triggers：9，event id 無重複。
- 商品數：160。
- 可見 minute 範圍：09:10–13:30，共 261 個不同 minute key。
- 156 檔：各 261 筆，09:10–13:30。
- 2395.TW、3023.TW、3680.TWO、6770.TW：各 259 筆，09:10–13:28。
- 全 cohort 共同缺少：09:01–09:09。
- 預期一般盤資料：160 × 270 = 43,200；實際少 1,448 筆。

runner 在訂閱接受後即將所有商品顯示為 `subscriptionState=confirmed` 與 data active；此狀態沒有等待逐檔第一筆 KBar，因此不能證明 09:01 data-plane ready。產品最終將 160 檔全數標為 `degraded`，但逐檔 `degradedReason` 與 `closeMode` 沒有保存，亦是後續修正項目。

## 盤中選股與圖表結果

- 盤中選股面板能顯示 Stage 160、data active 160、結果列、排序、選取與 K 線目標。
- 盤中結果由 7 筆增加為 8 筆，證明結果 SSE 與列表有繼續更新。
- 僅選取一次 2457.TW 建立單一圖表，1 分 K canvas 可見，`data-chart-diagnostic-schema=candle-chart-passive-freshness/1`。
- 圖表 visual commit 並非持續在 10 秒內前進；曾長時間停滯，無法取得兩次符合 freshness 門檻的純 DOM observation。
- 正式 `passive-chart-freshness-2026-09-15.json` 未建立，因此產品完整功能 Gate 失敗。
- 瀏覽器 console 查無新的 warning／error；這不能取代 visual commit freshness evidence。

## Runner 結果與 evidence contract 缺口

- 產品狀態：`phase=failed`、`evaluationState=no_go`、`boundedTransportReady=false`、`approvedActiveLimit=20`。
- main capture evidence：未建立。
- 實際 failure sidecar：`capture-2026-09-15.json.failure.json`。
- sidecar error：缺少 `passive-chart-freshness-2026-09-15.json`。
- runner、state 與 active lock 均在 13:34:30 後完成結案；active lock 已移除，服務仍健康。
- 盤中監督原本查找 `capture-2026-09-15.failure.json`，因此錯誤回報為沒有 failure sidecar。後續必須統一 runner 與 monitor 的 canonical sidecar path。

## 資源與安全邊界

- 結案時 evidence DB：37,023,744 bytes；WAL：4,148,872 bytes，合計約 39.3 MiB，低於 64 MiB working growth 上限，但因 main capture 未建立，不能宣稱完整資源 Gate 通過。
- 可用磁碟：342 GiB，高於 8 GiB prerequisite。
- 8080、5173、5174 在結案後均回覆 HTTP 200。
- product operation ledger：notification dispatch、broker write、production transition、service lifecycle mutation、active-limit mutation 均為 0。
- provider physical usage、global ownership、release 與 headroom 維持 `unknown/null`。

## Artifact 與 SHA-256

- failure sidecar：`e78915ff2e7572126adf51c7c687e305a6f00fa3cf5fbec39b1328c062f53732`
- product runtime state：`a15263a94a98eb1cf174f3f21141fe30c5c836ca352a0655879fc95e147c8582`
- cohort manifest file：`f4fcd71c3643f4ef7fa566e36ee4afd7a69c1c88a330a88e8f716721a180bbe9`
- product plan file：`d3ac95bc51e437eb5954582c7aef6266038dd2776c4580170fcfcf1d79c1df80`
- baseline set file：`c047ab48fe3f053c7f06ff24715c97f2b618116367f10f83e64051fb8a4f8fbb`

## 修正入口

收盤後修正已另立 OpenSpec change：`repair-intraday-monitor-premarket-scheduling-and-live-readiness`。它涵蓋台北時間排程 read-back、durable 盤前 orchestrator、08:20 暖機、逐檔 first KBar 狀態、09:02:15 canary、正式 runner 的權威 REST bootstrap、09:01 累積量重建、Shioaji service log、canonical failure sidecar contract，以及逐檔延後收盤 evidence。

修正與非交易時段 rehearsal 全數通過後，最早於下一適用交易日重新執行 exact 160 完整盤中驗收。不得重跑或覆寫 2026-09-15 evidence，也不得以本日部分資料核准 160。
