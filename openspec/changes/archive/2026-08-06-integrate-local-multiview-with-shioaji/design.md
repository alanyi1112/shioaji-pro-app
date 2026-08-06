## Context

RealTimeStock 目前由 `127.0.0.1:5173` 的 Vite Web 透過 `/api` proxy 連到 `127.0.0.1:8080` 的 Shioaji HTTP／SSE server，`scripts/realtimestock-runtime` 以 macOS LaunchAgent 管理本機服務。RealTimeStock 已有商品契約解析、Snapshot、1 分 Kbars、單一 SSE、訂閱／取消訂閱與 OrderTicket popout；本 change 僅讓 MultiView 在 simulation 使用這些資料能力。

參考 repo `alanyi1112/MultiChartOnCodexSite` 的遠端 `main` 落後於最新維護分支；本 change 研究時可驗證的最新功能基準是 `codex/restore-cloudflare-small-group-login` commit `ecae7cac837f06085801c96f3da0c570051d66e7`。該程式以 vinext／Cloudflare Worker／D1 與靜態 JavaScript 實作 1／2／3／4／6／8 圖、Yahoo／Hyperliquid、技術指標、台股官方收盤核定、籌碼副圖、TDCC 與 PE 回補。歷史上的 Shioaji realtime branch 已停止 Cloudflare 方案，雖保留日／週／月 provisional overlay、來源狀態與 fallback 測試，仍含本 change 不需要的分時模式，且即時 snapshot 尚未完整更新所有技術指標，不能直接 merge。

使用者確認 MultiChart 應用程式由本人以 TradingView Lightweight Charts 自行開發。Lightweight Charts v5.0.9 為 Apache-2.0 dependency；MultiChart 自有程式將明確採 `AGPL-3.0-only`，保留 Apache 授權、NOTICE 與可見 attribution。正式匯入基準必須是完成授權整理後的新完整 SHA，而非直接把目前 dirty sibling checkout 複製進來。

Shioaji `/api/v1/data/kbars` 只提供 1 分 K；若以它取代全部長期日 K，會形成不合理的 payload 與啟動延遲。因此本設計把「盤中即時來源」和「已完成 canonical 歷史／盤後資料」分層：Shioaji 主導當期 provisional bar，既有 MultiChart 管線主導已完成歷史與收盤核定。MultiView 只在本機 loopback 執行，不把 Shioaji 即時行情傳到 Sites、Cloudflare 或其他主機。

## Goals / Non-Goals

**Goals:**

- 將可追溯、可授權的最新 MultiChart 功能基準完整納入 RealTimeStock repo 與本機 runtime。
- 在 RealTimeStock「版面」提供開新分頁的 MultiView 入口，維持兩套清單、商品內容與設定各自獨立。
- 全商品只開放日、週、月 K，預設日 K，並讓台股當期 K 棒、最新價與可計算技術指標隨 Shioaji 行情更新。
- 保留 Yahoo 延遲模式與自動 fallback，維持非台股來源及台股歷史、官方核定、籌碼、PE、TDCC 下載回補能力。
- 以資料專用 allowlist 隔離 MultiView 與 Shioaji，右鍵「下單」只開既有 OrderTicket，不在 MultiView 建立第二套交易邏輯。
- 將 MultiView 服務、D1、排程、備份與診斷納入可重複安裝、切換、回復及驗收的本機操作流程。

**Non-Goals:**

- 不啟用 1 分、3 分、5 分、15 分、30 分、60 分、4 小時或「分時」圖。
- 不以 Shioaji 1 分 K 取代全部長期歷史，也不把 Tick 全量保存到 D1。
- 不合併 RealTimeStock watchlist 與 MultiView「我的清單」，不建立雙向同步。
- 不改變國外商品資料來源、商品定義或 fallback。
- 不部署 MultiView 到 Sites／Cloudflare，不把 Shioaji 行情、秘密或交易能力暴露到外部網路。
- 不讓 MultiView 取得或驗證任何非 simulation 的 Shioaji 行情；切換至其他模式時停止 5174，正式環境行情留待獨立 change。
- 不新增 `production-trading`，不載入 CA，不執行真實下單；正式交易留待獨立 change。
- 不在本 change 順便升級 Lightweight Charts 5.0.9 到 5.2.0；版本統一需另做回歸。

## Decisions

### 1. 以乾淨、授權完成的 upstream SHA 匯入單一 repo

實作先在參考 repo 補齊 `LICENSE`、`package.json` license、README、`THIRD_PARTY_NOTICES.md`、Apache-2.0 副本與 TradingView attribution，完成來源掃描後產生新的完整 SHA。RealTimeStock 再以可追溯的 subtree／等效保留來源方式匯入 `apps/multiview/`，並建立 `UPSTREAM.md` 記錄 URL、branch、SHA、日期、授權與本地修改。

不直接複製現有 sibling checkout，因為其未追蹤檔案與 branch 狀態可能污染匯入；不使用只記 URL 的 submodule，因為使用者要求完整整合且本機化修改需與 RealTimeStock 原子版本化。若來源有非本人實質貢獻或授權不明的 vendored code，該檔案在釐清、替換或取得許可前不得匯入。

### 2. MultiView 保持獨立本機服務，由同一 runtime 管理

MultiView 依賴 vinext、Worker API 與 D1 語意，硬塞進 RealTimeStock 單一 Vite bundle 會重寫大量 routing／storage 並提高回歸風險。因此保留獨立 process，預設只監聽 `127.0.0.1:5174`；RealTimeStock 維持 `127.0.0.1:5173`，Shioaji 維持 `127.0.0.1:8080`。

根目錄新增 pnpm workspace／一致的安裝與驗證入口，但 MultiView 仍有自己的 package、build 與測試。`scripts/realtimestock-runtime` 增加 MultiView LaunchAgent、port wait、health、status、install／uninstall 與重啟流程。MultiView API 不可用時，RealTimeStock 本身仍須可用；Shioaji session 不可用時，MultiView 仍可用既有延遲／盤後資料。

本機 D1／Miniflare state 放在 `~/Library/Application Support/RealTimeStock/MultiView/` 或等效權限受限位置，不放在 repo；migration 前先備份，匯入後執行 transaction、`PRAGMA integrity_check`、schema version 與代表商品 coverage 驗收。

### 3. Shioaji adapter 採同源 data-only allowlist

MultiView 瀏覽器只呼叫自身 origin 下的 `/local-shioaji/api/v1/...`。MultiView server 將允許的請求 proxy 到 loopback Shioaji server，避免跨 port CORS，並在 routing 層逐 path、method、body、symbol count 與 response size 驗證。初始 allowlist 只含：

- `GET /info` 與必要的唯讀 health。
- 商品契約 base／info 查詢。
- `POST /data/snapshots`、`POST /data/kbars`。
- `GET /stream/data`。
- `POST /stream/subscribe`、`POST /stream/unsubscribe`。

任何 `/order/`、帳務、CA、token、server 管理或未列入 allowlist 的路徑一律在 adapter 端回 `403`，不得轉送。每個行情／契約／串流請求也必須先確認 8080 為 simulation，否則回 `simulation_required` 且不得轉送目標請求。proxy 不記錄 request body、response payload、secret、帳號或完整行情，只保留去識別化計數與安全 reason code。

### 4. 商品正規化先解析契約，再決定即時資格

MultiView canonical symbol 與 Shioaji contract 分開保存。`.TW`／`.TWO` 先去除 suffix 後呼叫 contract lookup，使用回傳的 `security_type`、`exchange`、`code` 與 `target_code` 建立訂閱；`^TWII` 明確映射至 `IX0001`。只有成功解析且資料 shape 通過驗證的台灣商品可使用 Shioaji，解析失敗或尚未建立 business session 時維持延遲來源。

IND 可能沒有可用即時成交量；系統不得以成交金額代替成交量，也不得補零。價格型指標可隨即時價格更新，依成交量的 Volume MA、MFI、Volume Profile 等只有在來源提供合法 volume 時才能標示即時，否則保留 canonical 值並顯示資料限制。非台股商品完全不進入 Shioaji adapter。

### 5. 以完成歷史為基底，原子替換當期 provisional bar

`/api/candles` 仍提供既有 completed canonical history、官方核定與 indicator payload。台股頁面啟動時先取得 history，再用 Snapshot bootstrap 當日 O／H／L／C／total volume，之後接收 SSE。日 K 直接建立或取代當日 provisional；週／月 K 由同 period 已完成日 K 加上當日 provisional 聚合，先移除 payload 中相同 period 的 provisional，避免 OHLCV 重複計入。

來源模式為頁面層級 `自動`、`Shioaji 即時`、`Yahoo 延遲`：

- `自動` 預設；Shioaji business request 成功且資料在 freshness window 內時使用即時，否則原子切換至延遲 payload。
- `Shioaji 即時` 在來源不可用時顯示明確 unavailable／stale，不靜默改稱即時，也不拼接 Yahoo 當期 bar。
- `Yahoo 延遲` 完全停用該頁 Shioaji 訂閱，沿用原批次更新。

fallback 只替換當期 quote／provisional bar，已完成 canonical history 不因來源切換重抓或改寫。收盤後只有 TWSE／TPEx 既有驗證達到 canonical handoff 條件，才移除 realtime provisional 並採用已核定日 K；週／月隨完成日 K重聚合。

### 6. 單一 SSE、商品 ref-count 與即時指標尾端重算

同一 MultiView document 最多建立一條 Shioaji SSE，依可見 panel 的 canonical contract 去重訂閱。同商品出現在多圖只增加 ref-count，不重複 subscribe；最後一個 consumer 離開後採短 cooldown 再 unsubscribe，避免快速切換抖動。頁面隱藏、斷線、重連與銷毀都必須清理，舊 generation 事件不得更新新 panel。

接受 snapshot 後，先合併當期 bar，再以 MultiView 的固定公式重新計算目前選取指標的必要尾端。每個 `symbol + interval + indicator signature` 最多一個 latest-wins job，使用 `requestAnimationFrame` 或 100～250ms 節流；pane／series 結構不因資料更新重建。遞迴指標保留完整前序狀態或等價 checkpoint，結果須與同 candles 的 full recompute 相同。不得每個 Tick 呼叫 `/api/candles` 或寫 D1。

### 7. 全商品只允許日／週／月，採多層防繞過

MultiView local config 只回傳 `1d`、`1wk`、`1mo`，預設 `1d`；前端選單、URL 正規化、localStorage migration、prefetch、batch 與 Worker `/api/candles` 都使用同一 allowlist。舊的 intraday／分 K 實作保留在 source history 或關閉 feature 下，但本機 build 不可由 query string、手動 request 或舊設定啟用。國外商品也套用相同週期限制，但資料來源不變。

### 8. 盤後資料搬到本機執行，來源與語意不變

既有 Yahoo／TWSE／TPEx／TDCC／FinMind provider、欄位、source date、frequency、單位、缺值與不 forward-fill 契約保持不變；只將 Worker target、D1 binding 與 scheduler 改成本機。LaunchAgent／受控腳本在盤後與週末呼叫 localhost internal routes，使用獨立本機 secret handle，不把值寫入 plist、repo 或狀態輸出。

初始資料優先使用經授權的 Cloudflare 權威 D1 data-only export，排除 access、audit、secret 與不需要的身分資料，先備份本機 DB，再 transaction import、完整性及 coverage 驗收；若當次沒有合法授權 session，改用既有官方 bounded backfill，維持功能可用但不宣稱已搬妥歷史 coverage。MultiView 個人清單若需要保留，僅遷移目前使用者的 tabs／instruments 並 remap 成本機 opaque user，不合併 RealTimeStock watchlist。

### 9. 「版面」是外部 action，不是 workspace preset

在 RealTimeStock `ProfilesMenu` 預設版面區加入 `MultiView（開新分頁）` action。click 必須同步開啟設定的 loopback URL，避免非同步 preflight 被 popup blocker 阻擋；新分頁自行呈現服務未啟動、Shioaji 離線、延遲模式或正常狀態。此 action 不修改、保存或重設目前 workspace，也不加入 `LAYOUT_PRESETS`。

### 10. 右鍵下單只橋接既有 OrderTicket

MultiView 主圖右鍵選單新增「下單」。只有已解析為可交易台灣契約且不是 IND 的商品可啟用；非台股、IND、解析失敗或不支援契約顯示停用理由。click 只開啟 `http://127.0.0.1:5173/?popout=ticket&code=<code>` 或等效既有 popout API，訊息只含 canonical code／必要 security type，不含 account、side、price、quantity、order type 或憑證。

MultiView 不直接 import 交易函式，也不擁有任何 order endpoint。OrderTicket 自行重新解析契約並套用 simulation、帳戶、風控與使用者確認。非 simulation、popup 被阻擋、RealTimeStock 未啟動或商品無法解析時，只顯示可回復錯誤，不 fallback 成直接送單。

## Risks / Trade-offs

- [雙服務增加安裝與診斷複雜度] → 由同一 runtime 管理、固定 loopback ports、加入個別 health、status、restart 與不互相拖垮的降級行為。
- [參考 repo 最新功能不在遠端 main] → 以授權整理後的完整 SHA 固定基準，保存 provenance；後續 upstream 更新必須重新比較並提升 import revision，不追浮動 branch。
- [Shioaji business session 可登入但行情仍不可用] → 以 Snapshot／Kbars／契約查詢的 business success 判定，不以 `/health`、登入或 SSE heartbeat 冒充可用。
- [1 分 K 長期資料量過大] → Shioaji 只負責 session bootstrap／當期 bar，深度歷史維持既有 canonical 管線。
- [IND 缺少即時 volume] → 顯示資料可用性，不以 amount、零值或 Yahoo volume 靜默混入即時來源；volume-based 指標不得冒充即時。
- [八圖 Tick 導致 CPU 或訂閱壓力] → 單一 SSE、symbol dedupe、ref-count、visibility pause、latest-wins 與有界節流；建立 1／2／3／4／6／8 圖 browser performance gate。
- [來源切換造成 K 棒或成交量重複] → period key 去重、當期資料原子替換、來源標籤與 canonical handoff fixture。
- [本機 D1 初始 coverage 不足] → 權威 data-only export 與官方 bounded backfill 雙路徑；沒有實際 coverage 證據時不得勾選遷移完成。
- [本機 scheduler 在 Mac 關機時錯過工作] → job 可重入、保存 checkpoint、啟動後補跑 overdue work，且不以預定時間冒充實際成功。
- [Apache／AGPL 或第三方聲明遺漏] → 匯入前完成 ownership、license、NOTICE、vendored assets 與 dependency scan；不明項目先替換或阻擋匯入。
- [右鍵下單被誤解為直接送單] → 選單只開 ticket、文案明示仍需確認、橋接 contract 禁止交易參數，並測試 adapter 永遠拒絕 order routes。
- [MultiView 被手動啟動在非 simulation 模式] → runtime 停止 5174，adapter 再以 `/info` mode gate 回 `simulation_required`；OrderTicket bridge 無法解析契約或開啟 5173。

## Migration Plan

1. 精準保存 RealTimeStock 目前既有、與本 change 無關的工作樹異動；不得將先前 Cloudflare 取消歸檔混入本 change commit。
2. 對參考 repo 執行 ownership／第三方檔案盤點，補齊 AGPL、Apache、NOTICE、attribution 與本機 dependency，通過既有 build／test 後提交並記錄新的 upstream SHA。
3. 從乾淨 clone／fetch 的固定 SHA 匯入 `apps/multiview/`，建立 provenance，先維持 feature 未出現在 RealTimeStock 選單。
4. 建立 pnpm workspace、獨立 5174 local build／health、本機 D1 路徑、migration、備份與 runtime service；先在空白／fixture D1 通過測試。
5. 以合法來源執行 data-only seed 或 bounded official backfill，驗 `PRAGMA integrity_check`、schema、代表 `.TW`／`.TWO`、TDCC、PE 與日期 coverage；個人清單只做選擇性的最小化遷移。
6. 實作 data-only adapter、商品 mapping、單一 SSE、D／W／M overlay、source mode、fallback、indicator latest-wins 與 canonical handoff，先以 simulation／fixtures 驗收。
7. 實作 RealTimeStock「版面」入口與右鍵 OrderTicket bridge，在 simulation 完成 browser-visible 及 popup 測試。
8. 將 MultiView service 納入 runtime install／status／simulation／uninstall，驗重開機預設 simulation、非 simulation 停止 5174 與各服務故障隔離。

回滾時先從「版面」隱藏 MultiView、停止 5174 LaunchAgent 並保留本機 D1 備份；RealTimeStock 5173、Shioaji 8080、既有 workspace 與 watchlist 不受影響。若即時資料異常，只關閉 Shioaji source capability 即回到 Yahoo 延遲模式，不刪除 canonical history 或盤後資料。

## Open Questions

- 授權整理完成後的 upstream 完整 SHA 必須在實作當下寫入 `UPSTREAM.md`、spec fixture 與驗證紀錄；proposal 階段不得預先猜測。
- 初始本機 D1 採 Cloudflare data-only export 或官方重抓，取決於實作當下是否有合法、既有授權 session；無授權時預設走官方 bounded backfill。
- Shioaji 對各類 `.TW`／`.TWO`、WRT 與 IND 的實際 Snapshot／SSE 欄位及 business entitlement 只在 simulation 保存去識別化 evidence；未驗證類型維持延遲來源。
