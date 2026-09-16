# 2026-09-16 盤中選股驗收準備

## 結論

2026-09-16 的 exact 160 檔正式驗收已完成。原始 capture 因 3026.TW 缺 13:29／13:30 而先保存 NO-GO；依使用者核准的受限收盤尾端政策完成盤後雙抓與重新審閱後，Stage 160 已核准，正式 active limit 已原子切換為 160。

## 2026-09-16 收盤審閱結果

- 首次嚴格判定：`NO_GO`；原始 capture 與首次 dossier 保留不可改寫。
- 衍生最終決策：`GO`；正式 active limit 為 `160`，product runtime 為 `complete_go`。
- 08:20／08:35／08:45／08:50 durable 排程均準時完成；09:02:15 canary 為 160／160 收到 live 09:01 KBar，`liveAvailabilityComplete=true`。
- 159 檔完成 09:01–13:30 共 270 個 live expected minutes；3026.TW 原始 live 只有 09:01–13:28。
- 3026.TW 盤後 REST 連續兩次完整 270 分鐘且 hash 相同；09:01–13:28 累計量逐分吻合，13:29 為 0 張、13:30 為 261 張，最終累計量 7,907 張。
- 13:29／13:30 衍生列標記 `liveDelivered=false`，不具通知或交易權限；derived acceptance 的 `dataContinuityComplete=true`、`formalAcceptanceEvidence=true`、`readyForBundle=true`。
- 被動圖表、SSE reconnect、資源與零交易副作用 Gate 通過；activation 只發生一次 active-limit mutation。
- 完整審閱紀錄見 `../evaluate-tiered-intraday-monitor-expansion-to-160/acceptance/direct-160-live-no-go-2026-09-16.md` 與 `../evaluate-tiered-intraday-monitor-expansion-to-160/acceptance/direct-160-live-tail-gap-go-2026-09-16.md`。

## 固定資料

- Cohort：160 檔，唯一商品數 160。
- `manifestHash`：`e7743272b46c6a207313b2767a910ae6072ff956a8bdd2ff3ceee5c6cbaf6985`。
- Baseline 日期：2026-09-15；目標交易日：2026-09-16。
- `baselineHash`：`b60b5743837ce3d72b753d9cf6240e4533a8b1c609968a11c997aa2d7d362f7a`。
- Baseline：160／160 檔，每檔 270 個一般盤分鐘，共 43,200 筆；`comparisonSource=1m_kbar_cumulative_volume`、`baselineUsable=true`。
- 本機可用磁碟：檢查時為 366,427,914,240 bytes；最低保留 8 GiB。

## Durable 排程

LaunchAgent `com.alanyi.realtimestock.intraday-premarket` 已由 `launchctl` 載入，關鍵入口不再依賴 Codex heartbeat。排程 read-back 均為 `ready`：

| 台北時間 | Canonical UTC | 工作 |
| --- | --- | --- |
| 08:20 | 00:20Z | 驗證 simulation mode、API generation、business session 與 2330 Snapshot；必要時走安全 lifecycle 修復，通過後才固定 generation anchor |
| 08:35 | 00:35Z | 暖機與完整 Gate |
| 08:45 | 00:45Z | 正式 prerequisite 與 cold-start risk Gate |
| 08:50 | 00:50Z | 取得 exclusive claim，先建立 SSE，再送 exact 160 subscribe |
| 09:02:15 | 01:02:15Z | 逐檔 09:01 canary、incident與一次有界 recovery；歷史 gap bootstrap 等逐檔第一個 live minute 到達後界定完整範圍與 overlap |

Schedule receipt 位於本機 Application Support 的 `IntradayMonitor/premarket/schedule-receipts.json`，權限為 0600。

## 已排除的 2026-09-15 根因

- Subscribe receipt 與 data-plane ready 已分離；初始 160 檔均為 `awaiting_first_kbar`。
- `dataActive` 只計收到合法 first-event 的唯一商品；159 檔不得宣告 ready。
- 09:02:15 canary 會保存 received／missing 與 first-event latency；任何缺漏會永久令 `liveAvailabilityComplete=false`。
- Adapter 接受逐檔第一筆 09:01 KBar 時會立即建立 data-plane evidence；canary 不會因 one-bar-delay 的正式封存策略而誤等到下一分鐘。
- 相同 run／generation／cohort 只允許一次 unsubscribe／resubscribe，不建立第二條 SSE、不輪替商品。
- 有界 REST gap bootstrap 會雙抓同一 completed range，比對 hash、完整分鐘與 REST／SSE overlap；不一致商品降級。
- 若逐檔第一個 live minute 是 09:10，runner 會以 09:10 作 overlap 驗證並只保存 09:01–09:09；bootstrap 完成前暫存 live observation，不再留下 09:02–09:09 空洞或從 09:10 單分鐘起算的錯誤累積量。
- 累積量從 09:01 起重建；09:10 才收到首筆 live KBar 時，不再把該筆 volume 當成開盤累積量。
- Capture 與 failure sidecar 使用共同 `<capture>.failure.json` constructor，runner receipt 直接回傳兩條 canonical path。
- 盤中選股面板在 Stage 160 runner 執行時，以 `MutationObserver` 在真實 visual commit 發生後立即只讀現有圖表 DOM／canvas，另以 5 秒週期補償遺漏事件；超過 10 秒的舊 commit 會在前端與 evidence recorder 兩端排除。同一圖表有兩次新鮮且確實前進的 visual commit 後，才自動以 0600 寫入當日 canonical freshness evidence。
- Scheduler、capture、09:02:15 canary、bootstrap、recovery、failure sidecar 與 close seal 共用去敏 operational event schema；canary 或收盤失敗事件會立即標記 `alertEligible=true`，heartbeat 只負責讀取與回報。
- Stage 160 核准入口已加上第二層 fail-closed 驗證：160／160 的 09:01 live canary、逐檔 expected-minute set、nominal／延後收盤狀態、權威 close evidence、seal time、SSE reconnect、圖表 evidence 與零交易副作用缺一不可。

## 已解除的維運限制

- 2026-09-15 維修前先建立權限 0600 的一致性備份，再以模擬帳戶目前委託集合連續兩次皆為空的唯讀證據，將兩筆 2026-08-27、無 obligation／intent 的外部 `exit_claim` 透過受限 repository transition 與 event journal 轉為 `released`；全程未送出券商寫入。
- 正式帳戶對帳已改為同時檢查當日與過去交易日的 external projection；目前完整 working set 不再包含的舊交易日 claim 會自動釋放並寫入 journal，避免相同 blocker 再度跨日殘留。
- 智慧單 diagnostics 已確認 `smart_order_lifecycle_blockers=0`、`smart_order_active_obligations=0`、`smart_order_drain_items=[]`，write master 仍為 disabled。
- simulation API 常駐 job 已載入去敏 `service-log-wrapper.mjs`，輸出至權限 0600 的 `simulation-api.jsonl`；抽查最近 200 行均為合法 JSONL，未發現未遮蔽的秘密欄位指派。
- 完整安裝時發現 MultiView 0030–0032 schema 已存在但 D1 migration journal 未登記；經 22 個資料表／索引、9 個新增欄位、provenance backfill、integrity 與 foreign key 逐項驗證後，已在備份保護下補正 journal。標準 `local-runtime install` 已重跑成功，MultiView health 回報 schema revision 0032。
- `local-runtime status` 的去識別化 diagnostics 判讀已修正，可直接顯示 authenticated 狀態、blocker 數量與 drain 類別，避免把可驗證的生命週期阻擋誤報為 unknown。

## 已取得的交易時段證據

- 被動圖表 freshness 已在 2026-09-16 盤中取得實際可見圖表與兩次新鮮、前進的 visual commit。
- 逐檔收盤與受限尾端例外均已納入審閱；一般盤 13:30 仍不能自動代表未經驗證的全 cohort 完成。

## Fail-closed 與 rollback

- 08:35 或 08:45 任一 Gate 未通過：不得建立 08:50 capture。
- 09:02:15 任一商品缺少 09:01：立即 NO-GO；後續 REST 補齊只影響 `dataContinuityComplete`，不得改寫 `liveAvailabilityComplete`。
- 要停用 durable 排程：`node scripts/intraday-monitor-runtime/premarket-orchestrator.mjs --remove`。
- 要檢查排程：`node scripts/intraday-monitor-runtime/premarket-orchestrator.mjs --status`。
- Capture 或驗收失敗：保留 active limit 20，不建立 160 activation，不刪除 failure history。

## 非交易時段驗證

- `pnpm run build`：通過。
- 主專案 unit／integration／replay：236 個 test files、2,438 tests 全數通過。
- Browser／UI：14 個 test files、130 tests 全數通過。
- MultiView／盤後選股／籌碼：731 tests 全數通過；同步修正 collector fixture 套用最新 additive chip migration，避免測試資料庫 schema 落後正式程式。
- OpenSpec strict validation 與 `git diff --check`：通過。
