## Context

本機 Web 前端目前由 Vite 提供 `127.0.0.1:5173`，並將 `/api` 代理至 Shioaji HTTP server `127.0.0.1:8080`。臨時終端程序結束後兩個服務會消失；另一方面，Shioaji simulation 與 production 使用不同 session，且 production server 本身仍公開交易 API，因此只靠 UI 提示不足以構成正式行情唯讀邊界。

使用者已明確要求未來可以手動切至正式行情唯讀，但不得因重新登入、重新開機或程序自動復原而意外進入 production。API key、secret 與 CA 皆不得寫入 repo、LaunchAgent 或 OpenSpec。

## Goals / Non-Goals

**Goals:**

- macOS 登入後自動啟動 simulation API 與本機 Web，程序異常退出時由 `launchd` 重啟。
- 以單一命令安全切換 `simulation`／`production-readonly`，並確保兩種 API job 互斥。
- production job 僅於當次登入工作階段動態註冊；重新登入或重開機後只會自動載入 simulation job。
- production-readonly 模式同時使用 broker 權限／無 CA、前端 client guard 與 Vite proxy guard 阻擋交易寫入。
- 提供不含秘密值的狀態與健康診斷。

**Non-Goals:**

- 不開啟 API key 的 Trading 權限、不安裝或啟用 CA，也不測試任何真實委託。
- 不讓 production 成為登入後預設模式。
- 不把 Shioaji 或 Web 暴露到區域網路／Internet。
- 不實作 Cloudflare、遠端存取或正式自動交易。

## Decisions

### 1. simulation 與 Web 使用兩個常駐 LaunchAgent

simulation API 與 Vite 各自使用 `~/Library/LaunchAgents` 中的 job，皆綁定 `127.0.0.1` 並啟用 `RunAtLoad`／`KeepAlive`。兩個程序分開管理，避免其中一個退出時留下另一個不可診斷的 wrapper 子程序。

替代方案是用單一 shell wrapper 同時啟動兩個子程序，但 `launchd` 只能直接追蹤 wrapper，無法可靠區分哪個服務失敗，因此不採用。

### 2. production-readonly 使用非自動載入的動態 LaunchAgent

production plist 放在 `~/Library/Application Support/RealTimeStock/LaunchAgents`，不放進 `~/Library/LaunchAgents`。切換時先 `bootout` simulation API job，再以 `bootstrap` 動態註冊 production job；登出／重開機後動態 job 消失，而 simulation job 會自動回來。

替代方案是用共用持久化 mode 檔決定開機模式，但上次選擇 production 可能在重開機後被延續，違反預設 simulation 的安全要求。

### 3. `.env` 保持 simulation，production 僅由明確參數啟動

常駐 simulation job 明確設定 `SJ_PRODUCTION=false`；production job 明確使用 `--production`。LaunchAgent 只設定工作目錄與執行入口，不保存 API key／secret；stdout／stderr 導向 `/dev/null`，安全診斷改由 `status` 指令提供。Shioaji 仍從被 Git 忽略的專案 `.env` 讀取秘密值。

production-readonly 切換前檢查 `.env` 不得存在非空的 `SJ_CA_PATH` 或 `SJ_CA_PASSWD`。檢查只回報欄位是否存在，不輸出值。

### 4. 交易阻擋採三層 fail-closed

第一層是 broker 端 API key 的 Trading 關閉；第二層是不載入 CA；第三層是本機 Web guard。Vite 在 production-readonly marker 存在時，對已知交易寫入路徑回傳 HTTP 403，但仍允許 `trades`／`combotrades` 等唯讀查詢。前端共用 API client 在送出相同交易寫入前也會拒絕，讓使用者直接看到繁體中文唯讀訊息。

本機 Web guard 不宣稱能保護直接連到 8080 的其他程式；直接存取的最終安全邊界仍是 Trading 權限關閉與未載入 CA。

### 5. runtime mode 由本機 marker 與唯讀狀態 endpoint 提供

模式腳本在 `~/Library/Application Support/RealTimeStock/runtime-mode` 寫入 `simulation` 或 `production-readonly`。Vite plugin 每次交易請求都即時讀取 marker，並提供只含模式名稱的 `/__realtimestock/runtime-mode`，讓前端狀態與 client guard 同步；marker 不含任何秘密值。

### 6. 切換驗證以服務與業務資料分層呈現

切換指令分別檢查 port、`/api/v1/info`、`/api/v1/health`、前端 HTTP 與一筆 2330 snapshot。production 若登入成功但 snapshot 回傳 `SessionNotEstablished`，狀態必須明確標示「正式行情 session 未建立」，不得宣稱正式行情可用，也不得用任何交易呼叫驗證。

## Risks / Trade-offs

- [使用者直接連到 8080 可繞過 Vite guard] → 維持 Trading 權限關閉、無 CA，並在文件中明確限制唯讀保證範圍。
- [Shioaji 官方 endpoint 未來新增交易寫入路徑] → 將阻擋清單集中管理並以測試覆蓋；升級 Shioaji 時重新盤點 `/docs`。
- [LaunchAgent 因路徑變更失效] → 安裝時寫入當下絕對路徑，`status` 檢查 plist 與 executable，移動 repo 後重新執行 install。
- [production 行情 entitlement 尚未修復] → 切換可保留明確錯誤並提供 simulation 回復，不以 health/accounts 冒充行情成功。
- [Vite 尚未啟動時無法提供 Web guard] → 模式指令仍保留 broker 權限與無 CA 兩層安全邊界，並將 Web 健康失敗標示為未完成切換。

## Migration Plan

1. 新增 runtime mode、Vite guard、模式腳本、plist 產生與測試。
2. 安裝 LaunchAgent 時先停止目前由臨時終端啟動且已確認屬於本專案的程序。
3. 安裝 simulation API／Vite job 並驗證 `simulation: true`、health、前端與 snapshot。
4. 以不啟用 CA／不呼叫交易 API 的方式驗證 production-readonly 切換；若正式行情 session 仍未建立，立即切回 simulation 完成終態。
5. 移除時 `bootout` 三個 job 並移除產生的 plist；repo 與 `.env` 保留。

## Open Questions

- Shioaji 未來若提供可機器驗證的 Trading permission introspection，可加入 production-readonly preflight；目前官方 API 沒有足夠安全的唯讀欄位可取代使用者在管理頁的確認。
