# Shioaji Pro — 專業交易終端 Trading Terminal

**[官方網站 / Landing Page](https://sinotrade.github.io/shioaji-pro-app/)** ・
**[下載 Download](https://github.com/Sinotrade/shioaji-pro-app/releases/latest)**

A professional, fully-customizable trading terminal for Taiwan markets
(TWSE / TPEX / TAIFEX), built on the [Shioaji](https://sinotrade.github.io/)
HTTP API + SSE streaming. React 19 + TypeScript + Vite, zero backend code —
it talks directly to your local `shioaji server`.

以 Shioaji HTTP API 打造的專業交易終端：即時行情、K 線、五檔、閃電下單、
圖表點價下單、到價警示、可拖拉的自訂版面。

**介面 100% 開源** — UI、行情串流、下單鏈路全部都在這個 repo，
clone 下來就能 build 出完整的 Web 版終端。桌面版外殼（Tauri）、
AI Agent 與策略回測為專屬模組，直接到 Releases 下載安裝檔即可使用。

![Shioaji Pro — futures night session](docs/shot-terminal-dark.png)

## Live Market Intelligence 即時市場情報

Shioaji 1.7.1 的即時計算指數、成分股與產業貢獻，現在整合成可自由配置的
市場脈動面板。自算指數會同時對照官方指數、更新時間差、台指近月與期現差；
成分股貢獻、產業分布和貢獻傳導可單獨或並排顯示。

![市場脈動：成分股貢獻、產業分布與貢獻傳導](docs/images/market-pulse-live.png)

盤中雷達接收上市與上櫃即時訊號，能依訊號自動連動 K 線、五檔和成交明細。
市場與訊號規則皆可細項多選，設定區可隨時收合。

| 盤中雷達 | 訊號與市場篩選 |
|---|---|
| ![盤中雷達連動 K 線、五檔與成交明細](docs/images/intraday-radar-live.png) | ![盤中雷達訊號與市場篩選](docs/images/intraday-radar-filters.png) |

## Features 功能

- **即時行情** — 單一 SSE 連線串流 tick / 五檔，自選清單成交閃動（只在真實成交時閃，試撮不閃）
- **K 線圖** — lightweight-charts，1m/5m/15m/60m/1D，即時 tick 更新當根 K 棒，
  **歷史無限回溯**（往左拖自動載入更舊 K 棒，最多三年）
  - **點價下單**：點圖表價位直接限價買賣
  - **停損 / 停利**：舊版瀏覽器觸發送單已停用；存量規則只供人工重建，新版持久化保護完成前不得自動送單
  - **委託管理**：未成交委託顯示為實線、overlay 有 CANCEL 按鈕、**拖曳委託線即改價**
  - **Hover 同步**：十字線價位即時同步到下單面板
- **閃電下單** — 價格梯點擊即下單（左欄買/右欄賣），含安全開關；
  **⚡全開**：自選前 N 檔自動平鋪多個閃電面板（可選排版）
- **鋪單面板** — 一鍵多檔位掛單：靜態鋪單 ＋ 動態追價模式
- **五檔報價** — 量能條視覺化，點價帶入下單面板
- **成交明細** — 開啟即載入歷史 tick，時間精確到微秒
- **下單面板** — 整股/零股、ROD/IOC/FOK、期貨倉別、沖賣 daytrade_short，
  兩段式確認防誤觸
- **組合單** — 期貨/選擇權組合單（價差、跨式…），T 字報價點擊連動兩腳、
  到價監控自動送單
- **持倉 / 委託 / 帳務** — 即時損益、刪單改量、權益數與保證金、
  資產市值加總＋分布圖、零股混合單位顯示（X張+Y股）
- **排行榜** — 漲幅 / 量 / 額多條件複選 scanner（含放空篩選）、顯示類別、
  點擊即加入追蹤
- **類股熱力圖** — 指數 → 類股熱度總覽 → 點進類股看個股
- **交易安全** — 風控 Kill Switch（單筆上限/日虧上限/一鍵鎖單）、
  Esc×2 全部刪單、舊版瀏覽器括號單與交易觸發器已 fail-closed 停用、持倉一鍵平倉/反手、
  委託改量、下單預估成本（手續費/稅/契約值）
- **快捷鍵** — B/S 切換買賣、Esc×2 全刪單、⌘K 商品搜尋跳轉（支援中文股名）
- **技術指標** — 21 種內建（主圖均線/通道/SAR/SuperTrend，副圖 MACD/RSI/KD
  等震盪指標），TradingView 式選擇器與設定視窗（色盤/線型/時框顯示/
  我的預設），副圖獨立窗格、圖上 legend 即時數值
- **自訂指標** — 面板內用 JavaScript + `ta.*` 函式庫寫自己的指標
  （`plot()`/`hline()` 宣告輸出），Web Worker 沙箱驗證（自動擋無窮迴圈）、
  自動偵測輸出線，寫完與內建指標同等待遇（設定/樣式/收藏全套）
- **大盤狀態列** — 加權指數與台指期基差常駐頂部
- **市場脈動** — 自算指數對照官方指數、時間差與期現差，成分股貢獻、
  產業貢獻熱力圖、產業到主要個股的貢獻傳導可自由組合顯示
- **盤中雷達** — 上市／上櫃即時訊號，規則與市場細項多選，訊號出現時可自動
  連動 K 線、五檔與成交明細
- **到價警示** — 圖上點擊設警示線（只通知不下單），音效＋toast
- **分析面板** — 損益分析（權益曲線/勝率/賺賠比）、分價量表＋內外盤比、
  個股籌碼卡（融資券/借券/處置股）、選擇權 T 字報價（TXO）、
  選擇權損益圖（買方/賣方到期損益）
- **行情回放** — 重播當日歷史 tick 練盤感（1x–100x 變速）
- **委託簿熱圖** — 五檔掛單牆的時間序列視覺化
- **自選清單** — 漲跌幅排序、列備註、迷你走勢圖（可開關）、拖曳排序
- **自訂版面** — react-grid-layout 拖拉移動/縮放，面板可任意新增（多開 K 線圖）、
  每個面板可「連動自選」或「鎖定商品」、可彈出成獨立視窗（多螢幕）、
  版面可命名儲存/載入，內建多組預設版面
- **通知中心 / 診斷面板** — 委託回報時間軸、系統事件、App 版本與連線診斷
- **隱私模式** — 一鍵遮蔽帳號與金額（demo / 截圖 / 直播用）
- **音效回報** — 成交/委託/警示分音色（可關閉）
- **斷線自癒** — SSE 重連後自動重新訂閱所有商品；斷線時自動鎖定下單按鍵
- **主題** — 深色 / 純黑 / 淺色 × 紅漲綠跌(台式) / 綠漲紅跌(美式)，字級可調

| Dark | Light |
|------|-------|
| ![dark](docs/shot-terminal-dark.png) | ![light](docs/shot-terminal-light.png) |

## 智慧下單安全邊界（開發中）

工作區可加入「智慧下單」面板，但目前仍是 **simulation-only、observe-only**
的本機基礎設施：策略草稿可保存，所有 broker 寫入與自動寫入總開關維持封鎖。

- 這是 Mac 本機持續監控，不是永豐券商雲端智慧單；關機、睡眠、斷網、
  行情或交易 session 中斷時，不會繼續監控。
- 觸發條件成立不等於 broker 已接受或成交；結果未知時禁止自動重送。
- 外部 App、人工委託或部位變動可能使本機保留量失效，系統必須停止自動動作並
  要求人工對帳。
- 即使未來切到正式環境，也不得把本機智慧下單當成唯一停損、停利或風險保護。
- RealTimeStock 規劃的股票本機上限是同一已驗證身分跨固定股票帳號共 20 筆，
  且 paused、recovery、manual 與仍有 broker／保護義務等較保守狀態仍計入。
  這和大戶投「同一 ID 跨帳號台股＋期權合計 20 筆」的券商雲端額度是兩套不同資源；
  本機不會讀取、占用或同步券商雲端額度。
- 現有瀏覽器括號單與 `localStorage` 交易 trigger 是舊流程，現已停用 broker authority；
  存量停損／停利只顯示「待人工重建」且永不自動匯入或送單。純 alert 仍可在頁面開啟時通知，
  但沒有常駐 sidecar、帳號固定、重啟復原或 exactly-once 保證。

本機 sidecar 的 Node、私有儲存、mode switch、uninstall 與 write-locked 狀態請見
[智慧下單本機 sidecar Runtime](scripts/smart-order-runtime/README.md)。

> 平台範圍：RealTimeStock一般前端與桌面主程式仍維持下方既有Apple Silicon／Intel macOS、Windows與Linux支援；只有本change新增的智慧下單sidecar／Node `node:sqlite`交易Runtime，第一階段正式支援原生Apple Silicon `arm64` macOS實機。Intel／`x64`、Rosetta、VM、Windows與Linux不啟動智慧下單sender，也不取得broker authority；未來Intel交易Runtime將另立OpenSpec change。

## Desktop App 桌面版（推薦）

到 [Releases](https://github.com/Sinotrade/shioaji-pro-app/releases) 下載對應平台安裝檔
（macOS `.dmg`、Windows `.msi`、Linux `.AppImage`/`.deb`/`.rpm`）。桌面版特色：

系統需求：macOS 13.3+（Apple Silicon / Intel）、Windows 10/11 x64、Linux x86_64。

上述是RealTimeStock一般桌面主程式的系統需求，不表示智慧下單交易Runtime支援所有平台；該Runtime目前僅支援原生Apple Silicon `arm64` macOS實機。

- **AI Agent** — 多供應商（Claude / Codex）agentic 對話、shioaji 技能市集、
  排程任務、操作觀察學習（桌面版專屬）
- **策略回測** — 用 JS 寫進出場策略（與自訂指標同一套 `ta` 函式庫）、
  含手續費/證交稅/期交稅/滑價的回測引擎（訊號收盤成立、次根開盤成交，
  無未來函數）、單商品與自選清單多商品整合績效（合併權益曲線＋可排序
  商品表）、進出場標記直接畫在 K 線上（桌面版專屬）
- **內建 shioaji server**（sidecar）— 不需另外安裝 CLI
- **伺服器管理介面** — header「伺服器」選單：啟動/停止/重啟、健康狀態、
  PID/port、token 效期；API 金鑰在介面填寫（存於本機 App 資料夾）
- **模擬/正式環境切換** — 介面上切換，重啟伺服器生效
- **系統匣（Menu Bar）** — 關閉視窗縮到系統匣常駐；匣選單可叫回視窗、
  開伺服器管理、檢查更新
- **自動更新** — 啟動時靜默檢查，GitHub Releases 簽章驗證後自動更新重啟
- **多視窗 Popout** — 面板 ⧉ 彈出為原生視窗，多螢幕交易
- **單一實例** — 重複開啟自動聚焦既有視窗

> 桌面版外殼（Tauri）、AI Agent 與策略回測為專屬模組，不在本 repo ——
> 本 repo 可 build 出完整的 Web 版終端（CI 持續驗證），桌面版請直接下載安裝檔。

## Getting Started 開始使用（Web 版）

### 1. Prerequisites 前置需求

- 永豐金證券帳戶 + Shioaji API Key/Secret
  （在 [API 管理頁](https://www.sinotrade.com.tw/newweb/PythonAPIKey/) 建立）
- [Node.js](https://nodejs.org/) 24.15.x LTS（`>=24.15.0 <25`）與
  [pnpm](https://pnpm.io/)
- Shioaji CLI：

```sh
# 推薦用 uv 安裝
uv tool install shioaji
# 或下載 standalone binary，見 https://sinotrade.github.io/
```

### 2. Configure credentials 設定金鑰

```sh
cp .env.example .env
# 編輯 .env，填入你的 SJ_API_KEY / SJ_SEC_KEY
```

> `.env` 已被 `.gitignore` 排除，**請勿** commit 你的金鑰。

### 3. Start the Shioaji server 啟動行情/交易伺服器

```sh
shioaji server start          # 預設模擬環境（紙上交易）
shioaji server check          # 確認狀態
```

預設跑在 `http://127.0.0.1:8080`，**simulation 模式**——下單不會動用真錢。
切正式環境：`shioaji server start --production`（需先完成 CA 憑證設定，
請務必先在模擬環境完整測試）。

### 4. Run the app 啟動前端

```sh
pnpm install
pnpm dev
```

開啟 [http://localhost:5173](http://localhost:5173) —— dev server 會把
`/api` 代理到 `localhost:8080`。

### 5. macOS 常駐與正式行情唯讀切換

本機長時間測試可使用安全 runtime 指令，讓登入後預設自動啟動 simulation，
並以 business-session watchdog 自動處理「HTTP 仍健康但 simulation session 已失效」，也可用手動命令暫時切換正式行情唯讀：

```sh
pnpm local-runtime install
pnpm local-runtime status
pnpm local-runtime production-readonly
pnpm local-runtime simulation
```

完整的安裝、回復與安全邊界請見
[macOS 本機常駐與安全模式切換](docs/local-runtime-macos.md)。

Mac 關機後登入通常會自動恢復 simulation；也可在終端機執行下列安全啟動檔。服務已正常時不會重啟或中斷既有行情連線：

```sh
cd /Users/alanyi/Documents/RealTimeStock
./start-realtimestock.command
```

watchdog 只會在已曾成功的 simulation generation 連續偵測到 `SessionNotEstablished` 時，以有限次數與退避策略重啟 8080 simulation API；不會操作 production、5173、5174、D1、盤後 pipeline、CA 或交易 API。5173 會保持可操作的 `OFFLINE` 工作區並自動重載自選清單。

Gate 0 Task 0.3 若只缺當次實際 simulation 委託事件，可在「另一個已取得該次 simulation 操作授權的外部 client」即將操作時，啟動最多 90 秒的純觀察視窗。這 90 秒只包容 CLI 互動、雙重 simulation attestation 與 response-linked event correlation；一次性授權 envelope 仍只有 60 秒：

```sh
node scripts/smart-order-readonly-gate-runner.mjs \
  --observe-external-order-event \
  --confirm=I_CONFIRM_READONLY_OBSERVATION_OF_SEPARATELY_AUTHORIZED_EXTERNAL_SIMULATION_EVENT
```

這個 runner 只執行固定 managed simulation 帳號的唯讀對帳與事件觀察，不會 place、update、cancel、重試或 cleanup，也不會開啟 write master。行情可來自真實即時行情，但帳號、委託、委託回報與成交回報仍全部屬於 Shioaji simulation，不是 production 或真實下單。fixture、快取、舊事件與過期報告均不能代替當次實際 simulation `order_event`；結果不明或任一指紋漂移時必須 fail closed。

### 6. MultiView 多圖看盤（本機）

「版面」選單的 `MultiView（開新分頁）` 會開啟
[http://localhost:5174](http://localhost:5174)。MultiView 支援 1／2／3／4／6／8
圖，提供 1／5／15／60 分 K 與日、週、月 K。這裡的「分 K」是分鐘 K 線；
1／5／15／60 分 K 會在相鄰台北日期之間繪製 1.2 CSS px 亮黃色分日線，日／週／月
K 不套用。台股預設優先使用本機 Shioaji 即時行情，無可用 business session 時
會在畫面標示並原子切換 Yahoo 延遲備援。台股整股圖表的 canonical 成交量單位為
`common_lot`（張）：Shioaji lot 不換算，Yahoo／TWSE shares 除以 1,000 並保留
小數張。同一批 Shioaji Kbars 可與主交易畫面精確比對；fallback 只保證單位與
payload 內部一致，不保證不同 provider 的來源值完全相同。國外商品與 MultiView
自己的「我的清單」仍沿用原有資料來源與獨立設定，不會與交易終端自選清單同步。

MultiView 的 K 棒 readout 會在成交量後顯示 `值 …萬`，tooltip／accessible name
使用完整的 `成交值 …萬元`。非空值只接受本機 Shioaji simulation 同次回應的
`KBars.Amount`，forming K 只接受可信 Tick `amount／total_amount`；5／15／60 分與
日 K 由同一批精確元值聚合。Yahoo、國外商品、指數、缺漏或舊 schema 一律顯示
`值 —`，不得用 OHLC、成交量、均價或 `weightedAmount` 推算。這是文字 readout，
沒有成交值軸、series、設定、D1 寫入、production／CA 或 broker authority。

主交易畫面的日 K 觀察模式可雙擊有效 K 棒，以該棒的 `Asia/Taipei` 日期向既有
本機 Shioaji simulation market-data adapter 請求 start／end 相同的單日 1 分 K；
完整驗證後才原子切到 `1m`。MultiView 單擊仍立即交給目前圖表工具；2／3／4／6／8
圖合法雙擊以目前商品與週期開啟單圖新分頁，圖表數量為 1 時則由有效且已完成的日 K
啟動相同 exact-date 契約並在原 panel 切換。兩條路徑都不會取得 broker authority、
送出委託或啟停服務。

MultiView exact-date response v2 會把同日每根 1 分 K 的 Amount、成交值來源／schema
與 `available／partial／unavailable` 綁進不可變 snapshot；商品、日期、週期、panel
generation 或 request identity 任一漂移都整份丟棄。Amount 缺漏不阻擋合法 OHLCV，
但對應 readout 只顯示 `值 —`；返回一般日 K 時仍依目前 provider 重新載入，不把
單日 simulation Amount 寫入 Yahoo、Cloudflare 或 D1 資料。

第一次使用前先建立 repo 外的本機 D1，再啟動兩個前端：

```sh
pnpm multiview:state migrate
pnpm dev
pnpm dev:multiview
```

若使用 macOS 常駐模式，`pnpm local-runtime install` 會一併管理 8080、5173、
5174 與有界盤後資料排程，且登入後仍預設 simulation。MultiView 右鍵「下單」
只會把已解析的 STK／WRT 商品帶回 5173 下單面板，不傳送買賣別、價格、數量、
帳號或憑證，也不會直接呼叫下單 API。MultiView 本階段僅支援 simulation；
RealTimeStock 切至其他模式時會停止 5174，手動啟動也不會讀取該模式行情。

完整資料位置、備份／回復、排程、來源狀態、授權與安全限制請見
[MultiView 本機操作與安全邊界](apps/multiview/docs/local-runtime.md)。

## Deploy as a Shioaji custom app 部署為內建 App

Shioaji server 可直接代管前端，build 完上傳即可：

```sh
VITE_BASE=/apps/shioaji-pro-app/ pnpm build
cd dist
ARGS=(); for f in *; do ARGS+=(-F "files=@$f"); done
curl -X POST http://localhost:8080/api/v1/apps/shioaji-pro-app "${ARGS[@]}"
```

然後開啟 `http://localhost:8080/apps/shioaji-pro-app/index.html`。
（注意：上傳的 app 存在 server 記憶體，server 重啟後需重新上傳。）

## Safety notes 安全提醒

- 預設為**模擬環境**；頂部會顯示「模擬環境」徽章，正式環境為紅色「正式環境」
- 閃電下單預設**鎖定**，需手動啟用；圖表點價下單為 one-shot 模式
- 舊版停損/停利客戶端觸發送單已停用；目前只有純到價提醒會在頁面開啟時監控
- 正式環境的每一筆委託都是真實交易，請自行承擔風險

## Stack

- React 19 + TypeScript + Vite 8
- [vanilla-extract](https://vanilla-extract.style/) — zero-runtime themable CSS
- [lightweight-charts](https://tradingview.github.io/lightweight-charts/) v5
- [react-grid-layout](https://github.com/react-grid-layout/react-grid-layout) v2
- Shioaji HTTP API + Server-Sent Events

## License

[GNU AGPL-3.0](LICENSE) — 介面 100% 開源，但這是強 copyleft 授權：

- **可以**自由使用、修改、學習、fork
- **商用條件**：任何基於本專案的修改或衍生作品（包括架成網路服務提供他人
  使用）都**必須以 AGPL-3.0 完整開源**
- 不願開源的商業使用，請聯繫永豐金證券洽談**商業授權**（dual licensing）

External contributions: by submitting a PR you agree to license your
contribution under AGPL-3.0 and grant the maintainers the right to
include it in dual-licensed distributions.
