# macOS 本機常駐與安全模式切換

本文件適用於本機 Web 開發環境：

- Web：`http://127.0.0.1:5173`
- Shioaji HTTP API：`http://127.0.0.1:8080`
- MultiView：`http://127.0.0.1:5174`
- 登入／重開機預設：simulation

## 安裝常駐服務

先在專案根目錄準備被 Git 忽略的 `.env`，只存放於本機。禁止將 API key、secret、CA 密碼寫入 repo、LaunchAgent 或文件。

```sh
pnpm local-runtime install
pnpm local-runtime status
```

安裝會建立 simulation API、business-session watchdog、Vite Web、MultiView 與 bounded 盤後資料 pipeline 的使用者層級 LaunchAgent。服務都只監聽 loopback；MultiView 與 watchdog 只會在 simulation 模式啟動。

安裝或切回 simulation 時，runtime 會先確認 8080 的模式與 health endpoint，再以 2330 snapshot 等待行情業務 session；完成判定後才啟動 MultiView。若盤後維護或上游 session 暫時無法建立，5173 仍可啟動，但介面會維持 `OFFLINE`，MultiView 改用延遲備援，不會把「HTTP 程序正在監聽」誤報成即時行情可用。

## 關機後自行啟動

LaunchAgent 安裝完成後，Mac 重開機並登入帳號時會自動以 simulation 啟動。若登入後尚未就緒，或想自行確認並補啟動，開啟「終端機」後執行：

```sh
cd /Users/alanyi/Documents/RealTimeStock
./start-realtimestock.command
```

也可以在 Finder 開啟 `/Users/alanyi/Documents/RealTimeStock`，直接雙擊 `start-realtimestock.command`。

這個啟動檔只使用 simulation。若所有必要服務與 business session 已正常，它只顯示狀態，不會重啟或中斷既有行情連線；缺少服務或 session 不可用時，才會重新建立 8080 API、watchdog、5173 Web、5174 MultiView 與兩條盤後 pipeline。它不會啟動 production 或真實交易模式。

若想完全手動操作，可使用同等命令：

```sh
cd /Users/alanyi/Documents/RealTimeStock
pnpm local-runtime simulation
pnpm local-runtime status
```

成功時至少應看到：

```text
runtime_mode=simulation
business_watchdog_state=healthy
api_health=healthy
api_business_session=available
market_snapshot_2330=available
web_listener=up
multiview_listener=up
```

啟動後可開啟：

- 交易終端：`http://127.0.0.1:5173`
- MultiView：`http://127.0.0.1:5174`

只有 LaunchAgent 尚未安裝或曾執行 `pnpm local-runtime uninstall` 時，才需要重新執行一次：

```sh
cd /Users/alanyi/Documents/RealTimeStock
pnpm local-runtime install
```

## Business-session 自動恢復

watchdog 每 30 秒以固定 2330 Snapshot 檢查 simulation business session。只有同一個已曾成功的 simulation API generation 連續三次回報 `SessionNotEstablished`，才會只對 8080 simulation API job 執行有限重啟；5173、5174、D1 與盤後 pipeline 都不會被 watchdog 重啟。

每次重啟後保留 90 秒恢復期，後續依 2／5 分鐘退避；同一 incident 最多重啟三次，之後進入 `circuit-open`。執行下列命令可查看去識別化狀態；若確認本機 simulation 設定可用，可用 `simulation` 人工重設 circuit 並重建服務：

```sh
pnpm local-runtime status
pnpm local-runtime simulation
```

watchdog 不會修復、啟動或探測 production 行情，也不會載入 CA、帳戶或呼叫交易 API。若 runtime mode 不是 `simulation`，watchdog job 會在切換前停止；隔離狀態機則只會回報 `idle-non-simulation`。

5173 另有一個 document-scoped monitor，以相同的低頻 Snapshot 判斷 business session。中途失效時工作區保持開啟、header 顯示 `OFFLINE`，並以 5／10／20／30 秒後封頂 30 秒的 single-flight 退避重載自選清單；手動「重新檢查」會併入同一個 recovery flow。

交易終端「版面 → MultiView」會先開啟 5173 的輕量 launcher。launcher 只讀取 5174 的固定 health endpoint 與 Shioaji mode；確認 simulation 後才導向 MultiView。若 5174 未啟動，畫面會保留可操作的重試與重啟指引。

## 切換模式

切回預設 simulation：

```sh
pnpm local-runtime simulation
```

暫時切到正式行情唯讀：

```sh
pnpm local-runtime production-readonly
```

正式行情唯讀切換會：

1. 停止 simulation job 並等待 8080 釋放。
2. 拒絕含有非空 `SJ_CA_PATH`／`SJ_CA_PASSWD` 的 `.env`。
3. 啟動當次登入工作階段限定的 production job。
4. 驗證 `/info`、`/health` 與 2330 snapshot。
5. 行情 session 未建立時自動回復 simulation。

production job 的 plist 不放在 `~/Library/LaunchAgents`，因此登出或重開機後不會自動載入；simulation 仍是下次登入的預設模式。

## 唯讀安全邊界

正式行情唯讀依序使用三層防護：

1. 永豐 API key 的 Trading 權限保持關閉。
2. runtime 明確不載入 CA，且切換前檢查 `.env`。
3. 本機 Web 的 client guard 與 Vite proxy guard 阻擋下單、改價、改量、刪單、組合下單及組合刪單。

Vite guard 只保護經過 `http://127.0.0.1:5173/api` 的本機 Web 請求。其他程式若直接呼叫 8080，不會經過 Vite；因此 Trading 權限關閉與未載入 CA 才是直接 API 的最終安全邊界。

禁止以真實委託測試唯讀設定。驗收只使用 info、health、行情 snapshot 與本機 403 guard。

## 狀態判讀

```sh
pnpm local-runtime status
```

狀態分成：

- `web_listener`：5173 本機 Web 是否存在。
- `api_listener`：8080 Shioaji HTTP server 是否存在。
- `api_simulation`：實際登入模式。
- `api_health`：本機 server health。
- `api_business_session`：以 2330 snapshot 驗證的行情業務 session 狀態。
- `market_snapshot_2330`：行情業務 session 是否可回應。
- `business_watchdog_job`：simulation-only watchdog LaunchAgent 是否載入。
- `business_watchdog_state`：`startup-grace`、`healthy`、`suspect`、`recovering`、`backoff`、`circuit-open` 或 `idle-non-simulation`。
- `business_watchdog_consecutive_failures`、`business_watchdog_restart_count`、`business_watchdog_last_reason`、`business_watchdog_next_eligible_at`：固定 allowlist 診斷欄位，不含 response body、商品清單、帳戶或秘密。
- `multiview_listener`：5174 是否存在。
- `multiview_tdcc_pipeline_job`：週六 22:30 主同步與週日 22:30 隔日重試的 TDCC LaunchAgent 是否載入。
- `multiview_tdcc_early_job`：週五 19:00／22:00 與週六 06:00／08:00／09:00／10:00／12:00 的最新週資料檢查是否載入；登入／載入時也立即檢查一次，以補晚開機。只核對 TDCC 官方 CSV／OpenAPI，沒有新週次就 noop，不執行歷史補建。若只需更新此工作而保留共用服務，使用 `pnpm local-runtime install-multiview-tdcc-early`；可用 `pnpm local-runtime multiview-tdcc-latest` 手動執行一次。
- `multiview_tdcc_watcher_job`：登入即執行且每 300 秒 queue-only 檢查的 TDCC watcher 是否載入；無 runnable target 時不得連線 TDCC 歷史來源。
- `multiview_seed_source`、`multiview_seed_market／chip／tdcc／pe`：最近一次安全 seed report 的匯入結果，不代表目前行情完整。
- `multiview_after_hours_source`：目前資料摘要是否來自 `live_health`；無法取得時為 `unavailable`。
- `multiview_after_hours_market／chip／tdcc／pe`：目前 health 的逐類驗證狀態；TDCC 全域 available 不等於逐商品完整，因此顯示 `available_not_verified`。
- `multiview_market_expected_session`、`multiview_market_latest_coverage`、`multiview_market_unknown`：持久化歷史預期交易日、最新日涵蓋數／啟用商品數及未知數；不代表 Shioaji 即時圖表狀態。
- `multiview_chip_ready`、`multiview_tdcc_source_date`、`multiview_pe_history_missing`、`multiview_pe_verified_date`：各資料族群的進度與日期；不以全域最大日期冒充逐商品驗收。
- `multiview_after_hours=verification_required`：仍需依逐商品與資料集證據驗收；缺少 health 時為 `unknown`。不以舊 seed 成功顯示今日完成。

盤後選股維護以 Node 24.15+ 的 `--use-system-ca` 使用 macOS 系統信任庫，保留 TLS 驗證，不再依賴 repo 內的 `scripts/certs/*.pem`。若作業環境仍有憑證錯誤，應修正該機的合法信任設定，不可關閉憑證驗證；使用者既有 `NODE_EXTRA_CA_CERTS` 設定仍由 Node 原生支援，憑證不得提交 repo。

市場收盤只代表即時 SSE 不再出現新的成交，不應讓 5173 或 8080 listener 消失。Shioaji HTTP server 與外部行情 session 是兩層生命週期：8080 可能先完成監聽，Solace／paper session 才在背景登入。盤後維護、上游暫時不可用或登入尚在進行時可能回傳 `SessionNotEstablished`；此時不能只用 listener 或 health 取代業務判斷。

5174 MultiView 的「分 K」是 1／5／15／60 分鐘 K 線，跨 `Asia/Taipei`
日期時以亮黃色分日線區隔；日／週／月 K 不套用。台股整股成交量在主交易畫面與
MultiView 都以 `common_lot`（張）呈現：Shioaji lot 不換算，Yahoo／TWSE
shares 除以 1,000。只有同一批 Shioaji Kbars 要求跨畫面 daily OHLCV 完全一致；
fallback 不冒充跨 provider 數值 parity，且 Shioaji 本機 display 不取代收盤核定。

收盤後選股結果的「加入清單」會同時要求寫入 Shioaji「選股」與 MultiView
「選股篩選」。5173 僅接受 loopback、same-origin 的固定 POST gateway，payload 只含
canonical `.TW`／`.TWO` symbol，並只轉送至固定 5174 integration endpoint；不接受
任意 target、path、method 或 caller credentials。MultiView 以 server-side catalog、
固定 tab identity 與 D1 unique key 冪等建立頁籤／商品，多個同名頁籤或 identity
衝突時 fail closed。兩端任一失敗時介面保留另一端已確認結果並允許重試，不做補償
刪除；整個流程不建立委託、行情訂閱、籌碼預熱／回補或 runtime 啟停。已開啟的
MultiView 在回到前景時只做 single-flight 唯讀清單刷新，不切換目前頁籤或圖表。

## 主交易畫面指定日期 drill-down

日 K 觀察模式可雙擊有效 K 棒進入該 `Asia/Taipei` 日期的 exact-date 1 分 K。
主程式會先重新確認 `/api/v1/info` 為 simulation，再以相同 start／end 日期讀取
Kbars；只有 symbol、source、schema、日期、排序、最多 600 根與 latest generation
全部通過，才在 paint 前同步切換 candles、readout、成交量、指標、
day-boundaries 與 viewport。空資料、混日、來源失敗或使用者快速切換時，原日 K
與工具狀態保持不變。日 K 壓撐單擊使用 260ms bounded arbiter；同棒雙擊會取消
單擊 reference 副作用。交易點價、費波那契、價格範圍、固定範圍 VP 與 drag
保留原 ownership，不會因 drill-down 延遲或重送任何 broker write。

這項能力只使用現有 loopback simulation market-data runtime；不會登入或切換
production、不會啟用 CA、取得 broker authority、建立委託、寫入 D1 verified
history、部署或改變服務生命週期。

MultiView 主圖單擊仍立即交由目前工具處理。2／3／4／6／8 圖合法雙擊開啟目前
商品與週期的單圖新分頁；圖表數量為 1 時，雙擊有效且已完成的日 K才使用相同
simulation-only 指定日期契約，在原 panel 驗證成功後原子切為該日期 1 分 K。籌碼
副圖在同商品刷新、重排或短暫 API 失敗時保留最後一份已驗證資料，只有商品或週期
改變才清除舊 identity。

## MultiView 盤後資料 seed

盤後資料只可從既有合法 Cloudflare OAuth session 唯讀匯入。工具從來源端限制為 12 個市場資料 table；不得先匯出整個 D1，也不得讀 browser cookie 或建立授權 bypass。

```sh
cd apps/multiview
work_dir="$(mktemp -d)"
chmod 700 "$work_dir"
node scripts/after-hours-d1-migration.mjs export --output="$work_dir/allowlist.sql"
node scripts/after-hours-d1-migration.mjs stage \
  --export="$work_dir/allowlist.sql" \
  --staging="$work_dir/staging.sqlite" \
  --live="<scripts/multiview-state status 顯示的 database_file>"
```

seed 前必須停止 5174。`seed` 會先建立 integrity 通過的 live DB 備份，再以單一 transaction 合併白名單資料；個人清單 row count 或 hash 變動時會自動回復備份。

```sh
node scripts/after-hours-d1-migration.mjs seed \
  --staging="$work_dir/staging.sqlite" \
  --live="<database_file>"
```

去識別化結果保存在 `~/Library/Application Support/RealTimeStock/MultiView/reports/`；只包含 table count、日期 coverage、material hash、備份識別與安全 reason code，不保存 SQL values、完整商品清單或個資。完成後刪除臨時 SQL 與 staging DB。

## 移除

```sh
pnpm local-runtime uninstall
```

移除只會停止並刪除本工具建立的 LaunchAgent；不會刪除 repo 或 `.env`。

### 選股 invalid 的單次人工恢復

官方回應曾違反 schema／日期契約時，自動排程保留 invalid，不自動解除。操作者確認來源已恢復後，可使用 Node 24.15+ 執行 `scripts/stock-screener-update.mjs --database=/absolute/local.sqlite --recover-invalid-session=YYYY-MM-DD --limit=1 --ohlcv-limit=1 --ohlcv-v4-limit=1`，並加上 Node `--use-system-ca`。

日期必須同時等於台北今日與 expected session；原狀態須為 invalid、冷卻到期且探測預算未耗盡。不可與排程開關或 bootstrap 混用。執行前以唯一日期 receipt 保存原 readiness 與 SHA-256；即使失敗或中斷也不刪除 receipt、不重複執行。此操作僅解除當次 publication probe，仍須雙市場 exact date、schema 與母體覆蓋通過。技術或籌碼缺期仍回 pending，使用既有 bounded resume 工具處理；不得直接改 checkpoint、偽造 receipt 或標記完整。

## 盤中監控隔日量比基準（simulation-only）

`postclose-daily-baseline.mjs` 在台北時間 13:35 嘗試為下一適用交易日建立 160 檔同分鐘累積量基準。啟動預算不是固定剩餘流量值：它使用相同 cohort、近 30 日至少兩次完整驗證的 provider usage 增量，以最大實測成本三倍加上 provider 額度 25% 保留額計算。採集時每次資料請求前重新讀取剩餘額度；樣本不足、quota 欄位失真或額度不足都停止且不發布基準。8 GiB 磁碟保留、單次回應 16 MiB 上限、串行間隔與 30 分鐘總期限仍生效。

首次失敗若屬可恢復原因，獨立 retry LaunchAgent 於 14:15 與 14:55 最多再試兩次；每次有不同 claim、budget、來源目錄和 receipt，均以 exclusive create 保存，不覆寫前次證據。已有完整基準、前次尚無 receipt、休市或已達三次上限時不會採集。只讀查詢：`node scripts/intraday-monitor-runtime/postclose-daily-baseline.mjs --status --date=YYYY-MM-DD`。安裝 retry 排程：`node scripts/intraday-monitor-runtime/postclose-daily-baseline.mjs --install-retries`；不會重啟既有 API、watchdog、Web 或 MultiView。正式基準只在 160 檔逐項驗證後由 staging 目錄發布，不能以部分來源或線圖快取補足。

### 盤前晚開機接續

固定 08:20／08:35／08:45／08:50 LaunchAgent 不要求使用者每日 08:20 前開機，但關機或未登入時可能沒有任何當日固定時點收據。另有獨立的 `com.alanyi.realtimestock.intraday-premarket-late-boot` LaunchAgent，以 `RunAtLoad` 及 08:25／08:40／08:55／08:58 少量補跑觸發。它只在台北時間 08:20:00–08:58:59 檢查，至 08:59:00 停止；早於窗口、休市、基準缺失或已啟動採集時不補造固定排程收據。服務暫未就緒只在當次進程做有界唯讀重查，不自行登入或重啟服務。

盤前接續必須重驗前一交易日完整 160 檔基準、本機已驗證的 TWSE／TPEx 日曆、simulation business session、2330 Snapshot、cohort／revision／bundle、generation 與今日零資料活動。08:50 後如果原採集尚未開始，晚開機入口只可取得一次每日 capture-start claim；與固定 08:50 共用此 claim，既有 capture registry 再防重。晚開機準備與結果另存 append-only receipt，UI／API 標為「晚開機接續 · 冷啟動風險」，不能視為固定時點或完整日正式驗收成功。即使在開盤前幾分鐘開機，若前日盤後基準未建成或服務未能在截止前就緒，系統仍會 fail closed。

新增 Agent 的安裝須在台北時間 08:59 後、已確認本次 `RunAtLoad` 只會 no-op 時執行 `node scripts/intraday-monitor-runtime/late-boot-catchup.mjs --install`，再以 `plutil -p ~/Library/LaunchAgents/com.alanyi.realtimestock.intraday-premarket-late-boot.plist` 及 `launchctl print gui/$(id -u)/com.alanyi.realtimestock.intraday-premarket-late-boot` 讀回設定。安裝不應停止或重啟既有 API、watchdog、Web、MultiView；`loaded` 只代表已註冊，真正接續仍須下個適用交易日的 claim、receipt、session、capture 與合法 KBar 證據。
