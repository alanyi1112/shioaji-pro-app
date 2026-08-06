## Context

目前台股籌碼背景工作由 GitHub Actions cron 啟動 `scripts/tdcc-history-backfill.mjs`。Sites Worker 已負責 D1 queue、lease、ingest、最新 TDCC 儲存與日籌碼資料 API，但 runner 仍負責目標同步、最新快照、日籌碼批次與流程順序。這使產品的核心回補決策沒有隨網站部署，也讓非交易日的 calendar-day 判斷、單次 40 檔截斷與重試狀態難以從正式 health 查證。

Codex Sites 目前沒有可由專案設定的 cron binding，因此變更必須同時支援 Worker `scheduled` handler 與受保護 HTTP tick。TDCC 歷史表單則需要 session、來源節流與較長執行時間，現階段仍不適合直接放進單次 Worker request。

## Goals / Non-Goals

**Goals:**

- 將目標同步、TDCC 最新快照、日籌碼批次挑選、冷卻、heartbeat、續跑與完成判定部署到 Sites Worker。
- 以 D1 保存每次 orchestrator run 的 phase、預期交易日、進度、剩餘 due 與安全錯誤碼。
- 讓 GitHub Actions 只重複呼叫受保護 tick，並在需要時執行分離的 TDCC 歷史 source adapter。
- 將每日日籌碼維護與每週 TDCC 發布檢查拆成獨立 scope，避免每日執行低頻週資料流程。
- 新增商品啟用後立即啟動日籌碼預熱與 TDCC queue／目標環境 workflow dispatch，不等待下一次 cron。
- 讓週末與收盤前執行使用 Asia/Taipei 最近已完成交易日，避免要求尚不存在的資料日期。
- 維持既有資料 API、D1 rows 與歷史回補 queue 契約相容。

**Non-Goals:**

- 不把 TDCC 歷史可見表單的 session 模擬搬進 Worker。
- 不以工作日推算取代官方 `sourceDate`；假日或來源延遲仍須由 coverage 與來源狀態判定。
- 不新增公開或未授權的排程控制入口。
- 不改變 K 線與副圖前端資料格式。

## Decisions

### 1. Worker 擁有 orchestrator 狀態，外部排程只提供時鐘

新增 `chip-backfill-orchestrator` 模組與 D1 run table。受保護的 `start`／`tick` action 與 `scheduled` handler 呼叫相同程式；GitHub workflow 不再自行決定 latest、daily 的 symbol 或完成條件。

替代方案是保留完整 Node runner。這無法滿足「程式部署到網站 runtime」且會繼續產生兩套流程決策，因此不採用。

### 2. 每個 tick 使用有限批次與 attempt cooldown

Worker 每次只處理可在 request 時限內完成的小批次，完成後重新計算 due；同一 symbol 最近嘗試過即暫時略過，避免來源延遲或 429 讓同輪一直挑到同一檔。D1 run 記錄累積處理數與剩餘 due，外部喚醒者只依 `done` 決定是否再 tick。

替代方案是單次 request 跑完所有 symbol。日籌碼上游請求時間不穩定，容易超過 Worker 執行限制，因此不採用。

### 3. 預期終點使用最近已完成交易日

以 Asia/Taipei 計算：週末回退至週五；平日資料發布安全截止時間前回退至上一個平日。此值只作為「預期 coverage」；ready 仍必須由各 dataset 實際 `coverage_end` 或 `sourceDate` 證明。

沒有內建完整交易所假日日曆是已知限制。假日當天若回推到尚未交易的日期，系統會標示 `source_not_published` 並冷卻，而不偽造成功。

### 4. TDCC 歷史來源採分層 adapter

Worker／D1 繼續擁有 target、claim、plan、lease、validator、ingest 與完成狀態；GitHub 端只執行需要瀏覽器式 session 的歷史來源讀取。runner 增加 `--history-only`，不得重複執行 latest 或 daily orchestration。

### 5. Health 僅揭露安全營運欄位

`/api/health` 增加 orchestrator trigger、phase、expectedSessionDate、processedSymbols、remainingSymbols、heartbeat 與 allowlist error reason；不得回傳授權 header、secret、使用者清單或上游完整回應。

### 6. Workflow 以安全摘要與受保護 abort 收斂失敗

start／tick 回應另提供固定 schema 的 workflow summary，只允許 phase、status、三個非負計數與 allowlist reason。workflow 每次 tick 只輸出此摘要，不輸出完整 response；HTTP timeout、非成功狀態、schema 無效或 tick 上限會觸發 `orchestrator-fail`。Worker 以同一安全 reason 冪等關閉 `chip_backfill_orchestrator_runs` 與 `tdcc_continuous_runs`，後者依既有 retry 規則保存 `next_retry_at`。

替代方案是讓 shell 直接更新 D1 或只以 workflow failure 結束。前者破壞 Worker／D1 所有權邊界，後者已在正式 schedule 證明會遺留 `running`，因此不採用。

### 7. 每日與每週工作以 scope 拆分

orchestrator run 保存 `daily`、`tdcc-weekly` 或相容舊入口的 `combined` scope。每日 workflow 於 Asia/Taipei 22:30 喚醒 `daily` scope，只處理日籌碼 due symbols；TDCC workflow 於週六 22:30 檢查官方週快照，並於週日同時段提供一次有限重試，只處理最新週快照與歷史 source adapter。兩者使用獨立 run id，health 也回報 scope，避免一方失敗遮蔽另一方結果。

替代方案是只把原本整條 workflow 改為每週。這會讓日籌碼失去每日維護，也會讓新增商品等待週末，因此不採用。

### 8. 新增商品使用立即回補與耐久 queue 雙軌

商品儲存成功後的 `waitUntil` 背景工作先註冊 TDCC target 與 queue，再立即預熱日籌碼，並依 `DEPLOYMENT_TARGET` dispatch Sites 或 Cloudflare 的 TDCC workflow。dispatch 不阻塞儲存回應；token 缺少或 GitHub 暫時失敗時，既有 D1 queue 不得被清除，後續每週排程仍可接續。

替代方案是只註冊 target 等待 cron。這會讓新商品的副圖在數日內沒有資料，不符合立即回補需求，因此不採用。

## Risks / Trade-offs

- [Sites 尚未提供 cron binding] → 同時部署 `scheduled` handler，現階段由 GitHub cron 對受保護 HTTP tick 提供時鐘；未來可直接切換 binding 而不改業務流程。
- [交易所假日不是單純週末] → 以官方 coverage 為最終證據，標示 `source_not_published` 並等待下一輪，不把預期日期寫成來源日期。
- [上游限流使單輪無法全部完成] → 有限批次、attempt cooldown、D1 heartbeat 與剩餘 due 允許跨 tick／跨排程安全續跑。
- [外部歷史 adapter 仍是 GitHub runtime] → 僅保留 Worker 不適合執行的來源 session；所有權威 queue 與寫入仍在 Sites。
- [新 migration 部署失敗] → table 採新增式 migration，不改既有 rows；回滾程式時舊流程仍可讀原有 TDCC 與 daily tables。
- [外部時鐘在完成前耗盡 tick] → workflow 以 allowlist 摘要保留 phase／計數／reason，trap 呼叫受保護失敗終結點；Worker 將 run 關閉為 failed／retry-waiting，下一次排程可使用新 run id 接續。

## Migration Plan

1. 新增 orchestrator D1 table 與 Worker runtime 建表保護。
2. 部署 start／tick control action、scheduled handler、交易日與 cooldown 邏輯。
3. 將 workflow 拆成每日 `daily` 與每週 `tdcc-weekly` 薄型 tick；只有後者再以 `--history-only` 執行歷史來源 adapter。
4. 完成單元、整合、OpenSpec strict 與正式 owner-only health 驗證。
5. 以模擬 tick 上限、HTTP 失敗與重複 abort 驗證安全摘要、failed／retry-waiting 與歷史 adapter skip。
6. 若新流程異常，可暫時回復前一 Sites version 與 workflow commit；新增 table 保留，不影響既有讀取。

## Open Questions

- Codex Sites 何時提供可設定的 cron trigger；提供後可移除 GitHub HTTP wakeup，但不需改 orchestrator。
- 是否導入官方交易日曆資料集，讓長假期間不必依 `source_not_published` 冷卻。
