# 2026-09-16 exact 160 盤中驗收 NO-GO dossier

## 審閱結論

- 決策：`NO_GO`
- reviewer：Codex（依使用者明確授權代理審閱）
- reviewedAt：`2026-09-16T13:47:00+08:00`
- 正式 active limit：維持 `20`
- production／broker write：未授權且未執行
- 160 activation：未建立

2026-09-16 的盤前排程、09:01 live canary、160 檔盤中資料流、盤中選股結果、被動圖表 freshness、SSE reconnect 與資源 Gate 均取得正向證據；但 3026.TW 在 13:29 與 13:30 沒有 provider KBar，安全截止點前也沒有權威 close evidence。該檔維持 `unknown`／`pending`，因此 `dataContinuityComplete=false`、`formalAcceptanceEvidence=false`，本日不得核准 Stage 160。

## 排程與開盤 Gate

- 08:20、08:35、08:45、08:50（Asia/Taipei）均由 `com.alanyi.realtimestock.intraday-premarket` 準時建立 durable claim 並完成；LaunchAgent 累計執行 4 次，最終 exit code 0。
- 08:50 capture 先建立單一 SSE，再對 exact 160 cohort 送出一次 subscribe；`subscribeAccepted=true`。
- 09:02:15 canary：160／160 檔均收到 live 09:01 completed KBar，缺漏 0；`liveAvailabilityComplete=true` 且結果為 immutable。
- 第一筆事件延遲介於約 2.4–4.2 秒，所有商品均由 `awaiting_first_kbar` 轉為 `active`，沒有用 subscribe receipt 冒充 data-plane ready。

## 完整盤與逐檔收盤結果

- capture 時段：08:50:01–13:34:30（Asia/Taipei），未在 13:30 提前封存全 cohort。
- observations：43,198；triggers：55。
- 159 檔：09:01–13:30，共 270 個 expected minutes，逐檔 `complete=true`。
- 3026.TW：09:01–13:28，共 268 個 minutes；13:29、13:30 為 `provider_kbar_missing`，`closeMode=pending`、`closeEvidence.status=unresolved`。
- close seal：expected 160、sealed 159、`accepted=false`；全日 unknown slots 共 2。
- 系統沒有補造 3026.TW 的零成交 KBar，也沒有用歷史 REST 補抓改寫 live evidence；此 fail-closed 行為符合逐檔延後收盤規格。

## 盤中選股、圖表與資料流

- 盤中 160 檔持續同步推進至收盤，開盤期間沒有重現 09:10 才開始記錄的問題。
- 被動圖表 evidence 於 09:00 自動保存；兩次 visual commit 均新鮮且有前進，`maxChartFreshnessMs=1`，canvas 全部可見。
- local event reconnect 成功，重播 55 筆事件，duplicate notification 0。
- bounded transport 共收到 43,199 個 KBar frames、malformed 0、recovery attempts 0；停止時 unsubscribe 成功。

## 資源與安全 Gate

- CPU：22 basis points，上限 2,500。
- 最大 RSS：161,382,400 bytes，上限 1,073,741,824 bytes。
- evidence DB growth：42,463,096 bytes，上限 67,108,864 bytes。
- capture：28,212,260 bytes，上限 67,108,864 bytes。
- 最大 event-to-seal latency：2,841 ms，上限 10,000 ms。
- 最小可用磁碟：363,043,794,944 bytes，高於 8 GiB 下限。
- notification dispatch、broker write、production transition、service lifecycle mutation、active-limit mutation 均為 0。
- provider physical usage、global ownership、release 與 headroom 維持 `unknown/null`，未冒充供應端容量證明。

## 最終狀態

- capture assessment：`liveAvailabilityComplete=true`、`dataContinuityComplete=false`、`formalAcceptanceEvidence=false`、`readyForBundle=false`。
- product runtime：`phase=failed`、`evaluationState=no_go`、`approvedActiveLimit=20`。
- failure sidecar：未建立；runner 正常完成並在 main capture 中保存 fail-closed NO-GO。
- Stage 160 activation：未建立。

## Artifact 與 SHA-256

- main capture：`319290088be2091445ebb471d248c7b1262e1f5609a79f00bb1cab050935245e`
- product runtime state：`080b6d5277044bd0b2924186973082b5c5f035e4ca67406742f74ff1377c1004`
- passive chart evidence：`cd6eab2be94ea0bb221f6372f572e8828c9f2af3a6bd853525a82dbe16a15d66`
- operational events：`5b6291acc90120031f0b2cd1b8d93540360d1f8cef389df1fc890a13ef2c6d50`

本日 evidence 不得重跑或覆寫，也不得以 REST 補抓把 3026.TW 的兩個 unknown slots 改成 live complete。後續修正應釐清供應端為何未送出 3026.TW 的 13:29／13:30 KBar，並補足可驗證的逐檔 close authority；在新的完整交易日通過前，active limit 維持 20。

## 後續衍生審閱

使用者其後明確核准受限收盤尾端例外：少於 5 檔、每檔至多缺最後 5 個連續分鐘，可在 09:01 live canary、盤中連續性與其他 Gate 全數通過後，以收盤後同來源 REST KBar 雙抓一致且與 live 累積量前綴完全相符的證據重新審閱。本檔與原始 capture 維持不可改寫；衍生 GO 結果另見 `direct-160-live-tail-gap-go-2026-09-16.md`。
