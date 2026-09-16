# 盤中監控固定 20 檔試辦 Runbook

## 目的與邊界

本 runbook 用於 bounded realtime KBar 的 20 檔 simulation shadow recording。最多 200 檔可設定，但每個 Shioaji process／session 只允許一個固定 20 檔 cohort、一次 subscribe batch、一條專用 KBar SSE 與一次相同 cohort unsubscribe；不輪替、不補位、不擴量。

provider physical counting、global ownership、release 與 headroom 均維持 unknown。HTTP accepted、SSE connection count 或 request 數不得轉寫成 physical usage。50 檔以上不屬本 change。

全程 user-visible feature-off、聲音與系統通知關閉、simulation-only；禁止 production、第二個 login、真實下單、自動服務重啟及週期 Kbars polling。

## 一次性準備固定 Cohort

由使用者在「盤中監控」排序要試辦的 20 檔，再以本機 contract export 建立 receipts。候選必須正好 20 檔；任一缺少、重複或不是台股整股 STK 時整批拒絕：

```sh
node openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/prepare-pilot-cohort-receipts.mjs \
  --execute \
  --candidates=/absolute/path/to/cohort-20.txt \
  --contracts=/absolute/path/to/local-contract-export.json \
  --source-endpoint=http://127.0.0.1:8080/api/v1/data/contracts \
  --source-version=1.7.1 \
  --verified-at=YYYY-MM-DDTHH:mm:ss+08:00 \
  --output=/absolute/path/to/cohort-receipts.json
```

輸出採 `wx` 建立，不覆寫既有檔案。正式 capture 會再驗證 manifest hash 與正好 20 檔。

若 5173 已保存至少 20 個 enabled 商品，可用本機唯讀捷徑直接固定目前排序前 20 檔；工具只讀 simulation info、monitor config 與本機 STK contract export，不提出 subscription：

```sh
node openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/prepare-live-pilot-cohort.mjs \
  --execute \
  --output=/absolute/path/to/cohort-receipts.json
```

## 每個完整交易日 Capture

在 08:50–09:00:30（Asia/Taipei）啟動。超過 09:00:30 即拒絕，當日不得宣稱完整日。需要背景持續執行時，必須使用下列 one-shot launcher；它建立明確 `KeepAlive=false` 的 LaunchAgent，禁止改用會被 launchd 推斷為 keepalive 的 `launchctl submit -p`：

```sh
node openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/launch-bounded-kbar-shadow-once.mjs \
  --execute \
  --cohort-receipts=/absolute/path/to/cohort-receipts.json \
  --trade-date=YYYY-MM-DD \
  --output=/absolute/path/to/kbar-shadow-YYYY-MM-DD.json
```

capture 流程：

1. 固定 loopback `/api/v1/info` 必須回 `simulation=true`。
2. 開一條專用 `/api/v1/stream/data/kbar` SSE。
3. 對 immutable cohort 送一次 `/api/v1/stream/subscribe/kbars`。
4. 每檔剛收到的 KBar 先放 forming；下一個連續 minute 到達後才 seal 前一根。
5. gap、倒序、舊 generation、跨日、負量或 cohort 外事件使受影響商品 degraded，不補 0、不 carry-forward、不 polling 補洞。
6. 13:30 後維持相同 cohort 與 SSE，不得在 13:31 unsubscribe；允許個股延後至 13:33 收盤，並保留 90 秒傳輸寬限期。
7. 最早 13:34:30 由本機 Asia/Taipei close authority seal canonical 13:30 最後一根；若收到合法 13:33 延後收盤 KBar，只把其撮合量併入 13:30 累積端點，不建立額外分鐘。
8. 對相同 cohort 送一次 unsubscribe；只記 accepted，不宣告 provider release。
9. 對完整 20 × 270 evidence 使用專用 4 MiB canonical hash budget；主檔總輸出上限 16 MiB。
10. 主 evidence 以同目錄 temporary file、fsync 與 atomic exclusive link 建立，既有檔案不覆寫；不保存原始 SSE payload。
11. 任一最終化階段失敗只建立 `<output>.failure.json` immutable sidecar，固定 `baselineUsable=false`、`liveCaptureAcceptance=false`，不得把 failure 冒充完整日。

中途 SIGINT／SIGTERM 會嘗試相同 cohort unsubscribe，但 evidence 只能是 partial，不可作 baseline。one-shot job 結束後可保持已載入但 inactive，必須先保存並驗證成功或失敗 outcome，才可由 operator 清除 job 與暫存 plist；不得靠自動重啟補跑。

## 盤中 Partial Rehearsal

若已錯過 09:00:30，可在 regular session 內執行 2–15 分鐘的有界演練，提前驗證固定 20 檔實際 KBar receipt、資源、SSE latency 與停止語意：

```sh
node openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/capture-bounded-kbar-shadow.mjs \
  --execute \
  --mode=partial-rehearsal \
  --duration-ms=180000 \
  --cohort-receipts=/absolute/path/to/cohort-receipts.json \
  --trade-date=YYYY-MM-DD \
  --output=/absolute/path/to/kbar-rehearsal-YYYY-MM-DD.json
```

partial rehearsal 固定輸出 `fullSession=false`、`baselineEligible=false`、`notificationEligible=false`，不具 baseline 或正式驗收 authority，也不得取代任務 8.2 所需的兩個完整交易日。快照前後探針只證明既有行情 API 可用，不等於視覺 K 線新鮮度已驗收。

2026-09-07 實機 rehearsal 顯示非四位數代號會被 endpoint 明確拒絕，`0050`、`0056` 則在其他 18 檔皆有連續 KBar 時沒有逐檔 event；因此本 change 的 live preparation 與 capture 會保守排除非四位數及 `00` 開頭 ETF 代號，仍保留其 configured 設定並顯示 `kbar_contract_unsupported`。

## 完整日判定

每檔都必須具有 09:01–13:30 共 270 個連續 sealed minute，sequence 由 1 到 270，且 close seal 完成。20 檔全部成立時，session 才可標記：

```text
fullSession=true
baselineEligible=true
notificationEligible=false
```

第一個完整日只建立自有 baseline，不產生量比通知。至少第二個適用完整交易日才可用相同 recorder evidence 比較同分鐘累積量。歷史 Kbars 沒有 coverage receipt，只能做診斷，不得補成完整日。

## 每日人工核對

- cohort hash 與 receipt manifest hash 未變。
- 20 檔皆有 270 個 sealed minute；沒有 partial／degraded 商品。
- provider physical usage、release 與 headroom 顯示 unknown。
- notification dispatch、duplicate notification、broker write、production transition、service lifecycle mutation 均為 0。
- CPU、RSS、DB growth、SSE latency 與既有 K 線 freshness 在人工核定預算內。
- chart、watchlist、alert、smart order、MultiView 與 simulation runtime 無新增退化。
- 失敗 evidence 保留，不為通過驗收而刪除或改寫。

## 兩日後驗收

完成至少兩個不同完整交易日後，執行 deterministic replay，抽樣重算每分鐘 cumulative volume、同分鐘 ratio、trigger id／hash 與 unknown reason。自動檢查通過後仍須填寫 `pilot-stage-review-template.md`；人工 GO 只核准本機 20 檔試辦版。

每個完整交易日盤中另保存既有 1m K 線載入新鮮度、可見 canvas、trigger SSE cursor 重連、client connection generation 前進、零重複通知及既有回歸 evidence 引用。正式 evidence 不得為量測而新開或重載完整交易頁面，因頁面初始化可能送出 POST 並建立行情訂閱。

每日候選驗收日不是只有 capture。下列三份同日 evidence 必須全部存在且通過 validator：

- `kbar-shadow-YYYY-MM-DD.json`
- `passive-chart-freshness-YYYY-MM-DD.json`
- `pilot-runtime-assurance-YYYY-MM-DD.json`

盤中必須從已存在且穩定的交易頁面取得兩次同商品、同週期唯讀 DOM observation 與一次 canvas geometry；不得 reload、navigation、click、另開交易頁或送出任何額外 request。將 observation input 保存於 repo 外的暫存檔，再交由 builder 驗證並原子建立正式 evidence：

`acceptance/read-existing-page-passive-chart-input.js` 是只讀頁面腳本；只能在已存在的 5173 盤中選股頁面執行。它不 reload、不 navigation、不 click、不 fetch，等待同一 K 線的 visual commit 推進後回傳 builder input；若 60 秒內沒有推進或 canvas 不可見即 fail closed。自動任務必須保存實際回傳值，不得自行改寫時間、geometry 或 operation ledger。

```sh
node openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/build-passive-chart-freshness-evidence.mjs \
  --execute \
  --input=/absolute/path/to/read-only-observations.json \
  --output=/absolute/path/to/passive-chart-freshness-YYYY-MM-DD.json
```

10:00 後以及收盤後都必須執行每日守門器；`attention` 或 `failed` 必須立即處理／通知，不得只看 capture process healthy：

```sh
node openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/verify-daily-pilot-evidence.mjs \
  --trade-date=YYYY-MM-DD \
  --previous-trade-date=YYYY-MM-DD
```

10:00 後缺少被動 K 線 evidence 會回報 `passive_chart_evidence_overdue`。13:34:30 後任一 capture outcome、chart evidence 或 assurance 缺失／無效會固定 `readyForDailyBundle=false`；不可事後補造盤中 UI observation。

下列 Playwright 工具只供診斷：它會記錄實際 HTTP methods 與 subscribe／unsubscribe request。若偵測到非 GET 或任何 subscription mutation，輸出必須維持 `ready=false`，不得納入正式 bundle：

```sh
node openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/build-passive-runtime-assurance.mjs \
  --execute \
  --chart-evidence=/absolute/path/to/passive-chart-freshness-YYYY-MM-DD.json \
  --previous-trade-date=YYYY-MM-DD \
  --output=/absolute/path/to/pilot-runtime-assurance-YYYY-MM-DD.json \
  --regression-evidence=acceptance/offhours-ui-and-regression-2026-09-04.md \
  --regression-evidence=acceptance/compact-left-panel-ui-2026-09-07.md
```

正式 chart freshness 證據應從已存在且已穩定運作的頁面，對 `[data-chart-diagnostic-schema="candle-chart-passive-freshness/1"]` 至少做兩次唯讀 DOM 觀測；不得 reload、navigation、click、商品／週期切換或另開交易頁面。evidence 只保存 chart code、timeframe、visual commit、source time、canvas 尺寸與零 operation ledger，不保存帳戶、部位、委託或全頁截圖。`build-passive-runtime-assurance.mjs` 另以 GET-only trigger SSE probe 驗證 cursor reconnect；任何 POST 或 subscription mutation 都拒絕。舊 `capture-pilot-runtime-assurance.mjs` 會新開頁面並可能提出 subscription，只保留鑑識用途，不得再作為正式驗收入口。

兩日 capture 與 assurance 都完成後，使用下列工具逐分鐘重播，並將 raw capture 原子組裝成正式 evidence bundle。第一日 replay 固定只有 baseline、trigger count 0；第二日才使用第一日相同 minute 的累積量比較。provider physical usage、global ownership 與 headroom 必須保持 `null`，組裝器拒絕推算值：

```sh
node openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/build-pilot-evidence-bundle.mjs \
  --execute \
  --plan=/absolute/path/to/pilot-stage-plan.json \
  --capture=/absolute/path/to/kbar-shadow-DAY1.json \
  --capture=/absolute/path/to/kbar-shadow-DAY2.json \
  --assurance=/absolute/path/to/pilot-runtime-assurance-DAY1.json \
  --assurance=/absolute/path/to/pilot-runtime-assurance-DAY2.json \
  --gate-evidence=gate-0/kbar-batch-alternative-decision-2026-09-07.md \
  --config-revision=N \
  --threshold=1.5 \
  --calendar-source-version=VERSION \
  --output=/absolute/path/to/pilot-evidence-bundle.json
```

組裝後執行：

```sh
node openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/verify-pilot-evidence.mjs \
  /absolute/path/to/pilot-evidence-bundle.json
```

任何一項資料不完整、既有行情退化、重複事件、通知非零或資源超標，都維持 feature-off。50 檔以上必須另開 OpenSpec change，不得沿用本案自動擴量。
