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
- `multiview_tdcc_watcher_job`：登入即執行且每 300 秒 queue-only 檢查的 TDCC watcher 是否載入；無 runnable target 時不得連線 TDCC 歷史來源。
- `multiview_after_hours_market／chip／tdcc／pe`：最近一次安全 seed report 的資料族群結果。

市場收盤只代表即時 SSE 不再出現新的成交，不應讓 5173 或 8080 listener 消失。Shioaji HTTP server 與外部行情 session 是兩層生命週期：8080 可能先完成監聽，Solace／paper session 才在背景登入。盤後維護、上游暫時不可用或登入尚在進行時可能回傳 `SessionNotEstablished`；此時不能只用 listener 或 health 取代業務判斷。

5174 MultiView 的「分 K」是 1／5／15／60 分鐘 K 線，跨 `Asia/Taipei`
日期時以亮黃色分日線區隔；日／週／月 K 不套用。台股整股成交量在主交易畫面與
MultiView 都以 `common_lot`（張）呈現：Shioaji lot 不換算，Yahoo／TWSE
shares 除以 1,000。只有同一批 Shioaji Kbars 要求跨畫面 daily OHLCV 完全一致；
fallback 不冒充跨 provider 數值 parity，且 Shioaji 本機 display 不取代收盤核定。

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
