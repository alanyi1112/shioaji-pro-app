# 正常歷史 1 分 K 基準與單一完整盤中日 bundle 離線驗證

## 結論

2026-09-10 已完成正常前一交易日 `historical_baseline_verified` 流程，以及「可信前日 baseline＋一個三件式完整盤中日」功能 bundle 的純離線實作與驗證。此次作業沒有連接行情 API、8080 或 SSE，沒有占用或重啟 5173／5174，且沒有取得 production、broker write、通知、subscription transport 或服務生命週期權限。

本次只完成工具與離線驗證。尚未建立 2026-09-11 的正式盤中 evidence、功能 bundle、人工審閱或 final dossier，也沒有將第二個完整 live 日維持為功能硬門檻。

## 正常歷史基準實作

- 新增正常歷史 1 分 K candidate／manifest schema，provenance 固定為 `historical_baseline_verified`。
- authority 必須證明官方交易日、緊接前一交易日、Asia/Taipei、simulation、前日已於 13:34:30 後定稿，且執行時間早於目標交易日 09:01。
- 逐商品執行有界雙重 fetch，驗證商品身分、交易所、來源／版本、原始與 canonical 單位、OHLC／Volume／Amount 等長結構、270 個 canonical minute、收盤總量、known-zero 及 13:33 延後收盤 canonicalization。
- 相同來源版本兩次 payload hash 不一致、缺分鐘無零成交證據、收盤量不符、分鐘或累積量倒退及 authority 不明時，均逐檔 fail closed。
- 新增獨立 SQLite repository，提供 monotonic revision、immutable／冪等寫入、來源 payload conflict 與 logical baseline conflict detection。
- baseline resolver 優先序為 `live_full_session_verified`、`historical_baseline_verified`、`historical_repaired_verified`；正常歷史來源只在找不到合法 live baseline 時才取用。
- worker 固定 `baselineUsable=true`、`liveCaptureAcceptance=false`，通知、retroactive trigger、broker write、production 與服務生命週期 mutation 都為 0。

## 功能 bundle 實作

- 新增 `intraday-monitor-functional-acceptance-bundle/1`。
- 接受且只接受下列其中一種 baseline：
  - 一份完整的 `live_full_session_verified` 前日 capture。
  - 與固定 plan cohort 完全一致的逐商品 `historical_baseline_verified` manifests。
- 搭配唯一一個完整盤中 capture 與同日 runtime assurance，驗證前後交易日、cohort、設定 revision、門檻、baseline hash、完整分鐘、跨日量比重播、零 unknown、零不完整資料誤報及既有功能無退化。
- 舊的多日 live bundle builder／validator 保留相容；第二個完整 live 日只作非阻擋穩定性追蹤。
- CLI 使用不可覆寫的新檔建立；`--baseline-capture` 與重複的 `--historical-baseline-manifest` 互斥。
- verifier 依 bundle schema 自動選擇功能或舊版驗證器。

## 自動化與操作清單

- 08:45 heartbeat 已由「兩個新三件式完整日」修正為「可信前日 baseline＋一個三件式完整盤中日」。
- 2026-09-10 的完整 20 檔 KBar capture 可作 2026-09-11 的 live baseline；9/10 仍不得冒充三件式完整盤中驗收日。
- 2026-09-11 若三件式 evidence 與功能 bundle 全部通過，即可進入人工審閱；不必等待第二個完整 live 日。
- 詳細命令與 fail-closed 邊界已更新於 `acceptance/tomorrow-final-assembly-checklist.md`。

## 驗證結果

執行：

```sh
pnpm vitest run \
  scripts/intraday-monitor-runtime/historical-kbar-baseline.test.mjs \
  scripts/intraday-monitor-runtime/historical-kbar-repair.test.mjs \
  scripts/intraday-monitor-runtime/pilot-acceptance-bundle.test.mjs
```

結果：3 個檔案、42 項測試通過。涵蓋正常歷史 baseline 成功、雙抓不一致、缺分鐘、known-zero、延後收盤、前置連續性、量倒退、authority／單位錯誤、live 優先、repository conflict、零副作用、live／歷史兩種功能 bundle、tamper rejection、CLI 建立與 verifier round trip，以及舊 bundle 相容。

執行：

```sh
pnpm test
pnpm build
openspec validate add-configurable-intraday-relative-volume-monitor --strict
git diff --check
```

結果：

- `pnpm test`：218 個檔案、2,369 項測試通過。
- `pnpm build`：通過；只有既有大型 chunk 提示，沒有 build error。
- OpenSpec strict validation：通過。
- `git diff --check` 與本次新增檔案行尾空白檢查：通過。

## 尚未完成

- 2026-09-11 的三件式完整盤中驗收 evidence 與正式功能 bundle。
- 人工抽樣、GO／NO-GO、reviewer sign-off。
- final acceptance dossier 與所有 required artifacts 的最後一次完整驗證。
- 歸檔、commit、push；本次均未執行。
