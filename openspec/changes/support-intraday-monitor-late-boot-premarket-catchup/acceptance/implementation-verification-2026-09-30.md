# 2026-09-30 晚開機盤前接續實作驗證

時間均為 Asia/Taipei。本文件只記錄程式與離線 fixture 驗證，不代表當日真實晚登入、開盤 live SSE 或跨日驗收通過。

## 已完成的程式檢查

- 新增獨立 `RunAtLoad` LaunchAgent 產生器與 `--startup-catchup` 入口；原 08:20／08:35／08:45／08:50 LaunchAgent 未被停止或重載。11:26 後安裝獨立 Agent，當次 `RunAtLoad` 僅記錄逾時 no-op。
- 08:20:00–08:58:59 可作有界接續，08:59:00 起 fail closed。登入後服務未就緒時只做唯讀重查，不啟動 API、不登入、不改 production。
- 無原 08:20 收據時使用獨立 claim／prepared／result receipt；原固定時點收據不補造、不覆寫。固定 08:50 與晚開機路徑共用每日獨占 capture-start claim，既有 capture run registry 仍提供第二層防重。
- 晚開機 generation anchor 須與同日 prepared receipt、session identity、baseline hash、simulation generation 一致；沒有驗證收據時不放寬原 anchor 截止。晚開機採集的正式完整日 acceptance／bundle 資格維持 false，UI/API 標示晚開機與冷啟動風險。
- 前一交易日正式 160 檔基準缺失時 fail closed，不用圖表快取或臨時估值替代。

## 實際命令與結果

- `pnpm exec vitest run scripts/intraday-monitor-runtime/late-boot-policy.test.mjs scripts/intraday-monitor-runtime/late-boot-catchup.test.mjs scripts/intraday-monitor-runtime/premarket-capture-start-claim.test.mjs scripts/intraday-monitor-runtime/premarket-orchestrator.test.mjs scripts/intraday-monitor-runtime/capture-direct-160-stage.test.mjs scripts/intraday-monitor-runtime/local-api.test.mjs src/lib/intraday-monitor-view-model.test.ts`：7 檔、48 項通過。
- `pnpm build`：TypeScript project build 與 Vite build 成功；Vite 回報既有大型 chunk 警告，並非本 change 測試失敗。
- `openspec validate support-intraday-monitor-late-boot-premarket-catchup --strict`：通過。
- `git diff --check`、五個變更模組 `node --check`：通過。
- 新 LaunchAgent plist 經 `plutil -lint -`：`OK`。
- 安裝前唯讀查核既有 `com.alanyi.realtimestock.intraday-premarket` 仍載入且四個原時點仍在；新 plist 當時不存在。隨後執行 `node scripts/intraday-monitor-runtime/late-boot-catchup.mjs --install`，回報 `installed: true`；安裝後 `plutil -lint` 為 `OK`，`launchctl print` 顯示新 Agent `runatload`、08:25／08:40／08:55／08:58 四個事件、`runs = 1`、`last exit code = 0`。
- 2026-09-30 11:26:58 的新增獨立 result receipt 為 `outcome: no_op`、`reason: late_boot_deadline_passed`，證明逾時安裝未建立盤前 session／採集。原 Agent 查核仍為 `state = running`、`runs = 4`，四個原時點保留；未停止或重載既有 Agent。

## 待驗證與限制

- 真實晚登入、session／capture 競態、09:01 canary、逐檔資料活動與通知 Gate 尚未在下一適用交易日觀測。fixture 與 build 不能代替真實 live acceptance。
- 若前一交易日盤後基準本身未建成、使用者至 08:59 後才登入、或既有 simulation business session 未就緒，本機入口會 fail closed，不能保證當日監控成功。
