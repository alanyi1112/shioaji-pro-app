## 1. 啟用前 Gate 與安全基線

- [ ] 1.1 取得並保存不含帳號、個資與秘密的永豐金條款／確認摘要，證明 API 登記人本人以單一 owner 私人登入網站自用展示的方式可接受；技術限制不能取代授權確認，未成立前 production feature flag 保持關閉
- [x] 1.2 選定盤中不休眠的 gateway 主機與 service supervisor，記錄作業系統、校時、自動重啟、網路及故障切換需求
- [x] 1.3 選定 OS 級 secret provider 與專用低權限 service identity，驗證 Shioaji API key／secret 不出現在 repo、同步資料夾、一般備份、shell profile、command line 或 process listing
- [x] 1.4 完成 gateway、Cloudflare ingest 與瀏覽器三個 trust domain 的 threat model，列出 credential 讀取、傳輸、輪替、撤銷、replay、log、crash dump 與事故處理邊界
- [x] 1.5 核對 `deploy-cloudflare-private-small-group-free-tier` 的 D1 24 小時穩態 gate；未證明既有正式站低於安全預算前，不得啟用新增 realtime production 負載

## 2. Shioaji Data-only Gateway 基礎

- [x] 2.1 建立獨立 gateway 模組、固定 Shioaji 相容版本與 simulation adapter，正式 credential 未注入時必須 fail closed
- [x] 2.2 實作由 OS secret provider 注入 credential 的設定介面，禁止將真實 key／secret 放入 `.env`、fixture、CLI argument、source、CI 或 artifact
- [x] 2.3 實作 data-only 登入，停用委託成交回報且不載入 CA；以契約測試證明 gateway 不提供下單、改單、刪單、帳務或部位能力
- [x] 2.4 實作 Tick callback 的有界佇列與 latest-value coalescing，callback 內不得執行網路、歷史查詢或阻塞聚合
- [x] 2.5 正規化 canonical symbol、exchange、session date、台北來源時間、OHLC、均價、單筆／累計量、simtrade 與遞增序號
- [x] 2.6 實作 allowlist logging 與安全 reason code，禁止輸出環境變數、request header、帳戶物件、exception locals、credential 或完整上游 response
- [x] 2.7 新增 source、fixture、build artifact、service log 與 health 的 secret pattern scan；命中疑似 key、secret、authorization、cookie 或帳戶識別時 gate 必須失敗
- [x] 2.8 建立 service supervisor、loopback／firewall、校時、啟停、health、bounded reconnect 及主機睡眠防護
- [x] 2.9 撰寫 Shioaji credential 與 Cloudflare ingest secret 各自的建立、輪替、撤銷、疑似外洩停用及恢復 runbook，全程只使用 placeholder

## 3. 訂閱、Session Buffer 與新增商品回補

- [x] 3.1 實作預設台股與唯一 owner 清單聯集的 active universe，初始硬上限 32 檔並保留可依 pilot 下調的設定
- [x] 3.2 實作 symbol 級訂閱 reference count、single-flight 與 unsubscribe 冷卻，多 panel／多使用者不得重複登入或訂閱
- [x] 3.3 將個人清單新增台股事件接入 gateway control plane，立即排入訂閱並回報 `started`、`already-subscribed`、`capacity` 或安全失敗狀態
- [x] 3.4 建立有界當日 ring buffer，以來源時間與序號去重，重啟或清理不得影響 canonical candle history
- [x] 3.5 實作新增商品盤中缺口回補：先使用 session buffer，不足時每商品／交易日最多執行一次當日 Kbars 查詢並接續 Tick
- [x] 3.6 為 Shioaji 登入、訂閱、歷史查詢與重試建立 provider 預算、single-flight、cooldown、backoff 及 circuit breaker，不得盤中輪詢 snapshots／ticks／kbars
- [x] 3.7 處理 reconnect gap、倒序、重送、跨日與休市；缺口不可安全補齊時必須公開 partial／stale 狀態

## 4. Cloudflare Realtime Hub 與授權

- [x] 4.1 新增 SQLite-backed Durable Object、namespace migration、Wrangler binding 與本機測試設定，不覆蓋既有 D1 或 Sites hosting 設定
- [x] 4.2 實作 gateway outbound WebSocket ingest，以獨立 hosted secret、timestamp、connection ID 與 monotonic sequence 驗證並拒絕 replay
- [x] 4.3 實作一秒有界微批次 contract，只接收 allowlist 行情欄位與安全 metadata，payload 過大或 symbol 不合格時 fail closed
- [x] 4.4 實作 hub 的 latest snapshot、短期 session buffer、symbol subscription 與 WebSocket Hibernation；不得把 Tick 或每秒更新寫入 D1
- [x] 4.5 實作已登入瀏覽器的 page-scoped WebSocket，一頁最多八圖共用一條連線並只訂閱可見 canonical symbols
- [x] 4.6 實作 gateway `live`／`degraded`／`stale`／`unavailable`、Yahoo `fallback` 與 `closing`／`closed` 狀態機
- [x] 4.7 擴充 `/api/health` 安全摘要，只公開 realtime enabled、gateway state、source age、subscription count、drop／replay count 與 quota，不含 credential、帳戶識別或原始 Tick
- [x] 4.8 新增 Worker、Durable Object requests／GB-s、D1 reads／writes 與 gateway 負載的安全線和自動降載，先停非可見商品與非必要回補，再停止新增訂閱
- [x] 4.9 新增 deployment-target capability 與 feature flag；Cloudflare 預設 false，Sites 保留站固定停用且不得嘗試讀取 realtime binding 或 secret
- [x] 4.10 將 Cloudflare 正式站固定為單一 active owner：`member` 與其他身分整站 fail closed、站內不得新增登入帳號，且信箱不得硬編碼於 source 或前端
- [x] 4.11 將 owner 清單與可見 panel demand 改為去識別完整集合取代；刪除、背景、關閉或錯誤時釋放 gateway reference，預設 universe 不得被誤退訂

## 5. 日週月 K 線 Realtime Overlay

- [x] 5.1 建立 canonical history、period base 與 realtime overlay 的資料 contract，包含 provider、period key、session date、source time、received time、freshness 與 provisional 狀態
- [x] 5.2 實作日 K overlay，以今日第一筆 open、日內 high／low、最新 close 與累計 volume 更新最右側 K 棒
- [x] 5.3 實作週 K 與月 K period base，只聚合今日以前的已完成日資料，再合併今日 overlay
- [x] 5.4 排除或原子取代 Yahoo 同日／同週／同月 provisional row，禁止兩個來源的 OHLCV 或成交量重複計入
- [x] 5.5 實作來源時間、序號與 session date 檢查，倒序、重送或跨日 Tick 不得倒退 latest close、high／low 或累計量
- [x] 5.6 讓日週月主 K 棒、最新價、漲跌、成交量、動畫與 quote metadata 共用同一 snapshot，多 panel 同商品結果必須一致
- [x] 5.7 保留既有完整 indicators 有界批次更新，先讓主 K 棒逐筆更新；不得因每秒重算整段 indicators 超過 Workers Free CPU
- [x] 5.8 實作 Shioaji stale 後的完整 Yahoo snapshot 原子 fallback，明確顯示「延遲備援」且不得繼續標示即時
- [x] 5.9 實作 closing／closed 交接：canonical 日 K 可用且官方核對完成後移除 overlay，週月由 canonical 日資料重算
- [x] 5.10 核對週期選單沒有新增「即時 1 分 K」或其他 1 分 K；本變更只修改既有日、週、月盤中尾端

## 6. 分時走勢圖

- [x] 6.1 新增「分時」主圖模式與 capability-aware UI；不支援的商品、Sites 保留站或 feature flag 關閉時須隱藏、停用或顯示能力不可用
- [x] 6.2 實作當日成交價折線、成交均價線、昨收基準、最新價、開高低、累計量與台北來源時間
- [x] 6.3 實作固定時間成交量 bucket，逐筆 Tick 全部納入語意但前端以 animation frame 或 250ms～1 秒有界重繪
- [x] 6.4 首次開啟分時時先載入 session buffer／一次性 Kbars 回補，依來源時間去重後接續 Tick，不得從開啟畫面時刻才開始畫
- [x] 6.5 顯示即時、連線不穩、資料過期、行情中斷、Yahoo 延遲備援、收盤整理與已收盤等可見狀態
- [x] 6.6 切換商品、換頁、背景、離線、回前景與銷毀 panel 時更新 page-scoped subscription，回前景先取得 latest snapshot 或缺口補齊
- [x] 6.7 分時模式暫停不相容的費波那契、pivot、volume profile 與 K 線技術 pane，但保存設定並在切回日週月後完整恢復
- [x] 6.8 驗證 1／2／3／4／6／8 圖、多個分時 panel、同商品重複 panel、雙擊單圖與 page-scoped 一條 WebSocket

## 7. 自動測試與安全驗證

- [x] 7.1 新增 gateway simulation 測試，涵蓋 login fail closed、no-order、callback bounded queue、正規化、倒序、重送、跨日、reconnect 與 quota
- [x] 7.2 新增 API key 安全測試，涵蓋 OS secret handle、檔案權限 fallback、command-line／log／exception redaction、artifact scan 與獨立輪替
- [x] 7.3 新增 ingest／Durable Object 測試，涵蓋合法授權、偽造 secret、過期 timestamp、replay sequence、payload 上限、hibernation 與 quota circuit breaker
- [x] 7.4 新增 realtime state machine 與 Yahoo fallback 測試，確認 provider、OHLCV、source time 與 freshness 原子切換
- [x] 7.5 新增日週月 overlay 測試，涵蓋 provisional 取代、週月 base、成交量不重複、跨期、收盤 canonical 交接及多 panel 一致
- [x] 7.6 新增分時 renderer 測試，涵蓋 buffer 回補、Tick 去重、均價、昨收、volume bucket、重繪節流、狀態與偏好恢復
- [x] 7.7 新增雙部署回歸，確認 Cloudflare feature flag fail closed、Sites 保留站無 realtime binding 仍完整運作、非台股與籌碼／本益比不受影響
- [x] 7.8 擴充 Cloudflare budget checker，估算一秒 gateway 微批次、單一 owner、八圖、32 檔、Durable Object request／GB-s 與 D1 zero-tick-write
- [x] 7.9 新增單一 owner 授權、member 拒絕、清單完整取代、空集合釋放、WebSocket close/error 與 unsubscribe cooldown 回歸測試

## 8. Pilot、正式驗收與發布

- [x] 8.1 使用 simulation 先完成本機與 preview 全流程，執行 lint、完整 tests、兩個 production builds、OpenSpec strict、`git diff --check`、secret scan 與 budget gate
- [ ] 8.2 由 operator 在 gateway 主機的 OS secret provider 注入真實 credential；全程不得把 key／secret 輸入 repo、Codex 對話、CI、Cloudflare、Sites、D1 或 Obsidian
- [ ] 8.3 以兩檔台股完成一個真實交易日 pilot，核對來源時間、OHLCV、分時線、回補、斷線、reconnect、Yahoo fallback 與官方收盤
- [ ] 8.4 擴至現有預設台股並連續驗證至少三個真實交易日；逐日保存不含個資與秘密的延遲、drop、replay、subscription 與來源比對摘要
- [ ] 8.5 驗證新增商品盤中立即訂閱、開盤至當下回補、部分資料立即可見、重複新增 single-flight 與容量不足 fallback
- [ ] 8.6 量測 Cloudflare Worker requests／CPU、Durable Object requests／GB-s、D1 reads／writes／storage 與錯誤率；既有及新增負載皆低於安全線前不得啟用 production
- [ ] 8.7 以已授權 Cloudflare 正式站瀏覽器驗證日週月 K 棒逐筆變化、分時走勢、來源標示、八圖共用連線、背景恢復與收盤交接
- [ ] 8.8 驗證 Sites 保留站、Yahoo 延遲模式、所有非台股頁籤、籌碼、本益比、清單與登入管理無回歸
- [ ] 8.9 gates 全部成立後分階段啟用 Cloudflare feature flag；等待 exact-commit deploy 並監測至少一個完整交易日
- [ ] 8.10 執行 feature-flag rollback 演練，確認可立即停止 gateway uplink 並恢復既有批次行情，不刪除 canonical history 或影響 Sites
- [x] 8.11 更新繁體中文部署、gateway service、秘密輪替、事故處理、降載、回滾與驗收文件，最後再判定是否可歸檔

## 9. 本機 MultiView 整合修正

- [x] 9.1 將 RealTimeStock「版面」選單的 MultiView launcher 改為每次使用 `_blank` 建立新分頁，新增連續呼叫測試，並以瀏覽器確認按兩次產生兩個不同的 `127.0.0.1:5174` 分頁
- [x] 9.2 在 Yahoo 上游轉換、candle history 合併／讀回與 API 圖表輸出加入 OHLCV 結構驗證，拒絕零價、負成交量與不合理 high／low，同時保留結構合法的負價格商品
- [x] 9.3 升級 candle cache contract；先備份本機 D1，再以 TWSE 官方 OHLCV 取代 0050／0056 的 2026-08-06 異常日 K、清除相關舊 cache，並通過 integrity、API 連續交易日與圖表價格尺度驗收
- [x] 9.4 將一般商品右鍵功能表縮為約 `176px`、長篇詳細資料展開時才加寬；將同頁下單面板背景遮罩調為 `rgba(2, 6, 23, 0.52)` 與 `blur(2px)`，保留關閉及焦點恢復行為
- [x] 9.5 完成 root 144 項測試、MultiView 467 項測試、lint、兩個 build、`git diff --check`、simulation runtime、business session、5173／5174 與 D1 health 驗證
