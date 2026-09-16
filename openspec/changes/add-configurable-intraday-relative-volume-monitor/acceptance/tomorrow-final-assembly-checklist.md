# 盤中監控 20 檔：可信前日基準＋單一完整盤中日總驗收清單

## 目的與不變邊界

2026-09-08 與 2026-09-09 都已固定為失敗證據。2026-09-10 的 20 檔 capture 已完整通過，可作 2026-09-11 的 `live_full_session_verified` baseline；但同日被動 K 線 evidence 與 runtime assurance 未建立，因此 9/10 固定不是「三件式完整盤中驗收日」。本清單改以 9/10 的可信 baseline 搭配經官方交易日 authority 再確認的 2026-09-11，完成一個跨日功能驗收 bundle。若 9/11 自身三件式 evidence、跨日量比重播與所有護欄通過，即可進入人工審閱，不必等待第二個完整 live 日。第二個完整盤中日只作非阻擋穩定性追蹤。

- simulation-only、feature-off、通知關閉。
- 不啟用 production、不下單、不建立第二個 login、不自動啟停服務。
- 不修改 cohort、receipt manifest、stage plan、設定 revision 或門檻。
- provider physical usage、release、global ownership 與 headroom 維持 `unknown`／`null`，不得推算。
- 自動驗證通過不等於人工 GO；最後仍須由使用者／reviewer 明確簽核。

## 已固定且今日不得再改的輸入

| 項目 | 固定值／檔案 |
| --- | --- |
| cohort | 20 檔，與 `pilot-cohort-receipts-2026-09-07.json` 完全一致 |
| plan | `acceptance/pilot-stage-plan-20-2026-09-07.json` |
| Gate 0 | `gate-0/kbar-batch-alternative-decision-2026-09-07.md` |
| config revision | `3` |
| 全域門檻 | `2` |
| baseline capture | `acceptance/kbar-shadow-2026-09-10.json`（capture valid，但不是三件式完整驗收日） |
| 完整盤中驗收候選日 | `2026-09-11`（啟動前仍須由官方 calendar authority 確認） |
| calendar source version | 依 9/10 與 9/11 的實際緊接關係建立，不得預填成已通過 |
| 候選日 capture | `acceptance/kbar-shadow-2026-09-11.json`（13:34:30 後才應原子出現） |
| 候選日被動 K 線證據 | `acceptance/passive-chart-freshness-2026-09-11.json` |
| 候選日 assurance | `acceptance/pilot-runtime-assurance-2026-09-11.json` |

calendar source version 對應[證交所民國 115 年市場開休市資料](https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=html)與[櫃買中心證櫃交字第 11400754581 號公告](https://www.tpex.org.tw/storage/eb_data/11411/11400754581.html)；功能 bundle 必須驗證 9/11 assurance 的 `previousTradeDate=2026-09-10`、cohort hash 一致及 baseline capture hash 正確，不能只憑版本字串宣稱交易日成立。

## 2026-09-09 已封存為 tooling failure

`acceptance/kbar-shadow-failure-2026-09-09.md` 保存原始失敗、log size／mtime／SHA-256、主檔不存在及錯誤 keepalive 已移除的證據。不得建立或補造 `kbar-shadow-2026-09-09.json`，也不得對當日執行歷史升格。

## 2026-09-10 已確認的基準與驗收缺口

`kbar-shadow-2026-09-10.json` 已通過 20／20 檔、每檔 270 個 completed minute、合法 closeMode 與 baseline 驗證，可供 9/11 比較。當日缺少 `passive-chart-freshness-2026-09-10.json` 與 `pilot-runtime-assurance-2026-09-10.json`，每日守門器固定回傳 `readyForDailyBundle=false`。不得事後補造這兩份盤中證據，也不得把 9/10 冒充三件式完整盤中驗收日；此限制不影響其作為 9/11 baseline 的資格。

## 2026-09-11：三件式完整盤中驗收候選日

08:45 先以唯讀檢查確認官方交易日、`simulation=true`、business session、5173／5174、當日輸出不存在且沒有同日 capture。08:50–09:00:30 只啟動一個固定 cohort capture：

```sh
node openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/launch-bounded-kbar-shadow-once.mjs \
  --execute \
  --mode=full-session \
  --cohort-receipts=/Users/alanyi/Documents/RealTimeStock/openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/pilot-cohort-receipts-2026-09-07.json \
  --trade-date=2026-09-11 \
  --output=/Users/alanyi/Documents/RealTimeStock/openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/kbar-shadow-2026-09-11.json
```

盤中從已存在且穩定的盤中選股頁面取得兩次同商品、同週期的唯讀 DOM observation 與 canvas geometry；禁止 reload、navigation、click、另開交易頁或額外 request。將 observation input 暫存在 repo 外，使用 builder 建立同日 chart evidence，再立刻建立 assurance：

```sh
node openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/build-passive-chart-freshness-evidence.mjs \
  --execute \
  --input=/absolute/path/to/read-only-observations-2026-09-11.json \
  --output=/Users/alanyi/Documents/RealTimeStock/openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/passive-chart-freshness-2026-09-11.json

node openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/build-passive-runtime-assurance.mjs \
  --execute \
  --chart-evidence=/Users/alanyi/Documents/RealTimeStock/openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/passive-chart-freshness-2026-09-11.json \
  --previous-trade-date=2026-09-10 \
  --output=/Users/alanyi/Documents/RealTimeStock/openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/pilot-runtime-assurance-2026-09-11.json \
  --regression-evidence=acceptance/offhours-ui-and-regression-2026-09-04.md \
  --regression-evidence=acceptance/compact-left-panel-ui-2026-09-07.md
```

09:15 後開始檢查每日守門器；10:00 後若仍缺 chart evidence 或 assurance 必須立即通知及處理。任何 existing output 都不覆寫：

```sh
node openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/verify-daily-pilot-evidence.mjs \
  --trade-date=2026-09-11 \
  --previous-trade-date=2026-09-10
```

13:34:30 後先驗證 capture，再重跑每日守門器。只有 `status=complete` 且 `readyForDailyBundle=true`，並能對 9/10 baseline 重算 9/11 量比，才可把 9/11 計為三件式完整盤中驗收日。

## 單一完整盤中日功能 bundle 組裝

`build-pilot-evidence-bundle.mjs` 已支援功能 bundle：使用一份 `live_full_session_verified` 前日 baseline capture，或 20 份逐商品 `historical_baseline_verified` immutable manifest，搭配一個三件式完整盤中日。builder／validator 會驗證前後交易日 authority、cohort／設定／門檻、20 檔 baseline、hash 引用、跨日量比重算及零不完整資料誤報；舊的多日 live 輸入仍保留供相容與非阻擋穩定性追蹤。

9/11 收盤後，只有每日守門器已回傳 `readyForDailyBundle=true` 才可執行以下命令。`OFFICIAL_CALENDAR_VERSION` 必須換成當日實際查核並保存的官方日曆來源版本；output 採不可覆寫建立，已存在時會 fail closed：

```sh
node openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/build-pilot-evidence-bundle.mjs \
  --execute \
  --plan=openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/pilot-stage-plan-20-2026-09-07.json \
  --baseline-capture=openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/kbar-shadow-2026-09-10.json \
  --capture=openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/kbar-shadow-2026-09-11.json \
  --assurance=openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/pilot-runtime-assurance-2026-09-11.json \
  --gate-evidence=gate-0/kbar-batch-alternative-decision-2026-09-07.md \
  --config-revision=3 \
  --threshold=2 \
  --calendar-source-version=OFFICIAL_CALENDAR_VERSION \
  --output=openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/pilot-evidence-bundle-2026-09-10_2026-09-11.json

node openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/verify-pilot-evidence.mjs \
  openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/pilot-evidence-bundle-2026-09-10_2026-09-11.json
```

若 9/10 的 live baseline 不可用，僅可在 20 檔都已通過正常歷史 1 分 K 驗證時，移除 `--baseline-capture`，改為逐檔傳入：

```sh
--historical-baseline-manifest=/absolute/path/to/2330.TW-2026-09-10.json
```

`--baseline-capture` 與 `--historical-baseline-manifest` 互斥；歷史模式必須完整提供計畫 cohort 的每一檔 manifest。不得混用、漏檔或手工拼裝 JSON。

第二個完整盤中日 MAY 在下一個經官方日曆確認的交易日（預計 9/14）依相同三件式流程執行，作為穩定性追蹤；它不是 9/11 功能 bundle、人工審閱或歸檔的必要輸入。若追蹤發現退化，必須重新開啟風險與修正工作。

## 人工審閱與 manifest 最後只需填的欄位

複製 `acceptance/pilot-stage-review-template.md` 為 `acceptance/pilot-stage-review-2026-09-11.md`，逐項填寫 baseline 與 live day、bundle hash、抽樣重算、資源實測、未解風險與 GO／NO-GO。不得由工具代替 reviewer 簽核。

由 `acceptance/acceptance-dossier.manifest.pending.json` 另存新的 final candidate manifest，只改下列欄位；其他既有 evidence 分類保持不動：

```json
{
  "gate0": {
    "reviewerSignoff": true,
    "reviewedAt": "REVIEWER_ISO_8601"
  },
  "stage20": {
    "decision": "go",
    "approvedActiveMonitorCount": 20,
    "bundle": "acceptance/pilot-evidence-bundle-2026-09-10_2026-09-11.json",
    "review": "acceptance/pilot-stage-review-2026-09-11.md",
    "reviewerSignoff": true,
    "reviewedAt": "REVIEWER_ISO_8601"
  },
  "formalActiveMonitorLimit": 20,
  "unresolvedRisksReviewed": true,
  "finalReviewerSignoff": true,
  "finalReviewedAt": "REVIEWER_ISO_8601"
}
```

`unresolvedRisks` 不刪除；人工確認已審閱代表接受限制，不代表風險不存在。再把下列 baseline／完整盤中日 evidence 加入適當分類：

- `acceptance/passive-chart-freshness-2026-09-11.json`
- `acceptance/pilot-runtime-assurance-2026-09-11.json`
- `acceptance/kbar-shadow-2026-09-10.json`
- `acceptance/kbar-shadow-2026-09-11.json`
- `acceptance/pilot-evidence-bundle-2026-09-10_2026-09-11.json`
- `acceptance/pilot-stage-review-2026-09-11.md`

## 建立並驗證最終 dossier 候選

```sh
node openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/build-acceptance-dossier.mjs \
  --execute \
  --manifest=/absolute/path/to/acceptance-dossier.manifest.final.json \
  --output=/absolute/path/to/acceptance-dossier.final.json

node openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/verify-acceptance-dossier.mjs \
  /absolute/path/to/acceptance-dossier.final.json

pnpm test
pnpm build
git diff --check
openspec validate add-configurable-intraday-relative-volume-monitor --strict
```

只有 dossier 回傳 `valid=true`、`readyForArchive=true`，全部測試／build／strict validation 通過，且人工簽核內容與實際 evidence 一致，才能勾選 8.2、8.3、8.9、8.10 並提出歸檔候選。歸檔、commit、push 仍是分開授權，不在本清單自動執行。
