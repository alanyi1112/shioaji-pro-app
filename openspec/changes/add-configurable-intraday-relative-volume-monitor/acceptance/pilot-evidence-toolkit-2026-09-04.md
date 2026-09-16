# 分階段試辦 Evidence 工具包實作紀錄

## 文件資訊

- Change：`add-configurable-intraday-relative-volume-monitor`
- 準備範圍：任務 8.2–8.6 的前置工具
- 日期：2026-09-04（Asia/Taipei）
- 實際任務進度：52／60，任務 8.2–8.6 仍未完成
- 安全狀態：Gate 0 NO-GO、feature-off、simulation-only、通知關閉

## 已完成工具

### 版本化 evidence contract

`pilot-shadow-evidence.mjs` 定義並驗證：

- `intraday-monitor-pilot-stage-plan/1`
- `intraday-monitor-pilot-sample/1`
- `intraday-monitor-pilot-session/1`
- `intraday-monitor-pilot-evidence-bundle/1`

Stage Plan 保存固定 20 檔 cohort、cohort receipt manifest hash、最低 active 監控檔數及人工核定的 CPU／RSS／DB 成長／SSE latency／K 線新鮮度預算。provider physical usage、global ownership 與 headroom 不可由 request 或 connection 數推算，sample 必須保存為 `null`。canonical symbol 不得重複。plan 固定要求兩個完整交易日、user-visible feature-off、notifications disabled、simulation-only，並明示沒有 provider request、automatic subscription、subscription transport、service lifecycle 或 broker write authority。

每個 session 綁定 plan hash、交易日、上一交易日、calendar source version、connection generation 與 coverage。sample 保存 admission、未知 ownership／physical usage／headroom、minute completeness、trigger／notification／禁止 mutation 計數及 CPU、RSS、DB、SSE latency、K 線新鮮度。CPU 使用整數 basis points，避免浮點數破壞 canonical hash。

### Shadow recorder

recorder 只接收已由外部受控流程取得的 sample，不直接呼叫 provider、不建立 subscription、不啟停服務、不送 broker write。sample 必須依時間與 completed minute 單調前進，單一 session 最多 10,000 筆；finish 後不可再追加。

### 自動 validator

`validateIntradayMonitorPilotEvidenceBundle` 只有在以下條件全部成立時輸出 `readyForHumanReview=true`：

- 至少兩個不同的完整交易日，coverage 為 09:01–13:30；
- 每日 close authority 不早於 13:34:30，每檔具有一般／修訂 13:30 或延後 13:33 的合法 `closeMode`，且沒有補造 13:31–13:33 regular-minute rows；
- 每個交易日最終具有「當日最大 active 監控檔數 × 270」以上的完整 minute evidence；
- configured 等於固定 cohort 數、eligible／active 不低於 plan 核定下限，且沒有 degraded；
- Gate 0 evidence 與 global ownership 全程完整；
- provider physical usage、global ownership 與 headroom 明確為 unknown，且 active cohort 固定不超過 20；
- CPU、RSS、單日 DB growth、SSE latency 與 K 線 freshness 都不超過 plan 的人工核定預算；
- incomplete data trigger、通知、重複通知、broker write、production transition 與 service lifecycle mutation 全部為 0；
- replay 已執行且 trigger count 可重算一致；
- 至少一次 reconnect 成功且 connection generation 前進；
- chart、watchlist、alert、smart order 與 simulation runtime 均無退化。

validator 通過不會自動核准擴量，仍須使用人工審閱表完成任務 8.3 或後續階段 go／no-go。

### 操作工具與文件

- `prepare-pilot-cohort-receipts.mjs`：從固定候選與既有本機 contract export 建立逐商品 receipts，不發出網路請求。
- `prepare-pilot-stage-plan.mjs`：只接受已驗證 receipt manifest，並要求明確輸入資源預算；使用 `wx`，拒絕覆寫既有 evidence。
- `verify-pilot-evidence.mjs`：唯讀驗證 evidence bundle；合格回傳 exit code 0，未達人工審閱條件回傳 1，輸入錯誤回傳 2。
- `capture-pilot-runtime-assurance.mjs`：診斷用 Playwright 量測；保存實際 HTTP methods 與 subscription mutation。新開完整交易頁面若觸發 POST／subscribe，輸出必須 `ready=false`，不得作正式 assurance。
- `build-pilot-evidence-bundle.mjs`：驗證兩日 raw capture／assurance、逐分鐘重播量比，再建立 canonical bundle；拒絕 partial、cohort 漂移與任何 physical usage 推算。
- `verify-premarket-readiness.mjs`：離線核對 simulation／feature-off／Gate 0／capacity／calendar／authority 與 evidence 目錄，不發出網路請求。
- `verify-acceptance-dossier.mjs`：核對總卷結構、reviewer sign-off 與所有 evidence 檔案 SHA-256。
- `pilot-stage-runbook.md`：記錄前置條件、每日程序、停止條件與逐級擴量順序。
- `pilot-stage-review-template.md`：人工抽樣重算、資源判讀及 reviewer 決策表。
- `pilot-stage-cohort-20.synthetic.txt`：只供 plan parser／CLI 測試的合成 canonical 格式 fixture，不代表正式商品 cohort 或行情證據。

## 驗證結果

```text
Targeted tests: 13 passed
Project test files: 194 passed
Project tests: 2226 passed
Node syntax checks: passed
Cohort receipts → stage plan → NO-GO preflight CLI smoke: passed
Pending dossier integrity check: passed with readyForArchive=false
```

CLI smoke 使用明確標示為 synthetic 的 20-item fixture，依序建立 cohort receipts 與含資源預算的 stage plan，確認兩者 hash 皆為 64 字元 SHA-256，且 provider request、subscription transport、service lifecycle 與 broker write authority 全部為 false。NO-GO runtime fixture 被 preflight 正確拒絕；此結果不代表正式 cohort、預算或 Gate 0 已核准。

## 尚未完成與禁止誤標

本文件只證明「試辦工具已準備」，不證明任一容量階段已通過。任務 8.2 仍需 Gate 0 先轉為 GO，並在正式核准的 simulation shadow 流程下完成 20 檔至少兩個完整交易日；8.3–8.6 仍依序需要人工核准與各自的兩日 evidence。現在不得執行新增盤中監控 subscription，也不得把 52／60 改寫為更高進度。
