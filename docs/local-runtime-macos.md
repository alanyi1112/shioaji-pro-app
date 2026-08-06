# macOS 本機常駐與安全模式切換

本文件適用於本機 Web 開發環境：

- Web：`http://127.0.0.1:5173`
- Shioaji HTTP API：`http://127.0.0.1:8080`
- 登入／重開機預設：simulation

## 安裝常駐服務

先在專案根目錄準備被 Git 忽略的 `.env`，只存放於本機。禁止將 API key、secret、CA 密碼寫入 repo、LaunchAgent 或文件。

```sh
pnpm local-runtime install
pnpm local-runtime status
```

安裝會建立兩個使用者層級 LaunchAgent：simulation API 與 Vite Web。兩者都只監聽 loopback，異常退出時由 `launchd` 重啟。

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
- `market_snapshot_2330`：行情業務 session 是否可回應。

市場收盤只代表即時 SSE 不再出現新的成交，不應讓 5173 或 8080 listener 消失。`SessionNotEstablished` 則代表行情業務 session 未建立，不能只用 health 取代判斷。

## 移除

```sh
pnpm local-runtime uninstall
```

移除只會停止並刪除本工具建立的 LaunchAgent；不會刪除 repo 或 `.env`。
