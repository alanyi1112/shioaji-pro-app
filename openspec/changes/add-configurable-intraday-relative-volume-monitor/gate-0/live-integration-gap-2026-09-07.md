# 2026-09-07 開盤後接續：實際接線缺口

## 結論

09:01–09:07（Asia/Taipei）檢查結果仍是 NO-GO。原因包含尚未完成的 runtime 整合及上游可觀測性，不能再描述為「只剩等開盤」。52／60 是既有任務清單的勾選數，並不代表正式盤中資料接線或 20 檔試辦已啟動。

證據：`../acceptance/live-readiness-2026-09-07.json`；擷取工具：`../acceptance/capture-live-readiness.mjs`。JSON 僅包含欄位白名單及 aggregate counters，不保存原始 SSE、委託、帳務或秘密值。

## 當次實測

| 項目 | 實測結果 | 可得結論 |
| --- | --- | --- |
| Shioaji API | 1.7.1、simulation true，前後一致 | 可使用既有 simulation session |
| 本機服務 | 8080、5173、5174 listeners 存在；runtime business probe 可用 | 服務可達，不等於盤中監控 ready |
| 監控設定 | revision 0、configured 0、active 0、lease 0 | 未建立正式監控名單／監控 session |
| Gate 0 | evidence current false、ownership complete false、transport authority false | 不得提出 monitor demand |
| physical usage | null | 不得以 0 條 SSE 當作 0 個 subscription |
| 分鐘與基準 | evidence revision 0、baseline item count 0、completed minute 缺少 | 沒有當日可比較的監控 evidence |
| 純接收 STK SSE | 09:06:25.991–09:06:40.997、110 bytes、0 Tick | 此觀測區間只有心跳，不能據此判定股票沒有成交 |
| SSE aggregate count | 前 0、後 0 | 自己的短期接收連線已結束；不證明逐 subscription 已釋放 |
| 本輪寫入／重啟 | subscription 0、broker write 0、login 0、restart 0、notification 0 | 測試只用了固定 loopback GET |

正式 20 檔 stage 沒有開始，今日此片段不計為完整交易日，亦未取得人工擴量核准。

## 上游 capability 與程式責任鏈

1. 實際 `/openapi.json` 的 `SubscriptionResponse` 只有 `success`、`message`、`subscription`。沒有 physical inventory、provider generation、operation correlation 或逐項確認 receipt。
2. `/api/v1/stream/data/contract_event` 是合約資料變更通知；schema 為 `action`、`base_changed`、`info_changed` 等。它不是行情 subscribe／unsubscribe confirmation，不能拿來完成 1.2。
3. 官方 [股票串流文件](https://sinotrade.github.io/tutor/market_data/streaming/stocks/) 顯示 provider event code 16 及 topic；[callback 說明](https://sinotrade.github.io/tutor/callback/event_cb/) 提供 Python event callback。這只能證明 SDK 有相關事件，不能推論當前 HTTP binary 已公開它。官方 [使用限制](https://sinotrade.github.io/zh/tutor/limit/) 仍以 200 subscriptions 表述上限，未補足本案要求的全域 ownership 證據。
4. `vite.config.ts` 呼叫 `intradayMonitorLocalApiGateway({ appSupportRoot })`，沒有注入可運作的監控 runtime factory。
5. `scripts/intraday-monitor-runtime/vite-local-api-gateway.mjs` 預設 `createFeatureOffRuntime`；`startIntradayDemands` 固定拒絕，capacity／diagnostics 為 feature-off 投影。
6. `subscription-coordinator.mjs`、`minute-accumulator.mjs`、`bounded-kbars-bootstrap.mjs` 有可測試元件，但預設 runtime 未把它們接上真實 provider observation／session／lease／repository／trigger chain。
7. 已選擇的 data-only authority sidecar 仍屬待整合方案。見 `transport-authority-decision-2026-09-04.md`；新增本地成功計數器不能補出未知的 provider confirmation。
8. 另查官方 [Shioaji repo](https://github.com/Sinotrade/Shioaji) 與 [rshioaji repo](https://github.com/Sinotrade/rshioaji) 當期根目錄，公開內容為發行／文件／plugin／installer，未找到可在本 repo 直接修補的 HTTP server source。官方 [release note](https://sinotrade.github.io/release/) 已列出 1.7.4；1.7.2–1.7.4 的更新說明沒有明載 physical inventory／subscription confirmation API。1.7.4 tag 的 `STREAMING.md` 更明確說明 `success=true` 只能視為 accepted、不得自行推論剩餘 subscription state，且 `stream/status` 不能證明 symbol 已訂閱。這不證明新版絕無未記載功能，只表示不能以升級可解決 Gate 0 作為已證實結論；本輪沒有升級套件。
9. 已補上 `transport-confirmation-receipt.mjs`，將 `subscription-coordinator.confirmPlan` 改為必須接收 verifier 簽發的 provider receipt。receipt 必須和 plan id、action、generation、physical key、STK topic、event code 16 及短效時間窗完全一致；HTTP 200、clone、過期事件或錯誤 topic 都會拒絕。此防線不會憑空製造上游 telemetry；目前版本仍不能簽發正式 receipt。

## 實際接續順序與驗收界線

以下是既有 1.2／3／4／8.2 的整合缺口，並非另增產品功能：

1. **取得同一既有 simulation session 的 transport telemetry。** 必須有可修改的 HTTP provider source 或上游正式 diagnostics 支援，把 provider generation、operation id、physical topic、subscribe／unsubscribe action 與 callback receipt 關聯。現在 8080 是已安裝 binary，本 repo 不含該實作；不能以重啟、外掛 GET endpoint 或自行產生成功 receipt 代替。
2. **接通唯一的行情 authority。** 使用已核准的 data-only sidecar 方向，逐一接入 5173、5174、smart-order quote consumer；保留原高優先需求與 broker authority 邊界。需要可證實的 bypass 規則與同 generation inventory，才能得出 current physical usage／headroom。
3. **接通 live monitor runtime factory。** 將 lease、admission、canonical Tick、session watermark、bounded bootstrap、minute repository、trigger ledger 與 SSE 串成同一 session；涵蓋 late-open、gap、reconnect 及最後 lease 釋放。不得用前端 state 或硬編碼的 GO 值啟用。
4. **證實 baseline completeness。** 當前 Kbars source 沒有 coverage receipt；原始分鐘資料或起訖錨點仍不能單獨解決缺口／無成交的歧義。應取得來源 coverage 契約，或先以連續 recorder 保存可驗證的前一完整交易日。
5. **核定固定 cohort 與資源預算後開始 20 檔。** Gate 0 通過後才開始完整交易日取證；50／100／160 仍逐階段至少兩日及人工審閱。

第一項是目前無法在既有 binary／OpenAPI 內完成的外部技術依賴。後續不能以「市場已開盤」或「HTTP success」略過它，也不能為本 change 開第二個 login。未取得 telemetry 路徑前，1.2、8.2–8.6、8.9、8.10 均保持未完成。

已建立可審閱、未送出的上游需求稿：`upstream-subscription-diagnostics-request-draft-2026-09-07.md`。當期以 GitHub issue 搜尋 `subscription inventory diagnostics confirmation` 未找到現有同題 issue；送出仍需另行明確授權。

## 本輪交付與檢查

- 實作固定 loopback GET 的 live readiness audit，擷取前後 simulation／monitor projection 與最多 15 秒 STK 專用 SSE。
- 工具限制執行時間、串流 bytes／frame 大小；不保存原始 payload，忽略非 STK 事件；不授予 Gate 0 approval。
- 新增測試涵蓋非 simulation 拒絕、跨 chunk／資料遮蔽、frame 上限，以及健康服務與零連線不得變成 ready。
- 第一輪 targeted regression：3 個檔案、10 項測試通過。補強 transport receipt 後完整非 browser／非 MultiView suite 為 195 個檔案、2,232 項測試通過；OpenSpec strict validation 與 `git diff --check` 通過。
- 沒有重跑先前 200／201 subscription 灌滿探針；同一缺少 diagnostics 的版本無法提供新的 confirmation 證據。

重跑命令（輸出需使用新檔名，不覆寫既有證據）：

```sh
node openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/capture-live-readiness.mjs /absolute/path/to/new-live-readiness.json
pnpm exec vitest run scripts/intraday-monitor-runtime/live-readiness-audit.test.mjs
```
