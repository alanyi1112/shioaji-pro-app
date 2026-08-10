## 驗證摘要

本 change 將台股籌碼 latest／daily 回補編排部署到 Sites Worker，GitHub Actions 只提供受保護 HTTP tick；需要 TDCC 可見表單 session 的歷史來源則以 `--history-only` adapter 保留在外部 runtime。

## 2026-08-10 真實 TDCC schedule 終驗

- 以 GitHub Actions 現場紀錄重新核對 run `31319918169`：workflow 為 `TDCC continuous backfill`、event 為真實 `schedule`、conclusion 為 `success`，執行 commit 為 `7e91236c3a668e6e631fecfb922292c57464625d`。
- allowlist 摘要為 `chip-orchestrator tick=start scope=tdcc-weekly status=completed phase=completed processed=0 remaining=0 pending=0 reason=none recovery=none`；D1 orchestrator 已進入完成終態，沒有停留在 `running`、`failed` 或 `retry_waiting`。
- Orchestrator 成功後才執行 `--history-only --trigger=schedule --run-id=gha-31319918169-1`；既有終驗確認本輪為 0 symbol／0 week 的成功 no-op，未重新執行 TDCC latest 或日籌碼編排。
- 此證據已涵蓋 task 5.7 原始契約要求的真實排程、安全摘要、D1 終態與 history adapter 邊界，因此 task 5.7 完成。先前瀏覽器無法直接開啟私有 `/api/health`，不再被誤當成排程契約本身未完成。

## 2026-07-30 每日／每週拆分與新增商品立即回補（本機）

- orchestrator run 新增 `scope` D1 欄位與安全摘要：`daily` 只做日籌碼 discovery／預熱，`tdcc-weekly` 只做 TDCC 最新週快照與歷史 adapter；既有 `combined` 僅保留相容性，新排程不再使用。
- Sites／Cloudflare 均新增獨立日籌碼 workflow，維持 `30 14 * * *`（Asia/Taipei 每日 22:30）；原 TDCC workflow 改為 `30 14 * * 6,0`（週六 22:30 檢查、週日同時段一次有限重試）。
- 新商品儲存後以 `waitUntil` 立即執行日籌碼預熱，同時註冊 TDCC target、建立耐久 queue，並依 `DEPLOYMENT_TARGET` dispatch Sites 或 Cloudflare 對應 TDCC workflow；dispatch 未設定或失敗時 queue 保留，商品儲存不受阻塞。
- daily run 失敗只收尾 daily orchestrator，不建立或改寫 TDCC continuous run；TDCC weekly 仍沿用 failed／retry-waiting 收尾契約。
- 本機最終門檻：production build 通過；`npm test` 342 passed、0 failed；`npm run lint` 0 warnings；OpenSpec change strict validation 通過；`git diff --check` 通過。
- 實作 commit `05e0a75737058d2f54f9c04a7a66a2ca767e1f94` 已推送 GitHub `main` 與 Sites source；Sites 保留站 version 162 私有部署成功。
- Cloudflare 正式站 push run `30540190148` 成功：Free-tier budget、D1 additive migration、exact commit deploy、匿名 Access 邊界與 protected smoke 全數通過，rollback 未執行。

## 2026-07-27 正式排程失敗修復（本機）

- 真實 `event=schedule` runs `30164064792`、`30208638424` 都在 `Wake Sites chip backfill orchestrator` 失敗；兩次皆跑完 60 次 tick 仍未取得 `done=true`，history adapter 因前一步失敗而跳過。這證明原本只檢查 `.done` 的 workflow 會缺少安全診斷，且可能讓 D1 run 長期停在 `running`。
- start／tick 回應新增固定 `summary`，只含 `status`、`phase`、`processedSymbols`、`remainingSymbols`、`pendingSymbols` 與 allowlist `reason`；workflow 每次只輸出這些欄位，不輸出完整 response、header、cookie 或 secret。
- workflow 遇到 HTTP timeout、非成功狀態、schema 無效或 60 次 tick 上限時，會以固定 reason 觸發受保護 `orchestrator-fail`；Worker 冪等關閉 orchestrator 與 TDCC run，`tick_limit_exceeded`／timeout 等可重試失敗保存為 `retry_waiting` 與 `next_retry_at`。
- Worker 自身在 start／tick 例外時也執行相同雙 run 收尾；已完成 run 不會被改寫為失敗，已失敗 run 重送不會延後既有 retry 時間。
- shell 模擬已實際執行 60 次 `done=false` 與 HTTP timeout 兩條路徑：兩者皆以非零狀態退出、history adapter 不會接續，且 finalize 摘要分別顯示 `tick_limit_exceeded`／`timeout` 與 `recovery=retry_waiting`，測試內注入的秘密欄位未出現在輸出。
- 本機最終門檻：production build 通過；`npm test` 258 passed、0 failed；`npm run lint` 0 warnings；`openspec validate --all --strict` 26 passed、0 failed；`git diff --check` 通過。
- 修復 commit `7072962b2def19f8da565f7c58c1514de049d95b` 已推送至 GitHub `main` 與 Sites source；相同完整 HEAD 已保存並成功發布為 owner-only Sites version 142，正式 URL 維持 `https://quote-chart-multiview.alanyi1112.chatgpt.site`。
- 本輪未觸發 `workflow_dispatch`。部署後嘗試以既有瀏覽器 session 唯讀讀取正式 `/api/health`：Chrome 直接 API 導航被 client 阻擋，Codex 內建瀏覽器則停在登入頁，因此沒有把控制面成功、匿名／未登入邊界或舊 health 冒充新的 D1 驗證，也沒有建立或輪替 bypass token。人工重跑與下一次真實 `event=schedule` 必須分開記錄。

## 本機驗證

- `npm test`：通過，250 tests passed、0 failed；包含 production build。
- `npm run lint`：通過，0 warnings。
- `openspec validate --all --strict`：通過，25 items passed、0 failed。
- `git diff --check`：通過。
- 新增測試涵蓋：
  - Asia/Taipei 收盤後、收盤前與週末的最近已完成交易日。
  - pending symbol 的 attempt cooldown 與後續 symbol 公平挑選。
  - orchestrator run 的冪等 start、symbol 去重、有限批次進度與完成終態。
  - D1 migration、Worker `scheduled` handler、安全 health 欄位。
  - GitHub workflow 僅呼叫 `orchestrator-start`／`orchestrator-tick`。
  - TDCC runner 的 `--history-only` 邊界。

## 安全與排程邊界

- Sites control plane 仍要求 `TDCC_CONTINUOUS_BACKFILL_SECRET`，owner-only 網站另受 Sites access 保護。
- GitHub workflow 不輸出 response、token、cookie 或 secret，且未啟用 shell tracing。
- `scheduled` handler 已隨 Worker 發布；Codex Sites 尚未提供專案 cron binding 時，由 GitHub 真實 `schedule` event 於 `30 14 * * *`（Asia/Taipei 22:30）喚醒相同 Worker orchestrator。
- 本次部署驗證若使用受保護 endpoint，只能標示為部署 smoke；不得冒充下一次 GitHub `event=schedule` 證據。

## 正式環境

- GitHub `main` 已推送 commit `818558afd43c63eeef9cab6494701ba484248891`。
- 相同 commit 已推送 Sites source，保存為 owner-only Sites version 135 並成功部署。
- 已登入正式 `/api/health`：HTTP 200、`runtime=codex-sites`。
- `taiwanStockChip.backgroundOrchestrator`：
  - `configured=true`
  - `status=idle`
  - `runtime=sites-worker`
  - scheduler contract 為 `sites-scheduled+protected-http-tick`
  - `batchSize=1`、attempt cooldown 為 4 小時、台北發布安全截止為 22 時
- 日籌碼 health：
  - window end 為 `2026-07-24`，週六沒有再要求 `2026-07-25`
  - target 43、ready 22、pending 21、retry waiting 5
  - pending 保留實際來源 coverage／`rate_limited`，未以請求日期冒充成功
- TDCC continuous health：
  - latest source date `2026-07-17`
  - target 43、completed 43、queued/running/blocked 皆為 0
  - scheduler 顯示 `sites-worker-orchestrator`
- 匿名請求正式 `/api/health`：HTTP 401，owner-only 邊界有效。
- 本次未手動觸發 GitHub workflow；version 135 的 `idle` 只證明 migration、health 與部署程式可用，下一次 `30 14 * * *` 真實 `event=schedule` 才能證明自動 tick 實際執行，不得以本次部署 smoke 冒充。
