# 實作與驗收證據

## 現況責任鏈與固定契約

- 實作前的 `/api/internal/candle-continuity-audit` 只從 `user_instruments.enabled=1` 取得候選商品，因此內建頁籤與相容 `instrument_catalog` 商品可能未被每日稽核涵蓋。
- 新責任鏈以 `stock_setup.md` 內建啟用商品與啟用個人清單建立 `DISTINCT symbol` 快照；active 商品目錄只補充 eligibility／active metadata，不單獨擴張 target set。沿用既有普通股／ETF eligibility，排除 index、warrant、future、option、非 `.TW/.TWO` 與停用商品。
- 既有稽核核心上限保持不變：每檔最多 6 個未快取官方月份、每次 8 秒 timeout、可重試錯誤最多再試一次、相同 `symbol + month` single-flight、D1 月 cache 與 payload 精準失效。正式實測後 automation 收斂為每 tick 只 claim 1 檔、每個 HTTP tick 最多新抓 4 個月份；每檔內月份查詢仍最多 2 個並行。
- `expected session` 沿用台北交易日與 15:00 收盤完成判定；同日晚間 `reference_not_published` 保持 retry waiting，次日台北 10:00 checkpoint 後仍未解決者轉為 `overdue`，全域完成不得遮蔽逐商品 degraded。

## Durable D1 與本機 fixture

- Migration：`0026_daily_candle_continuity_automation.sql`，新增 `candle_continuity_runs`、`candle_continuity_run_items`、唯一鍵、priority queue、lease 與最近 run health index；Drizzle schema、journal、snapshot 與非 migration-managed 本機相容建表同步完成。
- 本機 D1-compatible ephemeral fixture 完成 55 檔 run：1 檔 fresh skip、54 檔分 7 個 tick 完成，每 tick 不超過 8 檔，沒有遺漏或重複；最終 aggregate 為 target 55、processed 55、remaining 0、complete 55。
- 同一 fixture 驗證相同 run start 冪等、run 中清單變動不改快照、lease 過期接手、舊 owner 拒寫、retry waiting／resume、部分完成後 fail 保留、checkpoint 25 檔 overdue 與 anomaly 固定最多 20 筆。

## Workflow 與安全邊界

- 共用 runner 執行 protected start／tick／fail，固定最多 60 ticks／15 分鐘、HTTP 90 秒 timeout、schema 驗證、錯誤 cleanup、exact target／commit SHA／run ID／expected session／SLA health gate 與安全單行摘要。
- 首次 Sites 正式 run 揭露 active catalog 語意與冷 cache latency：修正後 target 由 2,382 檔回到 51 檔啟用商品。每 tick 2 檔在 Sites 冷尾端仍曾超過 90 秒 HTTP 上限，因此 production 最終固定每次只 claim 1 檔；其餘 item 透過 D1 cursor 由同輪後續 tick 或下一輪接續。
- 單檔 6 個冷月份完全串行時在「8 秒 timeout＋一次 retry」最壞情況可達 96 秒；月份查詢因此固定最多 2 個並行，production automation 每個 HTTP tick 再限制為最多 4 個月、兩波最多約 32 秒的 provider 等待。超過 4 個月份時，`audit_request_budget` 跨 tick 利用月 cache 續跑，仍保留 160 日稽核範圍。
- Sites workflow 預定每日台北 23:00，Cloudflare workflow 預定每日台北 23:30；各自使用獨立 concurrency、run prefix、secret 與 Access context。schedule job 另以 target-specific repository／environment variable 明確 gate，未設定 `true` 時只有 `workflow_dispatch` 可執行。
- 正式 secret、schedule gate、migration、部署、commit 與 push 均未執行；既有 simulation API、watchdog、5173、5174、pipeline 與行情連線未停止。

## 實際 UI 驗收

- 本機 `127.0.0.1:5174`：ETF `00919.TW` 日 K 已載入且顯示 `08/28 收盤已核對`。
- 本機「追蹤觀察」第 6／6 頁：`3008.TW`、`2454.TW`、新加入的 `4768.TWO` 三張日 K 均已載入並顯示收盤已核對；`4768.TWO` 在個人清單顯示「晶呈科技／加入 2026-08-28」。
- 該頁 DOM 可見大戶、散戶副圖各 3 組；可見 canvas 69 個，0 尺寸 0 個；console error／warning 皆為 0。
- Sites 保留站另核對 `3008.TW`、`.TWO` 商品與 ETF panel loaded；可見 canvas 56 個，0 尺寸 0 個，console error／warning 皆為 0。正式自動化尚未部署，因此此項只證明既有 UI／資料呈現沒有被本機實作破壞。
- Sites workflow run `33180278323` 已完成 durable 稽核：`target=51`、`processed=51`、`remaining=0`、`complete=40`、`unknown=11`、`failed=0`、`overdue=0`，protected health 並回報精確 commit `17df78844c166c1a46b65fdf657ba7eac7d83028`。後續代表性 acceptance 的首個請求因 `5483.TWO`、`4768.TWO` 不在 Sites 當日 target snapshot 而被舊驗證規則以 `HTTP 400` 拒絕；已將 acceptance 與 durable target eligibility 分離，普通稽核仍不得擴張 target set。
- Sites v195 雖綁定 `f1aedbe96eaffdb335ca5a55c6006946fd64747d`，首次封裝卻沿用修正前的既有 `dist`；該 saved version 為 immutable，不能以相同 commit 覆蓋。已在重新執行 `npm run build`、確認 `dist/server/index.js` 含 acceptance normalization 後建立新 commit 與新 saved version，避免把環境變數中的 SHA 誤當成 bundle 證據。
- Sites v196 的 4 檔 acceptance 已通過 payload eligibility，但同一 HTTP request 同時稽核 4 檔並建立 160／320 首次與重複快照，於 90 秒硬 timeout 中止。驗收 runner 已改為逐檔 request；每檔仍核對完整 acceptance contract 與 cache reuse，並保留單次 request 的 90 秒上限。
- 正式 D1 已完整的代表商品不應再被上游暫時不可用阻擋；runner 因此先做 D1-only acceptance，只有 D1 證據不足的 5xx 才啟動 preparation 回補，並在回補後重新執行相同嚴格 acceptance。
- Sites v197、v198 進一步證明即使逐檔，若同一 request 同時負責回補與 stale payload 刷新，第一檔仍可能超過 90 秒。最終路徑把普通 audit 與 D1-only acceptance 分成兩個 request，避免 acceptance 再觸發 history 網路刷新；不足 320 rows 或 continuity 非 complete 時直接 fail closed。

## 自動驗證

- `node --test tests/candle-continuity-automation.test.mjs tests/candle-continuity-workflow-contract.test.mjs`：16／16 通過。
- RealTimeStock 來源樹 `npm test`：613／613 通過，包含 build、migration staging、continuity、cache、health、workflow、security 與完整既有回歸。
- 發布 repo `npm test`：611／611 通過；`npm run lint` 通過。
- 來源樹與發布 repo 本 change 的 14 個程式／migration／workflow／test 檔案 hash parity 已核對；`add-mainforce-chip-subcharts` 保持未追蹤且未修改。

## 尚待另行授權

- 精準 commit／push。
- Sites 與 Cloudflare 分階段 additive migration、secret 配置、手動全量 run、exact SHA 部署與各自 protected health／DOM／canvas／console 驗收。
- 雙環境正式驗收後才將兩個 schedule gate 設為 `true`，並觀察至少一個已完成交易日與次日 SLA checkpoint。
- 上述正式證據完成後才同步正式 spec、archive change。
