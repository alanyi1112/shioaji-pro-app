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

安裝會建立 simulation API、Vite Web、MultiView 與 bounded 盤後資料 pipeline 的使用者層級 LaunchAgent。服務都只監聽 loopback；MultiView 只會在 simulation 模式啟動。

安裝或切回 simulation 時，runtime 會先確認 8080 的模式與 health endpoint，再以 2330 snapshot 等待行情業務 session；完成判定後才啟動 MultiView。若盤後維護或上游 session 暫時無法建立，5173 仍可啟動，但介面會維持 `OFFLINE`，MultiView 改用延遲備援，不會把「HTTP 程序正在監聽」誤報成即時行情可用。

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
- `multiview_listener`：5174 是否存在。
- `multiview_after_hours_market／chip／tdcc／pe`：最近一次安全 seed report 的資料族群結果。

市場收盤只代表即時 SSE 不再出現新的成交，不應讓 5173 或 8080 listener 消失。Shioaji HTTP server 與外部行情 session 是兩層生命週期：8080 可能先完成監聽，Solace／paper session 才在背景登入。盤後維護、上游暫時不可用或登入尚在進行時可能回傳 `SessionNotEstablished`；此時不能只用 listener 或 health 取代業務判斷。

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
