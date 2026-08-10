## Context

現有前端以 page-scoped `/api/candles/batch` 每 30 秒更新盤中 panel，每次最多八圖；台股與多數市場的 K 線主來源為 Yahoo。D1 `candle_history` 只持久化 `1d`、`1wk`、`1mo`，且近期已完成 changed-tail 與籌碼 canonical no-op 修正，但 Cloudflare Free-tier 的真實 24 小時穩態仍在驗證中。

Shioaji 是需要帳戶登入與常駐 native runtime 的外部 API，提供 Tick、Quote、KBar、歷史 Ticks／Kbars 及本機 HTTP/SSE adapter；Cloudflare Worker 不適合執行其 daemon，也不得取得券商登入秘密。詳見 [proposal.md](./proposal.md) 與本變更的六份 delta specs。

## Goals / Non-Goals

**Goals:**

- 以 data-only Shioaji gateway 提供支援台股的逐筆即時行情，讓日週月最後一根 K 與價格列即時更新。
- 提供獨立「分時」主圖，並在新增商品時立即訂閱及補齊今日 session。
- 以一條 gateway uplink、一個 Cloudflare realtime hub 與每頁一條瀏覽器連線支援唯一 owner 的多圖頁面。
- 保留 Yahoo 延遲備援、TWSE／TPEx 盤後核定、Sites 保留站與所有非台股功能。
- 不以 Tick 數驅動 D1 writes，並在 production feature flag 前設使用依據、三日 pilot 與 Free-tier gate。

**Non-Goals:**

- 不提供 1 分 K 圖、逐筆明細表、五檔、盤中零股、指數／期貨即時圖或下單能力。
- 不讓 Cloudflare、Sites 或瀏覽器持有 Shioaji API key、secret、憑證或帳戶資訊。
- 不以 Shioaji 取代多年日 K、籌碼、TDCC、本益比、非台股來源或官方收盤核對。
- 不在第一階段讓 Sites 保留站接收同一份 Shioaji 即時資料。

## Decisions

### 1. 使用獨立 Python data-only gateway，而不是在 Worker 或瀏覽器登入

gateway 在一台交易時段不休眠的 64-bit 主機執行固定版本 Shioaji，以 `subscribe_trade=false` 或等效資料專用設定登入，不載入 CA、不暴露本機 HTTP server。callback 只寫入有界 async queue；聚合、重連與上傳在 callback 外處理。

gateway 使用一條 outbound WebSocket 連到 Cloudflare，避免公開本機 port、Cloudflare Tunnel inbound 或每位使用者各自建立券商連線。替代方案「Worker 輪詢 Shioaji HTTP server」會要求公開常駐主機且增加 request；「每個瀏覽器直接連 Shioaji」會暴露秘密並違反單一連線設計，均不採用。

Shioaji API key 與 secret 優先放在 macOS Keychain、Linux secret service／systemd credential 或等效 OS 級秘密儲存，由專用低權限 service identity 在啟動時讀入記憶體；不得寫入 repository 內 `.env`、shell profile、service command arguments 或一般備份。若選定 runtime 只能使用檔案型 secret，檔案必須位於 repo 外、只允許 service identity 讀取、禁止雲端同步與備份，且啟動前驗證權限；這是最低限度 fallback，不是首選。

gateway logging 採 allowlist，關閉 request／environment dump、exception locals 與帳戶物件序列化；登入失敗只記錄固定 reason code。CI 與 release gate 對 source、fixture、artifact 與安全摘要執行 credential pattern scan。Cloudflare uplink 使用另一組 hosted machine secret，讓 gateway uplink 輪替不接觸 Shioaji credential。

2026-07-31 已選定私人網路內的「小馬」作為 gateway 主機，使用 Ubuntu 24.04、Linux x86_64、Python 3.12 與 systemd 255。service supervisor 採 systemd system service，正式程序使用專用 `multichart-gateway` 低權限 system identity；秘密來源採 TPM2 綁定的 `systemd-creds`／`LoadCredentialEncrypted=`，只把 runtime credential file descriptor 所在目錄交給程序，不把秘密值寫入 environment、unit argument 或 repository。主機、校時、休眠、網路、秘密與三個 trust domain 的完整安全基線記錄於 [gateway-host-security-baseline.md](./gateway-host-security-baseline.md)。

### 2. Cloudflare 使用 SQLite-backed Durable Object 作 realtime hub

一個 production market hub 接受 gateway uplink，驗證獨立 machine secret、時間與遞增序號後，保存各 symbol 最新 snapshot、短期 session buffer 與 browser subscription。瀏覽器每頁只開一條 WebSocket，由 hub 依 symbols multiplex 廣播；使用 WebSocket Hibernation API，outgoing messages 不觸發 D1。

gateway 以一秒為預設上限送一個涵蓋所有變動商品的微批次；熱門商品在該秒內保留所有計算語意，但只傳送最後狀態與必要分時 bucket delta。初期 active universe 上限設為 32 檔，仍需由 budget checker 與 pilot 調低或調高，且永遠不得貼近 provider 的 200 subscriptions 上限。

替代方案「HTTP 每秒 ingest」每天會新增約 16,200 Worker requests；WebSocket inbound messages 在 Durable Object 以 20:1 計費，約 810 request-equivalent／交易日，較適合 Free-tier。

### 3. 日週月使用 ephemeral overlay，不建立 1 分 K 歷史

gateway 從 Tick 取得今日 open、high、low、latest close、avg price、單筆／累計量與來源時間。Worker 初始 candle payload 提供：

- canonical history：最近已完成交易日以前的日週月資料；
- period base：本週／本月已完成日資料的 open、high、low、volume；
- realtime overlay：今日 Shioaji 狀態。

瀏覽器依 period key 原子取代最後 provisional candle。日 K 直接使用今日 snapshot；週月 K 以 period base 加今日 overlay。Yahoo 已含今日 provisional row 時先排除，不與 Shioaji 相加。Tick 只更新主 K 棒、價格與成交量；完整指標沿用既有批次更新或後續實作 incremental tail，避免 Worker 每秒重算整段 indicators 超過 10ms CPU。

收盤後 overlay 進入 `closing`；既有 Yahoo history 取得 canonical 日 K 並通過 TWSE／TPEx 核對後，overlay 移除，週月由 canonical 日資料重算。

### 4. 分時圖使用 Tick 價格路徑與固定成交量 bucket

「分時」是獨立主圖模式，不是 interval `1m`。價格線可保留逐筆來源時間，但前端以 animation frame 或最多每 250ms～1 秒重繪；成交量使用一分鐘 bucket 以維持可讀性，所有已接受 Tick 仍計入 high、low、均價與累計量。

gateway 對 active universe 保留當日有界 ring buffer。商品盤中新增或首次訂閱時，先讀 ring buffer；仍有缺口才呼叫一次當日 Kbars 作 coarse backfill，接上 Tick 後依時間去重。歷史查詢經 single-flight、每日 symbol checkpoint、cooldown 與 provider 次數預算保護，絕不盤中輪詢。

分時模式只呈現價格線、均價、昨收與成交量；費波那契、pivot、volume profile 與 K 線技術 pane 暫停繪製但不清除偏好，切回日週月後恢復。

### 5. 來源切換採完整 snapshot 原子替換

狀態機為：

1. `live`：來源時間新鮮、heartbeat 與序號前進，可顯示「即時」。
2. `degraded`：短暫延遲或 reconnect，保留最後值並顯示連線不穩。
3. `stale`：超過門檻，凍結最後即時值，不再驅動 K 棒。
4. `fallback`：使用 Yahoo 完整 provisional candle，標示「延遲備援」。
5. `closing/closed`：回到既有 canonical history 與官方核對。

切換時 provider、OHLCV、quote time、freshness 一起替換，不混用 Shioaji close 與 Yahoo volume。received time 只算 latency，不能冒充 source time。

### 6. D1 只保存低頻狀態，不保存 Tick

第一階段不新增 Shioaji candle_history writes。Tick、分時點與 volume bucket 留在 gateway／Durable Object 有界 session state；D1 只保存必要的 feature state、safe health aggregates、訂閱／回補 checkpoint 與 bounded audit。收盤資料仍由既有 yfinance changed-tail 與官方核對流程保存。

若未來需要跨 gateway restart 保存 session，必須先提出 retention 與新 Free-tier 預算，不得在本變更中把 Tick 或 1 分資料寫進 D1。

### 7. Production 採 feature flag、單一 owner 與雙重 gate

`SHIOAJI_REALTIME_ENABLED` 或等效 flag 預設為 false。啟用需要：

- 可支持 API 登記人本人以單一 owner 私人登入網站自用展示的永豐金條款或書面確認；
- gateway 主機自動啟動、監控、校時與斷線重連；
- 兩檔 pilot 後擴至受限 universe；
- 至少三個真實交易日比對 Shioaji、Yahoo 與官方收盤；
- Cloudflare Worker CPU、requests、Durable Object requests／GB-s、D1 reads／writes 均低於既有安全線；
- 斷線、過期、fallback、收盤與回滾的正式站 browser-visible 驗收。

Sites 保留站 feature flag 永遠保持 false；共用前端依 capability response 隱藏或停用分時選項。

Cloudflare 正式站的瀏覽器人員授權固定為單一 owner：Cloudflare Access 外層政策只允許該身分，Worker 仍驗證 Access JWT、D1 active `owner` 與 hosted `ACCESS_OWNER_EMAIL` bootstrap 邊界。`member` 即使殘留於 D1 也不得成為已授權 principal，站內新增登入帳號 API 固定回覆 `single_owner_mode`。即時能力再以同一 owner principal 與 feature flag 判斷；信箱不得寫入 source、前端資產、規格或日誌。

Hub 的 watchlist demand 採去識別 scope 的完整集合取代，不採只增不減事件。清單刪除、頁籤刪除、panel 切換、背景或 WebSocket close/error 都會送出新集合；gateway 以同一 snapshot 增減 `watchlist-control` reference，移除時沿用 unsubscribe cooldown，預設 universe 的獨立 reference 不受影響。

## Risks / Trade-offs

- [常駐主機睡眠、斷網或程式退出] → 使用 OS service supervisor、健康檢查、校時、bounded reconnect；超時後明確 fallback。
- [Shioaji API key 因設定、日誌或備份外洩] → OS 級秘密儲存、專用低權限 identity、禁止 command-line／environment dump、allowlist logging、artifact 掃描及撤銷／輪替 runbook。
- [Cloudflare ingest secret 外洩後被偽造行情] → 與 Shioaji credential 分離、短期 timestamp／sequence 驗證、可獨立輪替、replay 拒絕及一鍵停用 feature flag。
- [公開條款未清楚涵蓋單一 owner 私人自用展示] → 即使網站帳號與 API 登記人相同，未取得足夠依據前 production flag 保持關閉，不以技術限制推定有展示權。
- [熱門商品 Tick 暴增] → callback 有界佇列、latest-value coalescing、每秒微批次、active universe 上限與 quota circuit breaker。
- [週月 volume 重複計算] → period base 排除今日，realtime overlay 以 period key 取代 provisional row，收盤後由 canonical 日資料重算。
- [倒序、重送、reconnect gap] → 使用來源時間、連線 ID、序號與 per-symbol last accepted state；缺口只做一次有界回補。
- [Free Worker 10ms CPU] → Worker／DO 不重算完整 indicators；即時 tail 更新留在瀏覽器，完整 payload 維持有界批次。
- [Durable Object 或 WebSocket 平台故障] → 即時能力局部降級，既有 `/api/candles/batch`、Yahoo 與官方核對維持。
- [分時資料未永久保存] → 第一階段優先免費與安全；gateway restart 後以當日 Kbars coarse backfill，無法還原的逐筆細節明確顯示缺口。

## Migration Plan

1. 先完成使用依據確認，不建立或匯入任何真實 credential 到 repository；確定閘道主機、OS secret provider、專用 service identity、最小檔案權限與備份排除。
2. 新增 gateway 模組、fixture、simulation adapter 與本機 contract tests；以假資料完成安全、排序、回補、斷線、no-order、log redaction、secret scan 與獨立輪替驗證。
3. 新增 Cloudflare Durable Object migration、bindings、realtime ingest／browser WebSocket、feature flag 與 budget checker；production flag 維持 false。
4. 新增前端日週月 overlay、分時 renderer、來源狀態與 page-scoped coordinator；Sites 保留站驗證既有功能無回歸。
5. 在私人環境以 2 檔完成一個交易日 pilot，再擴至最多 32 檔；至少連續三個交易日保存安全量測與 browser-visible 證據。
6. gates 全部通過後逐步啟用 Cloudflare 正式站；監測 quota、延遲與錯誤率。
7. 回滾時先關閉 feature flag、斷開 gateway uplink並恢復既有批次行情；不得刪除 canonical history 或影響 Sites 保留站。

## Open Questions

- 小馬 BIOS 的「AC power restore」與外部 UPS 尚待 operator 在正式 pilot 前確認；未證明斷電恢復前，Yahoo fallback 與 feature flag 關閉仍是必要故障邊界。
- 即時新鮮度與 `degraded`／`stale` 秒數門檻可在兩檔 pilot 後依量測調整，但 `live` 必須以來源時間而非接收時間判定。
