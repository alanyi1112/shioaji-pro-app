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

MultiView 提供 `1m`、`5m`、`15m`、`1h`、`1d`、`1wk`、`1mo`，預設
`1d`。本文件所稱「分 K」是分鐘 K 線；1／5／15／60 分 K 依相鄰 canonical
candles 的 `Asia/Taipei` 日期變化，在前一日最後一根與下一日第一根之間顯示
1.2 CSS px 亮黃色分日線。日／週／月 K、`intraday` 分時走勢與同日資料缺口不套用。

MultiView 的主圖單擊立即交給目前 active tool，不使用 260ms bounded double-click
timer。2／3／4／6／8 圖合法雙擊以目前商品與 interval 開啟單圖新分頁；圖表數量為
1 時，只有雙擊主圖內命中的有效已完成 `1d` candle，才以 local Shioaji simulation
exact-date loader 在原 panel 原子切為該日期 `1m`。商品、週期、按鈕、連結、背景、
非日 K及 pending drawing／固定範圍工具 ownership 均不啟動 loader。

技術副圖初次 time range 尚未成立時只 resize 並同步既有 viewport，不重建 chart。
籌碼副圖以 material payload 與 pane control signature 去重；日期範圍改變只先更新
neutral time anchor，相同資料、metadata-only refresh、相同 presentation 或群組重排
不會再次全量建立 series，也不會產生第二個相同 API request。

滑鼠游標移動採 per-panel animation-frame latest-wins。一般 pointer move 只由 Lightweight
Charts crosshair callback 更新必要 crosshair 與 readout，不會觸發 FVG、Volume Profile、
價格極值、註記或壓撐 overlay 全量重建；相同 payload 與 candle time 直接 reuse，繪圖工具
preview 另以單一 frame gate 合併。

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

頁面級 coordinator 會在 SSE open、每 15 秒 mode check、頁面回到前景及網路恢復時，比對畫面需要的商品與已完成 bootstrap 的商品。缺少的商品採 per-symbol single-flight 與 1／5／15／30 秒後封頂 30 秒退避；subscribe、Snapshot 與當日 Kbars 都成功後才視為 active。整個頁面仍最多一條 SSE，相同商品不會因多 panel 產生多條 recovery flow。

驗收 metrics 只增加 bounded retry／recovery 計數與固定 reason code，不保存商品、行情內容、個人清單、帳戶或秘密。watchdog 重啟 8080 時不會重啟 5174；MultiView 會沿用既有 `自動` Yahoo fallback 或 `Shioaji 即時` unavailable 語意，待 business session 恢復後自行補回缺少 demand。

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

### 台股整股成交量與跨畫面對照

台股整股 `STK` 圖表在成交量柱、readout、Volume MA、MFI、Volume Profile 與
其他量能衍生指標之前，統一正規化為 `common_lot`（張）。Shioaji Kbars／Tick
原生 lot 採 identity conversion；Yahoo／TWSE 原生 shares 除以 1,000 並保留
合法小數張。payload 必須攜帶可信 provider、source volume unit、normalization
revision 與 source fingerprint；缺少、舊版、偽造或跨 provider 重放時必須失效
重抓或 fail closed，不能把股數直接當張數。

相同 STK、相同台北日期及相同 Shioaji 1 分 Kbars 在 RealTimeStock 主交易畫面與
MultiView 聚合後，daily OHLCV、成交量柱與量能指標輸入必須完全相同。Yahoo／
TWSE fallback 只承諾單位一致、provider 可辨識及整份 OHLCV 原子切換；因成交範圍
或來源修訂不同，不承諾其數值與 Shioaji 完全相同。

### 驗收矩陣

| 路徑 | 適用時框 | 右側成交量 | 日 K 雙擊 | 失效行為 |
|---|---|---|---|---|
| RealTimeStock 主交易畫面 Shioaji | 1／5／15／60 分、日 K | Shioaji lot → `common_lot`；分鐘 K 有分日線 | local simulation exact-date，成功才切 `1m` | unit／generation 不可信時拒絕增量；原圖不變 |
| MultiView 強制 Shioaji | 1／5／15／60 分、日 K | 同源 Kbars／Tick lot → `common_lot`；分鐘 K 有分日線 | 單圖有效日 K：local simulation exact-date；多圖：開單圖 | 混源 OHLCV 清空；非 simulation／日期不符時原圖不變 |
| MultiView 自動模式 | 1／5／15／60 分、日 K | Shioaji 可用時同上；否則 Yahoo／TWSE shares ÷ 1,000 | 單圖有效日 K：local simulation exact-date；多圖：開單圖 | local adapter 不可用時保留原圖，不以 Yahoo 最近日替代 |
| MultiView 強制 Yahoo | 日／週／月與既有延遲路徑 | Yahoo／TWSE shares ÷ 1,000 | 多圖開單圖；單圖 exact-date 仍須獨立通過 local simulation guard | 舊 schema／未知 unit 失效重抓；不混接 Shioaji 或 sample data |

所有列都只描述本機 loopback simulation market-data 能力。驗收不得登入或切換
production、啟用 CA、取得 broker authority、送出委託、寫入 verified history、
部署或啟停服務；MultiView 仍不匯入交易函式或 order proxy。

收盤後 Shioaji display bars 仍只屬本機同源顯示，不會寫入 D1 verified canonical
history，也不取代既有 TWSE／TPEx 收盤核定流程。

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
