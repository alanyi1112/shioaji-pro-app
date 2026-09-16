# 160 檔下一交易日準備狀態（2026-09-14）

## 結論

程式、容量、exact 160 transport／recorder／launcher／bundle、產品 DB／SSE、失敗落檔及下一交易日接力排程均已準備完成。2026-09-14 收盤後的可信前日 1 分 K baseline 已建立並通過正式 validator；正式 GO 仍須於 2026-09-15 完成 09:01–13:30 的 160 檔完整盤中驗收，目前 active limit 維持 20。

## 盤後籌碼選股變更後再驗證（2026-09-14 17:05）

- 重新驗證 baseline set：exact 160、160 個唯一商品、每檔 270 分鐘、總計 43,200 分鐘，`baselineUsable=true`，日期為 2026-09-14 → 2026-09-15，manifest 與 baseline hash 均通過。
- 產品 config revision 4 的前 160 個 enabled items 與 immutable cohort 完全同序；ordinal 27 為 `6187.TWO`，前 160 不含 `2926.TWO`。
- simulation API、business session、2330 Snapshot、5173、5174、D1 integrity 與 D1 coverage 均正常；盤中選股頁面及 `/api/intraday-monitor/v1/status` 可讀，正式 capture 前維持 `feature_off`、`approvedActiveLimit=20`、`dataActive=0`。
- 盤後籌碼選股新增的 scheduled pipeline 在 14:00 前會以 `source_not_closed` 立即返回，固定 daily job 為平日 16:45；不會與 09:01–13:30 的 full-session capture 執行資料採集。TDCC watcher 每五分鐘的空佇列路徑會呼叫同一個 14:00 gate。
- `scripts/realtimestock-runtime` 的 repo 與安裝版 SHA-256 完全一致；本輪籌碼選股僅增加該 pipeline 的 TWCA CA 設定，未變更 exact 160 transport、recorder 或 launcher。
- 重新通過 runtime 36 files／238 tests、盤中前端 10 files／41 tests、盤中 browser 3 files／15 tests、完整非 browser 229 files／2,403 tests、完整 browser 14 files／128 tests、`pnpm build`、兩個相關 change 的 strict validation 及 `git diff --check`。
- automation `160` 維持 2026-09-15 08:45，08:50 後啟動正式 capture；automation `160-2` 維持 08:55 單次保險啟動。兩者都會先查 run registry，禁止重複訂閱。
- 完整日不以 13:30 作為取消訂閱時間：若部分個股觸發暫緩收盤，系統繼續接收至 13:33，保留 90 秒傳輸寬限並在 13:34:30 才封存。合法延後成交併入該股 canonical `13:30` 端點並記錄 `delayed_13_33`；未知或逾時即整日 fail closed。

## 產品路徑補強（2026-09-14）

- 產品 config 已更新為 revision 4，前 160 個 enabled item 的 canonical symbol 與 immutable manifest 完全同序；ordinal 27 為 `6187.TWO`，`2926.TWO` 已移到第 161 位。
- exact 160 recorder 已接入正式 evidence repository、量比 trigger、state-backed local API 與 DB polling SSE；驗收日將直接驅動「盤中選股」面板，不再只產生 capture JSON。
- 產品 schema 以真實 160 baseline 加 43,200 筆 synthetic observation 及 160 個 trigger 的最壞情境實測：全部接受，總寫入 15.120 秒，單筆 p95 0.146 ms、p99 2.19 ms、最大 145.402 ms；final DB＋WAL 38,260,736 bytes、working peak 42,327,712 bytes。
- 舊 plan 的 32 MiB DB growth 不足以容納產品 schema。已保留舊 plan，新增 `direct-stage-plan-160-product-2026-09-14.json`，DB growth 上限改為 64 MiB，較實測峰值多 24,781,152 bytes（1.59 倍）；session／capture／bundle、8 GiB free space 與 1 GiB RSS 上限不變。
- 正式 capture 現在要求同交易日被動 DOM 圖表 visual commit 前進、freshness 不超過 10 秒、產品 API `dataActive=160`，以及 local trigger SSE 可斷線續傳且零重複通知。只有 5173／5174 HTTP 成功不再足夠。
- Web launchd job 已重啟並載入 state-backed gateway；在尚未開始正式 capture 前保持 `feature_off`、`approvedActiveLimit=20`，符合 fail-closed 邊界。
- 本輪唯讀檢查 smart-order repository：`strategies`、`order_intents`、`broker_orders`、`pending_protection_commitments`、`protection_obligations` 皆為 0 rows；明早仍會因狀態可能漂移而重新核對，只有必要且無未結義務時才重啟 simulation。

## 程式與容量

- direct 160 固定名單為 `tiered-cohort-stage-160-replaced-6187-2026-09-11.json`，exact count 160，禁止盤中替換或輪替。
- bounded KBar transport 使用單一 batch subscribe、單一專用 SSE、逐事件白名單及相同 cohort 單次 unsubscribe；每個 generation 只可使用一次。
- recorder 對每檔保存 09:01–13:30 共 270 slots，總計 43,200 slots；未收到權威 KBar 的分鐘保存 `unknown/provider_kbar_missing`，不得補零。
- 完整 session 才可執行兩次 deterministic replay 並建立 stage session／bundle；partial、interrupted、缺分鐘、異序、跨日、hash 漂移或 unsubscribe unknown 均 fail closed。
- 兩個完整 synthetic 日共寫入 SQLite 86,400 rows。DB 最終增加 27,508,736 bytes；DB＋WAL peak working set 55,191,048 bytes，低於 64 MiB 工作預留；peak RSS 452,100,096 bytes，低於 1 GiB；量測時可用磁碟 374,656,532,480 bytes，高於 8 GiB最低門檻。
- 離線完整路徑摘要：`direct-160-full-offline-path-2026-09-14.json`。完整 v4 artifact 位於 `/Users/alanyi/Library/Application Support/RealTimeStock/direct-160-offline/2026-09-14-v4/`；先前版本與失敗紀錄保留。

## 真實行情 rehearsal

第一次 3 分鐘 rehearsal 完成 subscribe／unsubscribe 後，canonical writer 因 runtime probe 含報價浮點數而拒絕主證據；失敗 sidecar 保存在 `/Users/alanyi/Library/Application Support/RealTimeStock/direct-160-live/rehearsal-2026-09-14.json.failure.json`。修正後 runtime probe 僅保存布林結果、HTTP status 與整數延遲。

第二次使用新的 simulation generation 完成 2 分鐘 rehearsal：

- observed symbols：160／160
- KBar frames／delivered events：320／320
- malformed frames：0
- subscribe／unsubscribe：各一次且 accepted
- 結束後 provider stream `active_connections=0`
- CPU：31 basis points；RSS：149,667,840 bytes
- event-to-seal processing latency max：1 ms
- 既有 5173／5174 service response latency max：47 ms
- broker write／production transition／notification dispatch／active limit mutation：全部 0

rehearsal 是 partial evidence，43,040 個未涵蓋 slots 仍為 unknown，`formalAcceptanceEvidence=false`、`readyForBundle=false`，不得當作完整盤中日或 provider 容量證明。成功 artifact 位於 `/Users/alanyi/Library/Application Support/RealTimeStock/direct-160-live/rehearsal-2026-09-14-v2.json`。

## 下一交易日接力

Codex heartbeat automation `160`（名稱：`160檔與盤中選股完整驗證`）目前排定 2026-09-14 13:35 Asia/Taipei：

1. 收盤後唯讀採集相同 exact 160 的 2026-09-14 1 分 K 雙抓、contract 與 ticks。
2. 只有 160 檔各 270 分鐘、雙抓一致且總計 43,200 分鐘時，才建立供 2026-09-15 使用的 baseline set。
3. 成功後將同一 automation 改排至 2026-09-15 08:45；檢查交易義務、8 GiB 磁碟、simulation、business session、2330 snapshot、5173 與 5174，必要時依既有授權重啟。
4. 08:50 後以 fresh generation 及 `direct-stage-plan-160-product-2026-09-14.json` 啟動 exact 160 product-mode full-session capture；同一 recorder 寫入產品 DB／SSE，status 必須顯示 160 data-active。
5. 盤中以既有頁面建立同日被動圖表 freshness 證據，並唯讀驗證 local result SSE 斷線續傳、面板結果、搜尋、排序、選取與 K 線連動。
6. 持續到 13:34:30，再執行雙次 replay、bundle 及 Codex GO／NO-GO 審閱；全部 Gate 通過才保存 review 並將正式 active limit 原子改為 160。

另有一次性的 cron automation `160-2`（名稱：`160檔盤前保險啟動`）排定 2026-09-15 08:55。它先檢查主流程與 run registry；主 capture 已執行時只回報、不重複訂閱。若主流程未啟動且所有 Gate 仍有效，才在 09:00:30 前接手相同 product-mode capture，避免單一 heartbeat 未準時接手再次錯過完整日。

兩階段任何失敗都必須回報並 fail closed；不補造 baseline、不自動重試 live stage、不替使用者發通知、不下單、不進 production。若未同時完成 160 GO 與產品功能，automation 必須續排，不得刪除。

## 驗證

- `pnpm exec vitest run scripts/intraday-monitor-runtime/*.test.mjs`：36 files／238 tests 通過，包含真實 generation 格式、產品 sink、GO activation、state-backed 160 status 與外部 DB trigger SSE 逐筆 cursor。
- `pnpm exec vitest run --config vitest.browser.config.ts src/components/intraday-monitor-panel.browser.test.ts src/lib/passive-chart-freshness.browser.test.ts src/lib/intraday-monitor-invalidation.browser.test.ts`：3 files／15 tests 通過。
- `pnpm build`：通過。
- `openspec validate evaluate-tiered-intraday-monitor-expansion-to-160 --strict`：通過。
- `git diff --check`：通過。

目前 tasks 為 46／51；其餘 7.2、7.3、8.1、8.2、8.3 必須以完整交易日結果完成。
