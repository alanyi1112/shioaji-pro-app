# 盤中監控 20 檔試辦代理審閱紀錄

## 基本資料

- Active 上限：`20`
- Evidence bundle：`acceptance/pilot-evidence-bundle-2026-09-10_2026-09-11.json`
- Evidence bundle hash：`89c613c49b66e156d78f24a8807a6ab2c3acf0bd2c370a0e75113c9fcb265f9c`
- Cohort receipt manifest hash：`3cd6de0bf92d0cafeb21ebfcc451253402dccb0429abf1ecb202e26ea0fd06a5`
- 可信 baseline：2026-09-10，`live_full_session_verified`
- 三件式完整盤中驗收日：2026-09-11
- Calendar source version：`twse-115-tpex-11400754581`
- 設定 revision／全域門檻：`3`／`2×`
- Reviewer：Codex（依使用者於 2026-09-10 的明確授權代理執行 GO／NO-GO 審閱；不是使用者本人簽核）
- 審閱時間（Asia/Taipei）：2026-09-11 13:42
- 決策：`GO`

## 審閱結論

核准本機 simulation、feature-off、通知關閉的固定 20 檔試辦版。2026-09-10 的完整 capture 提供緊接前一交易日可信 baseline；2026-09-11 同日 KBar capture、被動 K 線新鮮度與 runtime assurance 三件 evidence 均通過守門器。功能 bundle 經 validator 回傳 `valid=true`、`readyForHumanReview=true`，20 檔皆可完成跨日同分鐘量比重算，deterministic replay 兩次皆產生 8 筆 trigger。

本決策只核准 active 上限 20；configured 上限仍為 200。不得推論 50、100、160 或 200 檔可同時監控。第二個完整盤中日是非阻擋穩定性追蹤，不是本次功能核准或歸檔的必要條件。

## 必查證據

- [x] 2026-09-10 可信 baseline 與 2026-09-11 完整盤中日均為固定同一 20 檔；兩日各有 `20 × 270 = 5,400` 個 complete minute。
- [x] 兩日 close authority 均於 13:34:30 後完成；20 檔 `closeMode` 均為 `normal_or_revised_13_30`，沒有補造 13:31–13:33 regular-minute rows。
- [x] 2026-09-10 只作 `live_full_session_verified` baseline；2026-09-11 才執行同分鐘比較。
- [x] plan hash、cohort receipt manifest hash、cohort hash、config revision 與門檻在 bundle 內一致，期間沒有替換、輪替或補位。
- [x] KBar `volume` 累積量與同分鐘 ratio 可由兩份 raw capture 重算；抽樣結果列於下表。
- [x] deterministic replay `inputHash=1036e683b48efb52155b7ca550872d165001f086ce4f3d94b1a05bead85c1935`；兩次輸出皆對應 `outputHash=2055cafc9a696465ec8db34b3326368ecf10cef98da8a2d10522b2c92a0f70c0`，trigger count 皆為 8。輸出 hash 涵蓋 replay evaluations、event id 與 event hash。
- [x] 最終 `unknown=0`、`degraded=0`、`incompleteTriggerCount=0`，沒有 incomplete、forming、stale、gap、錯誤日期／單位或零分母誤觸發。
- [x] `notificationDispatchCount=0`、`duplicateNotificationCount=0`。
- [x] `brokerWriteAttemptCount=0`、`productionTransitionCount=0`、`serviceLifecycleMutationCount=0`；沒有第二個 login 或額外 capture generation。
- [x] provider physical usage、release 與 headroom 保持 `null`／unknown，沒有以 request、SSE connection 或 accepted response 推算。
- [x] GET-only SSE reconnect probe 已恢復，client generation 前進、cursor 保留、舊連線關閉，replayed event 與 duplicate notification 都是 0。
- [x] CPU、RSS、DB growth、SSE p95 latency 與 K 線 freshness 都在 plan 的核定預算內。
- [x] chart、watchlist、alert、smart order、MultiView 與 simulation runtime 沒有新增退化；同日被動 K 線 evidence 證明 visual commit 推進且 canvas 可見。
- [x] 2026-09-08／09-09 失敗 evidence、9/10 companion 缺件根因及既有 blocker 均保留，沒有為通過驗收而刪除或改寫。

## 抽樣重算

門檻公式為 `today_cumulative >= 2 × baseline_cumulative`，不先四捨五入 ratio。

| 交易日 | 商品 | minute | 今日累積量 | 基準累積量 | 精確判定 | 重算結果 | replay 一致性 |
| --- | --- | --- | ---: | ---: | --- | --- | --- |
| 2026-09-11 | `3441.TWO` | 09:36 | 13,763 | 6,227 | `13,763 >= 12,454` | matched，ratio 約 2.210214 | 兩次 replay 同為 8 triggers／相同 output hash |
| 2026-09-11 | `3026.TW` | 09:01 | 590 | 163 | `590 >= 326` | matched，ratio 約 3.619632 | 兩次 replay 同為 8 triggers／相同 output hash |
| 2026-09-11 | `2454.TW` | 09:01 | 676 | 315 | `676 >= 630` | matched，ratio 約 2.146032 | 兩次 replay 同為 8 triggers／相同 output hash |
| 2026-09-11 | `2449.TW` | 09:02 | 1,425 | 616 | `1,425 >= 1,232` | matched，ratio 約 2.313312 | 兩次 replay 同為 8 triggers／相同 output hash |

完整重播另辨識 `2308.TW`、`3090.TW`、`2368.TW`、`8103.TW`，合計 8 筆首次跨越事件；validator 由完整兩日 minute rows 重新建構結果，不依賴本表的顯示小數。

## 資源與退化判讀

| 指標 | 核定上限／語意 | 2026-09-11 實測 | 審閱判定 | 說明 |
| --- | ---: | ---: | --- | --- |
| active cohort | 固定 20 | 20 | 通過 | configured／eligible／active 皆 20，waiting／unknown／degraded 皆 0 |
| physical usage／headroom | unknown | `null`／`null` | 通過 | 不得推算；`providerReleaseProven=false` |
| CPU basis points | ≤ 2,500 | 4 | 通過 | shadow recorder 量測 |
| RSS bytes | ≤ 268,435,456 | 79,609,856 max | 通過 | 約 75.9 MiB |
| 單日 DB growth bytes | ≤ 33,554,432 | 0 | 通過 | 本次 shadow capture 沒有 evidence DB 寫入；不代表一般 runtime 永遠為 0 |
| SSE latency ms | p95 ≤ 10,000 | p95 2,532 | 通過 | max 39,809 ms 已揭露；核定守門採 p95，不宣稱每筆皆低於 10 秒 |
| K 線 freshness ms | ≤ 10,000 | 4,530 | 通過 | 同商品、同週期唯讀觀測，canvas 可見且 visual commit 前進 |

## 最終測試與文件守門

- `pnpm test`：218 files／2,369 tests 全數通過。
- `pnpm test:browser`：11 files／111 tests 全數通過。
- `pnpm build`：通過；只有既有 chunk size warning。
- `openspec validate add-configurable-intraday-relative-volume-monitor --strict`：通過。
- `git diff --check`：通過。
- 另有一個與最終採信 run 重疊執行的非採信 `pnpm test`，其 smart-order repository watchdog timing case 曾單次失敗；同一版本的完整採信 run 已通過 2,369／2,369。此現象保留為非阻擋的測試排程／資源競爭追蹤，不視為本盤中監控功能退化。

## 決策與限制

- 是否核准本機 20 檔試辦版：是，`GO`。
- 正式 active monitor 上限：20；configured 上限 200。
- 未解風險：Shioaji provider physical counting、全域 ownership、release confirmation 與 headroom 仍無法由現有 binary 證實；SSE latency 曾有 39,809 ms 單筆尖峰；第二個完整盤中穩定性日尚未執行。
- 必須修正事項：本次歸檔候選沒有阻擋性修正；若後續穩定性日出現缺分鐘、p95 超標、既有 K 線退化或通知重複，必須重新開啟風險並保持 feature-off。
- rollback／停止條件：任一商品資料缺漏或錯誤單位卻觸發、duplicate notification 非 0、既有行情退化、broker write／production／service lifecycle mutation 非 0、資源超過核定門檻，或 provider boundary 被誤宣稱為已知時，立即停止新增判定並維持本機 feature-off。
- 簽核備註：本紀錄是 Codex 依使用者明確委託完成的代理審閱，不代表使用者親自逐欄簽署，也不授權 production、broker write、服務啟停、擴量、歸檔、commit 或 push。
