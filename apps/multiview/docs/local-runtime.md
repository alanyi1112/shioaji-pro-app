# MultiView 本機操作與安全邊界

## 服務與資料位置

- Shioaji HTTP API／SSE：`127.0.0.1:8080`
- RealTimeStock 交易終端：`127.0.0.1:5173`
- MultiView Web／Worker：`127.0.0.1:5174`
- 本機 D1、migration metadata、備份、排程 checkpoint 與 log：
  `~/Library/Application Support/RealTimeStock/MultiView/`

5174 是獨立、loopback-only 的服務；啟動失敗不得中止 5173 或 8080。一般
`uninstall` 只移除本專案建立的 LaunchAgent，預設保留 D1、備份、MultiView
清單與設定。

## 手動啟動

先在 workspace 安裝 dependency，初始化並 migration repo 外的 D1：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm multiview:state migrate
pnpm dev
pnpm dev:multiview
```

開啟 `http://localhost:5173`，再從「版面」選擇
`MultiView（開新分頁）`。也可直接開啟 `http://localhost:5174`。

MultiView 只提供 `1d`、`1wk`、`1mo`，預設 `1d`。任何舊分 K 設定、query
string 或直接 API request 都不能重新啟用分 K。

## macOS 常駐模式

```sh
pnpm local-runtime install
pnpm local-runtime status
pnpm local-runtime restart
pnpm local-runtime uninstall
```

`install` 會先 migration／驗證 D1，再安裝 8080、5173、5174 及盤後 pipeline
的 LaunchAgent。MultiView 本階段只支援 `simulation`；登入或重新開機後一律
以 `simulation` 啟動，若 RealTimeStock 切至其他模式，5174 會停止且不得讀取
該模式的行情。回到 `simulation` 後才會重新啟動並 bootstrap。

`status` 分別回報 API listener、simulation mode、2330 business Snapshot、5173、
5174、D1 integrity／schema coverage、即時來源與盤後資料狀態。HTTP 200 或 SSE
heartbeat 不代表行情可用。

## 台股行情來源

頁面提供三種模式：

- `自動`：優先使用 Shioaji；連線或 business session 不可用時原子切換 Yahoo
  延遲備援。
- `Shioaji 即時`：只接受 Shioaji；失敗時顯示 unavailable，不混接 Yahoo OHLCV。
- `Yahoo 延遲`：釋放即時訂閱並只使用既有延遲來源。

本階段 Shioaji 只支援 `STK`、`IND`、`WRT`；`FUT`、`OPT` 明確停用。IND
若來源未提供成交量，成交量與 Volume MA5／MA10／MA20 顯示 unavailable，
不得用零值、昨量、amount 或 Yahoo volume 冒充即時量。國外商品仍使用原本
provider；MultiView「我的清單」與 RealTimeStock 自選清單各自獨立。

## 盤後資料與排程

本機保留既有 Yahoo、TWSE、TPEx、TDCC 與 FinMind provider、source date、缺值
及 verification 語意；未發布資料不補零、不 forward-fill。

- 平日 16:45：daily cache／台股籌碼及有界 PE backfill。
- 週六 10:00：有界 TDCC latest／continuous backfill。
- 登入時也會觸發一次可重入的 overdue 檢查；run id、checkpoint、lease、retry
  與 changed-only write 避免重複寫入。

可手動執行：

```sh
pnpm local-runtime multiview-daily
pnpm local-runtime multiview-tdcc
```

排程授權值只存於權限 `0600` 的
`~/Library/Application Support/RealTimeStock/MultiView/pipeline-secret`，不寫入
repo、plist 或 status。Cloudflare D1 沒有合法授權 session 時不得讀 cookie 或
建立 bypass；改走官方有界回補，未完成 coverage 必須保持 incomplete。

## D1 備份與回復

```sh
pnpm multiview:state status
pnpm multiview:state backup
pnpm multiview:state restore "/絕對路徑/multiview-YYYYMMDDTHHMMSSZ.sqlite"
```

Migration 前會先備份，完成後執行 `PRAGMA integrity_check` 與 schema coverage
gate。Restore 會先驗證來源備份、建立 rollback backup，再原子替換目前 D1；
5174 執行中時拒絕 restore。

## 下單橋接安全邊界

MultiView 不匯入交易函式，也沒有 order proxy。右鍵「下單」只對已透過
data-only adapter 重新解析、且 5173 支援的台灣 `STK`／`WRT` 啟用；IND、
非台股、契約解析失敗與 5173 未啟動都會停用或顯示可回復錯誤。

橋接只允許 contract `code`、`security_type`、`exchange`。任何 account、side、
price、quantity、order type、order action、CA 或 token 都會整體拒絕。實際委託
仍必須在 5173 使用既有確認與風控流程；本整合只驗證 simulation，沒有建立
`production-trading`，也不執行任何正式環境行情或交易驗收。

## 授權與來源

匯入程式以 `AGPL-3.0-only` 發布；來源 branch、完整 SHA、修改摘要與更新程序
記錄於 `UPSTREAM.md`。Lightweight Charts 固定為本機 dependency `5.0.9`，
依 Apache-2.0 使用並保留 TradingView attribution；第三方清單見
`THIRD_PARTY_NOTICES.md` 與 `licenses/Apache-2.0.txt`。任何後續匯入都必須先
通過 `pnpm verify:multiview-governance`。
