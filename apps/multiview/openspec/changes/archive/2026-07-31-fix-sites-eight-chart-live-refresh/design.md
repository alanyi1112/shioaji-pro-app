## Context

目前 `public/static/app.js` 已有 `/api/candles/batch` 頁面級更新協調器，但只在 `deploymentTarget === "cloudflare"` 使用。Sites 保留站仍由每個 panel 建立 `/api/stream` `EventSource`；Worker 的 stream loop 每 20 秒更新且不主動結束。八圖、其他同源 request、瀏覽器背景／喚醒與 platform proxy 疊加後，部分 panel 會長時間顯示 local payload cache 的前一交易日資料。

`/api/candles/batch` 已可接受最多八個 request、逐項回傳成功／失敗，並以 D1 batch payload cache 降低重算成本。因此修正不需要新增 API、資料表或外部服務。

## Goals / Non-Goals

**Goals:**

- Sites 與 Cloudflare 共用相同的頁面級 bounded live update lifecycle。
- 新 subscription 在既有 batch 執行中加入時，能在該 batch 結束後立即補跑。
- visible／online 恢復能取代既有低頻 timer，立即取得 fresh payload。
- 保留單一 panel 失敗隔離、指標參數、Pivot mode、panel destroy 與切頁取消行為。

**Non-Goals:**

- 不移除 Worker `/api/stream` endpoint，避免破壞既有 API contract 或其他未盤點 client。
- 不改變上游行情來源、報價驗證規則、D1 schema、快取 retention 或資料排程。
- 不把初始完整 K 線 payload 改成新的 API shape；本次聚焦於 live refresh lifecycle。

## Decisions

### 1. 兩個 deployment 共用同一 batch coordinator

`connectStream` 不再依 deployment target 分流。所有 panel 都透過共用 coordinator 訂閱 `/api/candles/batch`，保留每個 panel 的 symbol、interval、Pivot 與 indicator query。

替代方案是限制 Sites 同時只能開四條 `EventSource` 並輪替其餘 panel。這仍會讓不同 panel 取得資料的時間不一致，也會保留背景恢復與同源 request 飢餓問題，因此不採用。

### 2. coordinator 保存「目前 batch 後立即重跑」狀態

若 batch in-flight 時有新 subscription、visible／online recovery 或其他 immediate refresh，設定 rerun flag；目前 batch 完成後以 `0 ms` 排下一次，而不是回到 30 秒／5 分鐘的一般間隔。若已有低頻 timer，immediate refresh 會先取消並取代。

替代方案是只把 deployment target 條件移除。現有 `schedule(0)` 在已有 timer 或 in-flight 時會被忽略，較晚完成 initial load 的 panel 仍可能等待一個完整輪詢週期，因此不足。

### 3. 保留 `/api/stream` 但前端不再作為主要 lifecycle

Worker stream route 與相關 payload parity 測試保留，避免不必要的 breaking change。前端 contract test 改為確認 production panel path 不再建立 `EventSource`，而 stream endpoint 測試仍驗證 API 相容性。

## Risks / Trade-offs

- [Sites 的 batch request 在八圖時一次計算較多 payload] → 沿用既有最多八圖限制、逐項失敗隔離、single-flight 與 D1 batch payload cache。
- [同時完成多個 panel 可能產生一次額外 immediate rerun] → rerun flag 合併為最多一次，完成後才恢復一般盤中／休市間隔。
- [移除前端 EventSource 後更新頻率由 20 秒變為盤中 30 秒] → 這是有意的 bounded 更新；換取八圖一致性、背景恢復與 Sites／Cloudflare parity。
- [部署後舊瀏覽器資產仍在 cache] → Sites version 必須更新 cache-buster，驗收時重新載入並確認實際載入新 `app.js`。

## Migration Plan

1. 先以單元／contract tests 驗證 shared coordinator、immediate rerun、timer replacement 與 subscription cleanup。
2. 部署同一 commit 至 Cloudflare 正式站，確認既有 batch path、Access smoke 與 Free-tier gate不回歸。
3. 建立並部署新的 Sites 保留站 version；若 deployment 失敗，保留前一個成功 Sites version。
4. 在既有授權 session 重新載入 Sites 保留站，驗證至少兩個八圖頁籤的八格皆為本交易日資料。
5. 若 live 驗收失敗，回復前一 Sites version；`/api/stream` endpoint 未移除，可供後續診斷。
