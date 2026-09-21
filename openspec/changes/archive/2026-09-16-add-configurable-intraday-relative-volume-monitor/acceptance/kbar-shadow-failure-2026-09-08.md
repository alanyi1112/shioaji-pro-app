# 2026-09-08 固定 20 檔完整日 Capture 失敗證據與修正

## 結論

2026-09-08 capture 在 simulation、feature-off、通知關閉下由 08:54 執行至 13:31，固定 cohort 20 檔、單一 KBar SSE、單一 subscribe batch，最後對相同 cohort 的 unsubscribe accepted。收盤 authority 已嘗試 seal，但 20 檔皆只保存 09:01–09:23 共 23 個連續 completed minute，因此 `fullSession=false`、`baselineEligible=false`，不得作為第一日 baseline，也不得啟動後續擴量證據。

後續規則稽核另確認：台股個股可能延後至 13:33 收盤，因此本次在 13:31 封存與 unsubscribe 本身也不足以證明完整收盤。recorder 已改為維持 cohort 至 13:33 後 90 秒，最早 13:34:30 才可核發 close authority；本檔固定保留為雙重失敗證據，不得因程式修正而升格或覆寫。

原始 capture 保留於 `acceptance/kbar-shadow-2026-09-08.json`，SHA-256 為 `c9508a8affbafa58c3c1ca8381760dd2566d26f94acd39582c64037882f4f561`。不得覆寫、刪除或補造缺少分鐘。

## 可重現事實

| 項目 | 實測 |
| --- | ---: |
| KBar frames | 5,399 |
| malformed frames | 0 |
| adapter accepted events | 480 |
| `invalid_received_time` | 824 |
| `kbar_minute_gap` | 20 |
| `symbol_degraded` | 4,075 |
| 每檔 sealed minute | 23 |
| 每檔範圍 | 09:01–09:23 |
| close accepted | false |
| unsubscribe accepted | true |
| provider release proven | false |
| broker write／production／service lifecycle mutation | 0 |

總事件守恆：`480 + 824 + 20 + 4,075 = 5,399`，等於 transport 收到的所有 KBar frames；沒有 malformed 或遺失於 parser 的 frame。

## Root cause

adapter 原條件要求 `receivedEpochMs >= barEpochMs`，即使 options 已核准最多 2 秒 `futureSkewMs`，也沒有把該容許量套用到 provider 分鐘標籤與本機 receipt time 的比較。由 20 檔最後都停在 09:23、`invalid_received_time` 之後各出現一次 `kbar_minute_gap`，以及該條件的 code path，可推定跨入 09:24 後有分鐘標籤比本機 receipt time 略早的 frame 先被拒絕；下一個可接受 frame 與舊 forming minute 不連續，因而使全部商品維持 fail-closed degraded。

原始 evidence 依安全規格沒有保存完整 SSE payload，因此「單一 frame 的負偏移毫秒數」無法事後重建；修正只採用 adapter 原本就核准的 2 秒上限，不放寬到無界時間差。

## 修正

時間驗證改為同時要求：

1. provider bar time 不得超過 receipt time 加上既有 `futureSkewMs`。
2. receipt time 不得超過 monotonic local now 加上相同 `futureSkewMs`。
3. 超過 2 秒的未來 bar label 仍以 `invalid_received_time` fail closed。

新增 deterministic regression tests，涵蓋 0.1–0.2 秒提早跨分鐘仍可 one-bar delay seal，以及超過 2 秒仍拒絕。今天的失敗 capture 不因程式修正而升格；最早只能在下一個適用完整交易日用相同固定 cohort 建立新的第一日 baseline。
