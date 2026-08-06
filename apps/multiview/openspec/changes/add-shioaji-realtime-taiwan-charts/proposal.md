## Why

目前網站的台股盤中行情由 Yahoo K 線透過批次輪詢更新，無法保證逐筆新鮮度，也不能讓日、週、月 K 線最右側未完成 K 棒隨最新成交即時變化。永豐金 Shioaji 提供台股 Tick、Quote 與 KBar 訂閱，可在保留既有官方收盤核對與延遲備援的前提下，補強盤中正確度、即時性及分時走勢功能。

## What Changes

- 新增資料專用 Shioaji 行情閘道：在 Cloudflare Workers 外部的常駐主機維持單一登入與受限訂閱，只把正規化行情經受保護的 outbound 連線送入 Cloudflare；Shioaji 帳號、API key、secret、憑證與下單能力不得進入瀏覽器、repository、D1 或一般 Worker。
- Shioaji API key 與 secret 只能由閘道主機的 OS 級秘密儲存或權限受限的 runtime secret 注入，禁止出現在 command line、process listing、一般 `.env` 備份、log、crash dump、health、測試 fixture、CI artifact 或支援訊息；Cloudflare ingest 使用另一組可獨立輪替的機器秘密。
- 台股 `日`、`週`、`月` K 線在盤中以逐筆行情更新最右側未完成 K 棒的 OHLCV、最新價與來源時間；本變更明確不新增 `1 分 K` 圖。
- 新增獨立的「分時走勢」圖，顯示當日最新成交價折線、成交均價、昨收基準、分時成交量及即時報價摘要。
- 新增商品時立即要求行情閘道訂閱；若當日已開盤，先以單次、有界的當日歷史 Kbars 或閘道既有 session buffer 回補開盤至當下，再接續 Tick，不以盤中輪詢冒充即時行情。
- Shioaji 新鮮時作為台股盤中主來源；來源中斷、過期或閘道不可用時，保留最後有效值並明確降級為 Yahoo 延遲備援，不得繼續標示「即時」或靜默混合兩個來源的當日資料。
- 收盤後以既有 TWSE／TPEx 官方來源核定日 K；週、月 K 由已完成日 K 與當日即時 overlay 正規化聚合，避免今日成交量或高低價重複計入。
- 對 Shioaji 訂閱數、連線、重連、歷史查詢、商品 universe、Cloudflare Worker／Durable Object／D1 用量建立硬上限與降載行為；逐筆 Tick 不得寫入 D1，只允許保存完成日 K、必要的 session checkpoint 與安全健康摘要。
- Cloudflare 正式站改為單一 active owner 模式；只有由 hosted `ACCESS_OWNER_EMAIL` 建立且在 D1 為 `owner` 的身分可進站與使用即時行情，不把信箱硬編碼在 source、OpenSpec 或前端。其他 Google 身分與 D1 `member` 一律 fail closed；Sites 保留站維持獨立既有登入。
- 正式啟用前仍必須取得永豐金對「API 登記人本人、單一 owner、私人登入網站自用展示」的可接受使用依據，並完成至少三個交易日的來源、延遲、斷線、Free-tier 與盤後核定驗證；技術上的單一帳號限制不能取代授權確認，未通過時功能維持關閉或備援模式。
- 第一階段只在 Cloudflare 正式站啟用；Sites 保留站維持既有資料來源或顯示能力不可用，不得因缺少 Shioaji 閘道而阻斷既有圖表。

## Capabilities

### New Capabilities

- `shioaji-realtime-market-gateway`: 定義資料專用 Shioaji 常駐閘道、訂閱與新增商品回補、受保護 Cloudflare ingest、API key 完整生命週期、健康狀態、秘密與下單隔離、來源降級及使用權 gate。
- `taiwan-realtime-kline-overlay`: 定義台股日／週／月 K 線的盤中逐筆 overlay、OHLCV 聚合、來源切換、盤後核定與不提供 1 分 K 的可見契約。
- `taiwan-intraday-trend-chart`: 定義「分時走勢」的價格線、均價線、昨收基準、成交量、即時狀態、補齊與多圖互動。

### Modified Capabilities

- `intraday-quote-state`: 擴充台股逐筆主來源、閘道新鮮度、即時／中斷／延遲備援狀態及日週月盤中更新的報價生命週期。
- `candle-history-parity`: 將已保存歷史與當日即時 overlay 明確分層，禁止 Tick 無限制持久化，並定義收盤後 canonical 日 K 取代盤中 overlay 的合併規則。
- `codex-sites-rewrite`: 擴充 Workers 市場資料契約以支援 Cloudflare 正式站的受保護 Shioaji 即時來源，同時維持 Sites 保留站與非台股商品的既有相容行為。

## Impact

- 前端：週期／圖表選擇、K 線即時更新、分時走勢 renderer、報價狀態、來源標示、多圖共用即時連線及新增商品後的載入流程。
- Worker：受保護 realtime ingest、瀏覽器 WebSocket、Durable Object 或等效即時 hub、來源新鮮度與備援狀態機、日週月 overlay 聚合及健康摘要。
- 外部執行環境：新增一個盤中常駐、可監控且自動重啟的 Shioaji data-only gateway；不納入下單、帳務或憑證功能，並提供秘密注入、權限、輪替、撤銷與疑似外洩處理手冊。
- 持久化：必要 migration、有限 session checkpoint、完成日 K 與 usage metrics；不得保存 Tick 全量或秘密。
- 既有來源：Yahoo 保留為延遲備援與非台股來源；TWSE／TPEx 保留盤後核定；FinMind、TDCC、本益比與籌碼流程不變。
- 部署與營運：Cloudflare Durable Object／WebSocket 設定、hosted secrets、feature flag、斷線與 quota circuit breaker、Free-tier budget checker、正式站瀏覽器驗收及回滾文件。
- 外部 gate：永豐金帳戶與 Shioaji 權限、API 條款／行情展示方式確認，以及可在台股交易時段持續運作的閘道主機。
