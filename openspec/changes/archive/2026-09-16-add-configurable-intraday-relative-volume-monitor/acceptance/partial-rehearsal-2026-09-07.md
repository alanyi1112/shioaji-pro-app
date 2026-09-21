# 盤中 20 檔 Partial Rehearsal 證據摘要（2026-09-07）

## 結論

- 今日在 `simulation`、user-visible feature-off、通知關閉下完成兩次各 3 分鐘的有界 KBar 演練；第二次固定 cohort 的 20／20 檔都有連續且可 seal 的 `11:55`、`11:56` 兩根分鐘資料。
- 本輪確認 Shioaji KBar batch endpoint 不接受非四位 ASCII 數字的股票代號；`0050`、`0056` 在其他 18 檔持續收到 KBar 時沒有逐檔事件。試辦 eligibility 因此保守限定為「四位數且不以 `00` 開頭的台股整股 STK」。不符合者仍保留在最多 200 檔設定名單，但狀態顯示 `kbar_contract_unsupported`，不占 20 檔試辦 cohort。
- 演練只有盤中短時間資料，固定標記 `fullSession=false`、`baselineEligible=false`、`notificationEligible=false`。它不取代任務 8.2 所需的兩個完整交易日，也不授權 production、通知或正式監控。

## Cohort 與固定計畫

- 設定名單：63 檔 enabled。
- 正式演練 cohort：20 檔，依目前監控名單排序選取符合 live KBar eligibility 的前 20 檔。
- receipts manifest hash：`3cd6de0bf92d0cafeb21ebfcc451253402dccb0429abf1ecb202e26ea0fd06a5`。
- stage plan hash：`8ed4a70a318034192b77a7ec8be093571635d52c1ffaa31c3f6dbab8ac6f7b90`。
- stage plan 預算：CPU 25% 單核心、RSS 256 MiB、DB growth 32 MiB、SSE latency 10 秒、K 線 freshness 10 秒；至少 20 檔 active、至少兩個完整交易日。
- provider request、automatic subscription、subscription transport、service lifecycle 與 broker write authority 在 stage plan 中全部為 `false`。

固定 cohort：

```text
8027.TWO, 3441.TWO, 3026.TW, 3037.TW, 3189.TW,
8046.TW, 3149.TW, 3131.TWO, 3481.TW, 3008.TW,
2308.TW, 2301.TW, 3363.TWO, 3081.TWO, 3163.TWO,
3090.TW, 2368.TW, 2454.TW, 2449.TW, 8103.TW
```

## 實機發現與修正

1. 原始 cohort 含 `00988A`，batch subscribe 立即以 HTTP 400 拒絕，錯誤指出 one-minute KBar stock code 必須為四位 ASCII 數字；相同 cohort 的 unsubscribe 也被拒絕。
2. 排除非四位數後第一次演練含 `0050`、`0056`。subscribe／unsubscribe 皆 accepted，18 檔有連續 KBar，但這兩檔皆為 0 event，因此該次只有 18／20 檔 observed。
3. live preparation、capture manifest 與監控狀態 eligibility 均改為保守排除非四位數及 `00` 開頭商品；第二次演練改用 20 檔普通股並達到 20／20 observed。

這個 eligibility 是依本機 Shioaji HTTP server 於本次 simulation session 的實際回應所作的 fail-closed 邊界，不宣稱是所有 provider／版本的永久規則。

## 第二次演練結果

證據檔：[`kbar-rehearsal-2026-09-07T1155.json`](./kbar-rehearsal-2026-09-07T1155.json)

| 指標 | 實測 |
| --- | ---: |
| 固定 cohort | 20 檔 |
| 有觀測商品 | 20／20 |
| 每檔 sealed minute | 2（`11:55`、`11:56`） |
| KBar frames | 60 |
| delivered events | 60 |
| malformed frames | 0 |
| KBar latency p50／p95／max | 2,479／2,659／2,659 ms |
| CPU | 11 basis points（約 0.11% 單核心） |
| RSS before／after／delta | 55,214,080／55,558,144／344,064 bytes |
| max RSS | 79,659,008 bytes |
| max heap used | 8,811,568 bytes |
| 2330 snapshot before／after | HTTP 200，120／40 ms |

snapshot probe 只證明既有行情 API 前後可用，`provesVisualChartFreshness=false`；正式完整日仍需另存實際 UI／K 線 freshness 證據。

## 安全與權限對帳

- subscribe：一次固定 20 檔 batch，accepted。
- unsubscribe：一次相同固定 cohort batch，accepted。
- provider physical usage：`unknown`；不得從 HTTP accepted、SSE frame 或 connection count推論。
- provider release：未證明。
- notification dispatch：0。
- broker write attempt：0。
- production transition：0。
- service lifecycle mutation：0。
- polling fallback：false。
- raw SSE payload：未保存。

重啟 5173 套用新狀態語意後，實機狀態將 63 檔分為 48 檔 eligible、20 檔等待 bounded Gate、28 檔等待 pilot limit 及 15 檔 `kbar_contract_unsupported`；`active=0`、`subscriptionTransportAuthority=false`。

重啟後另完成 15 秒只讀 tick readiness audit：SSE `active_connections` 前後均為 12，125 個 tick event 中 124 個通過結構驗證，觀測 27 檔；一筆不合格事件只計數、不保存 raw payload。這份資料不證明連續性、physical ownership 或 Gate 0。

## 尚待完成

- 兩個不同日期、09:01–13:30 每檔 270 根連續 sealed minute 的完整交易日 capture。
- 第二日同分鐘累積量比的 deterministic replay、重算與零重複事件驗證。
- 實際 K 線 freshness、重連、DB growth、既有功能無退化與 reviewer sign-off。
- 完成上述證據前，任務 8.2、8.3、8.9、8.10 維持未勾選，change 不進入歸檔候選。

## 本輪回歸驗證

| 驗證 | 結果 |
| --- | --- |
| 監控相關 targeted tests | 7 files，33 tests passed |
| 主程式單元／整合回歸 | 203 files，2,265 tests passed |
| Browser 回歸 | 9 files，101 tests passed |
| MultiView 回歸 | 723 tests passed |
| `pnpm build` | 通過；保留既有 chunk size warning |
| `git diff --check` | 通過 |
| `openspec validate add-configurable-intraday-relative-volume-monitor --strict` | 通過 |

上述驗證只表示現階段程式與證據工具回歸通過；由於任務 8.2 的兩個完整交易日尚未取得，任務 8.10 仍不得勾選。

## 關聯檔案

- [`pilot-cohort-receipts-2026-09-07.json`](./pilot-cohort-receipts-2026-09-07.json)
- [`pilot-stage-plan-20-2026-09-07.json`](./pilot-stage-plan-20-2026-09-07.json)
- [`live-readiness-post-capacity-2026-09-07.json`](./live-readiness-post-capacity-2026-09-07.json)
- [`kbar-rehearsal-2026-09-07T1150.json`](./kbar-rehearsal-2026-09-07T1150.json)
- [`kbar-rehearsal-2026-09-07T1155.json`](./kbar-rehearsal-2026-09-07T1155.json)
- [`pilot-stage-runbook.md`](./pilot-stage-runbook.md)
