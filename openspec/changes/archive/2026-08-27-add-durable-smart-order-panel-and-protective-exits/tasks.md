## 0. P0 硬閘門：未完成前禁止任何自動 simulation 寫入

- [x] 0.1 由使用者明確確認接受「智慧下單面板是本機監控、非券商雲端；5173 關閉可監控，但關機／睡眠／斷網／session 中斷不監控」；若不接受，停止本 change，不以 sidecar 冒充雲端服務。
- [x] 0.2 將 [evidence.md](./evidence.md) 的永豐金與 Shioaji 官方連結、查核日期、事實／推論／本地決策逐項複核；任何官方頁面語意改變時先更新 specs。
- [x] 0.2a 以現行官方手冊／畫面為快速單、停損停利、長效、多條件、母子、移動出場、定時定量逐類建立versioned decision tables；涵蓋欄位／比較子／單位、監控與委託商品拓樸、觸發／委託流程、1–30日cutoff、母子每leg商品／有效期、定時／定量slot／split／尾數／收盤算法與golden vectors，未證實分支disabled。
- [x] 0.3 建立不含秘密的 Shioaji simulation read-only contract probe，驗證明確 `broker_id/account_id/account_type`、account-scoped trades（依目前受管 Shioaji server OpenAPI 契約為先 `update_status` 再回傳trade cache）／positions、trade subscription與event回傳帳號；不得呼叫目前不存在的獨立 `/api/v1/order/update_status` HTTP route。fixture／mock只可驗證parser、transport與fail-closed harness，report MUST固定為`executionMode=fixture`、`evidenceClass=test_fixture`、`overall=test_only`且所有eligibility為false；0.3只有可信Gate runner依allowlisted current schema與immutable probe source／build digest重算canonical result hash與eligibility，並確認受管`live-readonly` report的`testOutcome=overall=pass`、所有必要check各唯一且為pass、不得有blocked／inconclusive、shared mode lease與受管Runtime／listener／simulation／version／capability／app／adapter fingerprint前後一致、redaction通過、broker write attempted／networked皆為0且未保存帳號資料時才可完成。不得只信report自行宣告的eligibility布林值。
- [x] 0.3a 在任何Gate 0寫入前建立獨立probe-only safety envelope：不可被strategy／quote callback／一般UI呼叫、逐operation一次性nonce＋使用者授權、shared mode lease、雙重simulation attestation、adapter使用固定完整帳號且只在UI／evidence遮罩、最大1 CommonLot、CA／production未載入、unknown不重送且不盲目cleanup。
- [x] 0.3b 只透過0.3a驗證place explicit account與update/cancel實際HTTP contract；唯讀preflight依current contract／合法tick／BBO產生不穿價且不易成交的Buy LMT `P1`，同run唯一target的update另用不同合法`P2`，每個operation逐次exact授權並在前後驗固定帳號／trade date／identity／revision，最後才cancel。若upstream只收`Trade`／`trade_id`，只由固定帳號refreshed trades解析，不得要求不存在的payload欄位或操作任意、舊run、外部target。
- [x] 0.3c 在逐次授權下，先唯讀證明固定simulation帳號有足夠、可用且無unknown的position；sidecar停止時由另一個核准simulation client以合法tick、高於current可成交範圍且不超過limit up的LMT建立多筆已知、每筆最大1 CommonLot的working sells。重啟後以account-scoped view比對完整account／identifier／quantity／status集合，或取得更強官方完整性契約。只看見單筆／Runtime自己委託不算通過，無法證明集合完整的帳號自動化disabled。
- [x] 0.4 只透過0.3a且在該次另行明確授權最小simulation smoke後，以current合法marketable LMT或已核准MKT+IOC取得真正deal event，驗證`custom_field`英數六字元、place response、order event、deal event、trade ID、`Asia/Taipei trade_date`、seqno／ordno、exchange sequence的完整round-trip與跨日碰撞fixture；canonical key無法唯一correlation時確立`manual_intervention`且不update／cancel／重送。
- [x] 0.5 對九種快速單候選欄位逐項產出「現行官方UI名稱／語意→本地schema／comparator／單位→Shioaji Tick／BidAsk欄位／品質」三層mapping，並驗證exchange time、trade date、sequence、`simtrade`、`intraday_odd`、subscribe/unsubscribe ownership、多SSE client與reconnect；未證實欄位個別disabled。
- [x] 0.6 只透過0.3a驗證自動化`LMT+ROD`、`LMT+IOC`、`MKT+IOC`的current受管Shioaji simulation payload與可確定重現的PendingSubmit／PreSubmitted／Submitted／Filled／Cancelled／Inactive／Failed；working使用合法非marketable LMT、Filled使用合法marketable LMT、IOC zero-fill使用明顯非marketable LMT，MKT不得帶猜測價格。PartFilled等無法確定重現的狀態不得無界重送碰運氣；未證實的FOK／MKP／隱藏映射維持禁用，且不把此縮限誤套到既有手動委託。
- [x] 0.7 驗證 positions 的 `Share`、Common order quantity、股票與 ETF canonical contract `unit`、category、reference、limit up/down、update date，建立唯一 Share↔CommonLot 轉換契約。
- [x] 0.8 決定並實證 TWSE／TPEx 官方交易日曆與 trusted broker／exchange time 的 canonical 來源、版本、涵蓋區間、更新頻率、颱風／臨時休市、2秒skew與失效政策；未知日期／時間一律 fail closed。
- [x] 0.9 對Node LTS `>=24.15.0 <25` `node:sqlite`在單一原生、非VM的Apple Silicon `arm64` macOS實機執行capability、WAL、`synchronous=FULL`、defensive mode、crash durability、backup/restore、dedicated-worker event-loop隔離、latency／queue-age watchdog與LaunchAgent絕對Node路徑probe；以新單host schema／source fingerprint／Ed25519 attestation與`runId + resultHash` trust binding重產正式證據，機械拒絕Intel／`x64`、Rosetta、VM、其他OS、舊雙架構schema、偽造與重放report。此限制只套用智慧下單交易Runtime，不改變RealTimeStock一般前端支援；未來Intel交易Runtime另立OpenSpec change。未通過就停止並更新design，不臨場換driver。
- [x] 0.10 完成本機控制面 threat model：惡意網頁、DNS rebinding、惡意 Host、CSRF、request replay、本機其他使用者／程序、capability 外洩、Cloudflare／remote tunnel、超量 body 與 log／DB 洩密。
- [x] 0.11 完成 Strategy／Activation／OrderIntent／BrokerOrder transition table、terminal/non-terminal、reason code、決定性 activation ID 與所有 crash windows 的書面 review。
- [x] 0.12 完成中央 trading-write gateway、canonical risk／kill switch、account-wide reservation、mode shared/exclusive lock、quote gap 與 order execution policy 的安全 review；所有 reviewer P0 關閉前策略 write master MUST 無法開啟。
- [x] 0.13 盤點所有現有股票 place/update/cancel route 與 Cash／融資券／當沖、Common／IntradayOdd、LMT／MKT／MKP、ROD／IOC／FOK 等手動 order class；產出manual route coverage matrix、等價回歸計畫及server-derived `BrokerWriteProvenance` classifier，證明automation不能偽裝manual、scheduler不能用manual confirmation；任一旁路未納管時對應帳號自動化 disabled。
- [x] 0.14 產出 versioned canonical `PnlPolicy` 與來源 mapping，固定 realized／unrealized／fee／tax、per-account／identity-group aggregation、5秒TTL、trade-date reset及event reorder重算，並證明current-trade-date full reconciliation涵蓋Runtime啟動前與外部client的全部成交／費稅；缺任一coverage／component不得把值當0，受影響account／identity新增曝險disabled。
- [x] 0.15 證明 broker-authenticated canonical principal可穩定跨固定股票帳號對應，定義獨立`0600` identity key、完整HMAC-SHA-256、restart／rotation／key-loss／mapping-conflict fail-closed契約。
- [x] 0.16 驗證同一Shioaji login的全域subscription ownership／usage及order-rate operation分類；無法計入5173／5174／charts／watchlist／alerts時，smart-order subscription與write master disabled。
- [x] 0.17 由gate runner產生machine-readable私有manifest，綁定build、schema／adapter、Shioaji capability、Node／SQLite／OS、evidence class／schema／immutable source code digest／eligibility／result hashes、route coverage、PnL policy、產品邊界consent與feature gates；分開automation／manual／probe conjunct，verifier MUST從canonical report重算result hash、required-check set與eligibility而非相信report自稱布林值，並機械拒絕fixture、historical failed attempt、舊revision、blocked／inconclusive或fingerprint不完整的evidence；證明dispatch path不接受環境變數、feature flag、UI或client-supplied provenance單獨解鎖。
- [x] 0.18 在[evidence.md](./evidence.md)維護P0 traceability baseline，逐項連結Requirement、normal／failure／race Scenario、task、Gate與證據責任；任一列缺失不得聲稱apply-ready。

## 1. 型別、狀態機與純 domain 安全核心

- [x] 1.1 定義 versioned strategy discriminated union：`quick`、`good_till`、`multi_condition`、`parent_child`、`stop_take`、`trailing_exit`、`scheduled_quantity`。
- [x] 1.2 分離 Strategy、Activation、OrderIntent、BrokerOrder、PendingProtectionCommitment／ProtectionObligation、EntryExposureReservation、ExitClaim／ExternalSellClaim 與 RuntimeEpoch 型別，實作 allowlisted transition、lineage、terminal／unknown與 optimistic revision。
- [x] 1.3 定義 canonical confirmation snapshot、stable serialization、payload hash、client request ID、request replay 與欄位變更失效規則。
- [x] 1.4 建立 decimal string／integer tick 價格型別，禁止 domain 以 binary floating-point 判斷交易門檻。
- [x] 1.5 建立帶單位的 `Share`、`CommonLot`、contract unit 型別與 exact conversion，拒絕 fractional CommonLot 或隱含 1000。
- [x] 1.6 建立Cash Common現股多單／依最近broker證據本地驗證reduce-only的automation intent classifier；其他order_cond、short、odd-lot與unknown automation intent一律unsupported，但不改寫既有手動委託矩陣。
- [x] 1.7 實作integer-bps百分比與absolute／fixed-ATR canonical公式：stop／trailing向上、take／activation向下tick rounding，並與broker LMT價分離；固定`basis=100,p=3%,ATR=2,k=2`及`high=110,retrace=5%` golden vectors，拒絕overflow／underflow／非正stop。
- [x] 1.8 實作固定 ATR snapshot：Wilder ATR、timeframe、period、algorithm version、as-of date、source integrity、除權息／revision invalidation。
- [x] 1.9 實作 `require_rearm`／`immediate_if_true`、level／crossing、deterministic edge 與 schedule-slot activation ID。
- [x] 1.10 實作 quote observation quality、freshness、same-date／same-epoch、AND 3 秒 coherence、out-of-order／simtrade／intraday-odd 排除。
- [x] 1.11 實作 versioned calendar、Asia/Taipei trade date、monotonic duration、clock jump 與 unknown date fail-closed domain。
- [x] 1.12 為以上 domain 補齊 property／table tests，涵蓋股票／ETF、10／50／100／500／1000 價格級距、NaN／Infinity、1 張／1000 股、日期與 DST-independent Taipei time。
- [x] 1.13 定義 versioned PnlPolicy、identity-group derivation、provenance-specific gate-manifest schema、manual／automation order-class matrix、worst-case EntryExposureReservation、distinct ExitClaim projection與 `RuntimeTrackedUnprotectedRemainder` 的純 domain invariants／golden tests。
- [x] 1.14 定義每個`manual_intervention` reason code的versioned resolution matrix：必要broker evidence、允許operation／transition、re-arm、reservation／claim／obligation處理及break-glass audit；generic resume一律無權解除。

## 2. SQLite repository、outbox 與單一 sender

- [x] 2.1 在 `package.json` 與 runtime install contract 固定可支援 Node 範圍，解析並保存實際 Node 絕對路徑，不硬編 `/opt/homebrew`。
- [x] 2.2 建立私有 Application Support smart-order 目錄、`0600` DB／WAL／SHM／backup、獨立gateway capability與identity key權限，以及不含秘密的設定摘要；browser／status／log不得取得任何key。
- [x] 2.3 建立 `strategies`、`activations`、`order_intents`、`broker_orders`、`protection_obligations`、`entry_exposure_reservations`、`exit_claims`（含external lineage）、`runtime_epochs`、`observations` 與 `event_journal` schema。
- [x] 2.4 啟用 `foreign_keys`、WAL、`synchronous=FULL`、busy timeout、defensive mode、single-writer connection與 transaction migration。
- [x] 2.5 實作 OS exclusive lock、DB fencing token、sender epoch 與第二程序唯讀／退出行為。
- [x] 2.6 實作 prepared intent durable outbox、狀態＋intent＋reservation／claim原子commit；`prepared→dispatching`先fsync `dispatch_attempt_nonce`、mode／risk／account／target revision與sender fence，adapter只能取得已fenced dispatch權。dispatching commit後任何crash都unknown／reconcile，只有從未授權adapter的prepared可人工re-arm。
- [x] 2.7 實作 broker correlation record，canonical key綁fixed account tuple、`Asia/Taipei trade_date`、contract、side與Gate 0已驗證trade/order/deal IDs、seqno／ordno／exchange sequence；`custom_field`只作輔助，不得保存秘密或跨日誤關聯。
- [x] 2.8 實作 bounded event journal，保存 exchange／broker／receive time、monotonic local sequence、reason code、revision 與 payload redaction。
- [x] 2.9 實作`Asia/Taipei` calendar-year retention：較晚terminal／released或最後關聯evidence時間＋1 calendar year才purge，不用固定365日；non-terminal／unknown／working／obligation／reservation永不因年限刪除，補閏日／月底golden vectors。
- [x] 2.10 實作 SQLite backup API／一致性 snapshot、restore、schema/hash/row-count/integrity 驗證；一般 uninstall 保留所有資料。
- [x] 2.11 實作 migration／disk-full／read-only／permission／corruption fail-stop，不得自動建立空 DB 或降級無持久化。
- [x] 2.12 補齊雙 Runtime、busy、crash、rollback、backup/restore、secret scan 與一年 purge repository tests。
- [x] 2.13 建立gate manifest的schema validation、result-hash／build／capability fingerprint綁定、失效與observe-only migration；manifest不得存秘密或完整帳號，也不得由browser mutation。
- [x] 2.14 將同步SQLite、fsync、checkpoint與backup放入dedicated worker／等價隔離executor，實作DB queue-age／latency watchdog；慢DB使readiness false並保持quote／trade event loop可處理告警與reconciliation。

## 3. Same-origin gateway 與本機 API 安全

- [x] 3.1 建立只綁 `127.0.0.1` 的 sidecar，使用隨機或衝突安全 port 與精確 Host allowlist，不綁 `0.0.0.0`／IPv6 public interface。
- [x] 3.2 建立 repo 外 `0600` per-install capability 的產生、rotation、讀取與 uninstall；capability 不得交給 browser、DB、URL、status 或 log。
- [x] 3.3 在 5173 same-origin gateway 注入 capability，驗證 exact Origin、Host、`Sec-Fetch-Site`、CSRF/request ID、JSON content type、method、body size與 schema。
- [x] 3.4 建立endpoint security matrix：mutation採auth／Origin／CSRF／JSON schema／request ID／revision／replay，read採auth／Origin／query schema／no-side-effect，SSE採auth／Origin／bounded cursor，health只回最小摘要；禁止GET side effect、wildcard CORS、simple-form mutation與回傳capability。
- [x] 3.5 對 packaged desktop 模式建立等價 gateway；若尚未證明安全，只支援 5173 本機路徑並在 packaged 模式 fail closed。
- [x] 3.6 明確拒絕 Cloudflare、remote tunnel、非 loopback reverse proxy 與 synthetic non-simulation smart-order control plane。
- [x] 3.7 實作 create/list/get/pause/resume/cancel/copy、risk/kill-switch、readiness、gate status、history 與事件SSE API，依endpoint matrix採schema／revision／idempotent operation；server依可信route／caller／nonce衍生`manual_user_confirmed | automation | gate_probe`，不接受browser provenance，只有mutation使用CSRF/replay契約。
- [x] 3.8 補齊 hostile Origin、form POST、DNS rebinding、malicious Host、缺／錯 capability、重放、oversized body、method confusion、SSE 未授權與 log 泄密測試。

## 4. Runtime mode、生命週期與 observe-only

- [x] 4.1 在sidecar broker adapter實作每次place/update/cancel前的mode marker＋`/api/v1/info.simulation`雙重attestation、API generation、sender fence及shared mode execution lease；lease從durable dispatching前持有到broker identifiers／結果durable acknowledged／terminal或unknown／reconciling commit，DB commit失敗sender fail-stop；mode switch用exclusive lock等待所有lease結束。
- [x] 4.2 將 sidecar、gateway capability、repository、reconciliation、obligation count、observe-only與 write-master 納入 `scripts/realtimestock-runtime install/status/simulation/production-readonly/uninstall`。
- [x] 4.3 production-readonly 切換先 stop-new-activation、關 write master、reconcile；任何dispatching／acknowledged／reconciling／unknown intent或pending_submit／pre_submitted／submitted／part_filled BrokerOrder存在時拒絕，純quiesced且零義務strategy可留唯讀DB。
- [x] 4.4 實作BrokerOrder／side-effect intent／EntryExposureReservation／ExitClaim／RuntimeTrackedUnprotectedRemainder的逐項drain UI／CLI；一般持股不誤列，取消strategy、取消broker order與人工relinquish分開確認；prepared且未授權adapter者只可本機cancel／release，保留working order後停止只允許break-glass。
- [x] 4.5 watchdog 重啟 8080 或 API generation 改變時使舊 fence 失效、sidecar 進 recovery、重訂閱／對帳完成前禁止 dispatch。
- [x] 4.6 回 simulation、重新登入、upgrade、migration 或 recovery 後預設 observe-only／paused，使用者明確 resume＋arm 前不得自動恢復。
- [x] 4.7 實作三種kill switch deny-union及與dispatch共用的arbiter線性化revision；測試simultaneous switches、emergency等待queue／已越過dispatch點、protective reduce-only與明確cancel政策。
- [x] 4.8 stop、rollback、feature flag關閉與uninstall遇任何non-terminal strategy／side-effect intent／BrokerOrder／obligation／reservation／claim時預設拒絕；定義zero-fill、confirmed-exit／position-zero與二次確認relinquish，強制操作需snapshot與unmonitored audit。
- [x] 4.9 補齊 mode switch mid-flight、ack後DB commit前、watchdog restart、unknown marker、`/info` timeout/mismatch、generation TOCTOU、relogin、reconciling intent／pending-submit order與uninstall drain tests。

## 5. Node-safe Shioaji adapter、事件與行情 coordinator

- [x] 5.1 建立Node-safe broker adapter；place強制完整fixed account，query／positions／update_status／subscribe-trade強制account-scoped；update/cancel若只接受Trade／trade_id則先由固定帳號refreshed trades唯一解析，不重用fallback UI current-account路徑或捏造upstream欄位。
- [x] 5.2 update/cancel target綁fixed account、trade date、contract、side、immutable broker IDs與broker-order revision；在per-account／per-order lock內、HTTP write緊鄰前重驗terminal／remaining quantity／revision，排隊期間改變則作廢舊intent並reconcile，可能已送bytes則unknown不retry。
- [x] 5.3 正規化 order/deal event，完整保留 account、`Asia/Taipei trade_date`、trade/order/deal IDs、seqno、ordno、exchange sequence、`custom_field`、status、deal／cancel quantity與時間，處理跨日短ID碰撞。
- [x] 5.4 逐固定帳號建立／確認 trade subscription，處理 deal-before-order、duplicate、disconnect/reconnect與 subscribe failure。
- [x] 5.5 實作事件為主、account-scoped `update_status`＋trades／positions為有界補強的reconciliation coordinator；啟動時以已證明完整的集合把外部pre-existing working sells納入ExternalSellClaim，並做current-trade-date full deal／fee／tax reconciliation；沒有upstream event ID時使用connection/generation epoch。
- [x] 5.6 建立 quote subscription refcount／dedupe／freshness／re-subscribe coordinator，共用既有 login且不得讓 browser unsubscribe 破壞 Runtime demand。
- [x] 5.7 實作九種快速單欄位 normalization、Tick/BidAsk 品質、trade date、exchange/receive time、stream epoch、simtrade／intraday-odd 排除。
- [x] 5.7a 固定停損、停利與 trailing extreme 只接受 fresh normal-lot last trade；驗證 BidAsk 單獨跨線不觸發、稀疏成交時顯示 stale／last eligible time。
- [x] 5.8 實作 sleep/wake、event-loop pause、clock jump、SSE gap 與 API generation gap 偵測，恢復後先停止 dispatch並 reconcile。
- [x] 5.9 交易時段trailing observation gap一律轉`manual_intervention`；historical ticks只作事後稽核，不得重新解鎖或reset extreme，只有可證明無缺observation的UI disconnect可沿用。
- [x] 5.10 建立資源coordinator，先依0.16證明`api.subscribe()` ownership／usage與market-data、accounting、orders、connection、login等官方rate bucket；只對完整可列舉且已證實共享的subscribe資源池採本地160上限與40 headroom。operations分類未完成前共用更保守的每秒最多5筆limiter，並以bounded queue預留安全capacity，依reconciliation／status、user-confirmed cancel／reduce-only protection、新曝險排序且防飢餓；usage或bucket未知即fail closed，不得輪詢snapshot/ticks/kbars代替。
- [x] 5.11 實作health/readiness分離，readiness同時涵蓋DB、manifest、fence、mode、account、identity、external-working visibility、trade subscription、reconciliation、canonical risk/PnL、global resources、calendar、contract、quote與unknown intent。
- [x] 5.12 補齊 stale/out-of-order/cross-date/simtrade/odd quote、AND coherence、subscription failure、queue full、event reorder與 reconnect tests。

## 6. Canonical risk、中央 arbiter 與 position reservation

- [x] 6.1 將versioned risk policy、current-trade-date full-coverage canonical PnlPolicy／deal ledger／5秒as-of、per-account與identity aggregation、account readiness及deny-union kill switches移入Runtime；前端`localStorage`不再是智慧單權威。
- [x] 6.2 依0.13 coverage matrix逐帳號把所有RealTimeStock place/update/cancel入口改經同一trading-write gateway／arbiter，移除智慧單與保護`bypassRisk`；實作server-derived provenance隔離，automation不得命中manual route／confirmation，manual合法payload不得被automation縮限改寫，任何旁路存在時不開automation。
- [x] 6.3 實作exposure-increasing／依最近broker證據本地驗證reduce-only分類；無法證明、PnL／position stale、external-working visibility或policy mismatch一律fail closed，UI揭露外部TOCTOU非原子保證。
- [x] 6.4 建立worst-case EntryExposureReservation與account＋contract＋long-position的base-share ExitClaim ledger；Runtime protection／winner／working沿同一lineage轉態，外部working sell另建ExternalSellClaim，按distinct claim ID計量，能力不完整的帳號disabled。
- [x] 6.5 在create、trigger、intent prepared、queue-head取得account arbiter slot後且broker write緊鄰前、ack／deal／cancel、manual order與periodic reconciliation更新reservation／claim；重驗position＋working-sell revision，排隊期間外部sell使舊intent失效／轉manual。
- [x] 6.6 外部／手動 position drift 無 working/unknown競態時縮減未觸發 reservation並告警；有競態時轉 `manual_intervention`，禁止反向空頭。
- [x] 6.7 實作protection-group＋remainder-generation的DB CAS／unique active-dispatch slot、唯一OCO winner、同一ExitClaim lineage轉態、sibling pre-broker suppression、partial-fill remainder、winner-commit crash、cancel/fill race與unknown blocking。
- [x] 6.8 補齊兩筆並發buy合計超風控CAS、兩策略競爭、manual order、Runtime前多筆外部working sell集合、queue中外部sell、snapshot後TOCTOU、1張/1000股、ETF unit、OCO claim不重複、winner crash與cancel/fill invariant tests；只宣稱本地intent依最後證據不主動超額。
- [x] 6.9 實作canonical PnL從current-trade-date完整、去重deal ledger重算，涵蓋pre-start／external activity與fee／tax；缺值fail-closed、跨日reset gate、account／identity雙層上限與午盤restart golden tests。
- [x] 6.10 實作`manual_intervention` resolution service與UI：按reason matrix列必要證據／允許操作，禁止generic resume；unknown只能唯一final evidence結案或二次確認break-glass relinquish，原intent不重送。

## 7. 下單面板保護出場

- [x] 7.1 將 ticket `LMT`／`MKT` 顯示改為「限價單」／「市價單」，適用既有 `MKP` 顯示與新自動保護支援矩陣分離。
- [x] 7.2 僅對 TSE／OTC Cash Common 股票／ETF 現股多單顯示可用保護；其他商品與 order_cond disabled並說明原因。
- [x] 7.3 重整保護區為「固定保護／移動出場」，維持 ticket default `w=5,h=11`／minimum `minW=4,minH=10`，設定區可捲動、主要操作保持可見，並加入價位／百分比／ATR、單位、理論價、合法 tick、估算／正式標示與驗證。
- [x] 7.4 建立entry＋protection canonical confirmation，既有部位百分比／ATR預設使用broker-confirmed average cost並允許明示user-specified basis；任何帳號、商品、數量、價別、basis、保護、mode或risk revision變更即失效。
- [x] 7.5 將含保護entry改為sidecar原子保存entry intent＋PendingProtectionCommitment／ProtectionObligation後才送單；凡policy有可預留維度即強制建立worst-case EntryExposureReservation，未成交時filled/protected shares與ExitClaim固定為0，Runtime不ready時阻擋整筆。
- [x] 7.6 以cumulative actual fill與weighted average建立正式保護，ATR snapshot固定；fill＋position reconciliation一致後才transactionally建立`ExitClaim.monitoring_reserved`並消耗／釋放exposure reservation，零成交以zero-fill終結。
- [x] 7.7 trigger命中但entry仍working時先阻擋新activation；kill-switch允許才取消剩餘entry並bounded reconcile，否則或結果未知轉人工且不猜數量exit。
- [x] 7.8 分離 trigger 與 broker execution policy，實作核准的 LMT/ROD、LMT/IOC、MKT/IOC與 price-limit validation；IOC remainder不自動重送。
- [x] 7.9 實作integer-bps／absolute／fixed-ATR canonical stop/take與trailing activation／extreme／retracement／fixed stop，以及同組ExitClaim atomic OCO remainder；重啟後proven-unsent intent也必須使用者re-arm，trailing gap不得用historical ticks解鎖。
- [x] 7.10 UI 分開顯示 saved、waiting-fill、monitoring、triggered、dispatching、accepted、part-filled、filled、unfilled、unknown、unprotected與 manual intervention；Runtime離線時只顯示last-known未受保護量＋as-of並把current標為unknown。
- [x] 7.11 移除新保護流程對 browser `bracket.ts`／`trigger-engine.ts` 的交易 authority，保留必要的唯讀 migration提示。
- [x] 7.12 補齊 component/accessibility tests：預設／最小 footprint、keyboard/focus/screen reader、長錯誤、估算與正式差異、高可見未受保護狀態。

## 8. 智慧下單面板共用骨架

- [x] 8.1 在 BlockType、panel metadata、「新增面板」與渲染分支註冊 `smart-order`，固定 default `w=5,h=11`、minimum `minW=4,minH=10` 與 resize persistence。
- [x] 8.2 永久顯示「本機監控・非券商雲端」、heartbeat、last readiness、quote freshness、simulation與 write-master狀態。
- [x] 8.3 建立「類型、條件、委託、確認」流程及「監控中、處理中、歷程」分頁；處理中涵蓋草稿／觸發／送出／unknown／recovery／manual／cancel-pending／expired-with-obligation，只有所有broker side effect與本機義務皆terminal才進歷程；Runtime snapshot是 active strategy唯一狀態來源。
- [x] 8.3a 建立真正零筆策略空狀態的「新增智慧單」入口與可存取單選類型選擇器；全新流程預設「移動出場單」，下一步只建立草稿。返回／複製草稿保留原類型；移動出場單未通過獨立gate時顯示不可用、不解鎖且不自動改選其他類型。
- [x] 8.4 串接 workspace商品聯動，只更新未確認 draft，不改寫既有策略。
- [x] 8.5 建立共用 fixed account、contract、Cash/Common、Share/CommonLot、trigger、broker policy、validity與 canonical confirmation元件。
- [x] 8.6 實作所有non-draft strategy（含paused/recovery/manual/cancel-pending/expired-with-obligation）不可修改、copy-to-draft、pause/resume/cancel strategy/cancel broker order分離與stale revision處理。
- [x] 8.7 實作HMAC衍生且跨重啟穩定的authenticated identity group跨股票帳號20筆本機上限，paused/recovery/manual/cancel-pending/expired-with-obligation及有broker／obligation／reservation者都計入；key-loss／mapping衝突fail closed。
- [x] 8.7a UI與文件分開顯示「RealTimeStock股票本機20筆（較保守states）」與「大戶投同一ID跨帳號台股＋期權券商雲端20筆」；本機不會讀取、占用或同步後者。
- [x] 8.8 實作一年 history、遮罩帳號、exchange/broker/receive time、reason code與本機通知；通知不得作broker證據。
- [x] 8.9 UI／Runtime雙層阻擋所有非第一階段商品、order_cond、lot與 cross-market payload。
- [x] 8.10 補齊 panel persistence、resize、keyboard/focus/screen reader、類型選擇器預設／取消／返回／disabled gate、offline/recovery、stale quote、confirmation invalidation與長歷程 browser tests。

## 9. 快速單、停損停利與長效單

- [x] 9.1 依 Gate 0 mapping實作快速單九種欄位、比較子、單位、eligible observation與field-level disabled。
- [x] 9.2 實作快速單 `require_rearm`預設、明確 `immediate_if_true`確認、false→true activation與duplicate edge idempotency。
- [x] 9.3 實作既有現股多單停損停利單，重用 fixed ATR、tick、execution policy、reservation與OCO remainder。
- [x] 9.4 實作長效單1–30日、每日最多一次、目標／每次最大量、只累計實際成交、最後剩餘量與隔日重新監控。
- [x] 9.5 實作長效IOC零成交／部分成交不自動重送，以及ROD到期／PartFilled／Inactive／Failed仍消耗當日唯一activation；前日working／unknown在對帳完成前不進下一日。
- [x] 9.6 為三種策略各補正常、already-true、stale、gap、partial/unfilled、duplicate event、expiry與mode/risk阻擋 tests。

## 10. 多條件、母子、移動出場與定時定量

- [x] 10.1 實作最多七條多條件、AND／OR及Gate 0已核准的product-topology分支；多監控商品或不同委託商品未獲官方／本地decision table核准時保持disabled，已核准分支套用same-date／epoch與3秒coherence。
- [x] 10.2 實作 OR同時命中單一activation、AND stale不latch、任一subscription失敗整體不ready。
- [x] 10.3 實作同一固定帳號Cash Common Buy母單＋Sell本地reduce-only子單，強制每leg monitorContract==orderContract但parent／child可不同商品；母單1–30日全部實際成交才啟動一次，子單數量依child可用position而非跨商品母單量推導；partial/accepted/working不得啟動。
- [x] 10.4 實作子單啟動交易日監控／再送資格終止、母單最後有效日收盤後確認全成不得跨日啟動、未觸發到期；收盤working先依Gate 0核准ROD／IOC policy對帳，只有policy要求且kill-switch允許才cancel，否則／unknown轉manual；母單部分成交終結高可見提示另建保護。
- [x] 10.5 實作現股多單移動出場啟動門檻、持久化最高價、回撤、fixed stop、ATR snapshot與gap重建政策。
- [x] 10.6 只依0.2a已核准decision table分別實作定時與定量mode的欄位、slot／split／尾數／收盤算法；單一商品、僅當日，前單working／unknown不疊單，missed不補送；未證實mode維持feature disabled。
- [x] 10.7 為臨時休市、calendar stale、clock jump、sleep/wake、提早收盤、跨日拒絕、event reorder與restart補齊 tests。

## 11. 舊 trigger、alert 與升級相容

- [x] 11.1 唯讀盤點 `localStorage`交易 trigger與純alert，分類時不得執行任意程式碼或送單。
- [x] 11.2 對缺帳號、confirmation revision、unit或 broker correlation的舊trigger只顯示「待人工重建」，禁止自動匯入／啟用。
- [x] 11.3 將純alert移到無broker side effect的authority，確保停用舊交易trigger不會消滅警示功能。
- [x] 11.4 以單一authority flag原子切換；新Runtime啟用後舊 `trigger-engine`不得呼叫broker，rollback也不得雙引擎並行。
- [x] 11.5 對記憶體 bracket只顯示無法復原與人工檢查提示，不從殘留UI狀態臆測保護。
- [x] 11.6 補齊可讀／損壞／無帳號／拒絕重建／純alert／雙authority啟動 tests。

## 12. 故障注入、資安與 deterministic 驗收

- [x] 12.1 注入prepared後／dispatching commit後第一byte前／HTTP write後response loss／broker ack後DB crash、event-before-ack／duplicate、缺trade date與跨日seqno／ordno碰撞；驗證dispatching起一律unknown-reconcile、proven-unsent prepared仍需re-arm、canonical correlation不錯單且不重送。
- [x] 12.2 注入DB busy、slow fsync／backup、worker queue飽和、disk-full、read-only、permission、corruption、migration failure、backup restore與雙Runtime；驗證event loop仍能處理事件／告警且write readiness fail closed。
- [x] 12.3 注入mode shared/exclusive lock競爭、broker ack後durable commit前切換、marker/info mismatch、unmanaged 8080、generation change、watchdog restart、simultaneous kill switches與emergency跨dispatch線性化點；驗證lease／deny-union語意且不宣稱撤回in-flight write。
- [x] 12.4 注入position drift、兩筆buy各自合法但合計超限、manual order、Runtime前多筆外部working sell、queue等待時外部sell、stale update/cancel target、snapshot後TOCTOU、OCO claim三representation／winner crash、cancel/fill race與unit mismatch；驗證reservation／claim不重複、本地intent依最後證據不主動超額且殘餘風險轉manual。
- [x] 12.5 注入stale/out-of-order/cross-date/simtrade/odd quote、AND時間不一致、gap、sleep/wake、clock jump與missing calendar；驗證不誤觸發。
- [x] 12.6 執行Host/Origin/CSRF/capability/replay/body/CORS/DNS-rebinding/Cloudflare security tests與DB/log/status secret scans。
- [x] 12.7 對每個reason code與versioned manual-intervention resolution matrix建立測試：generic resume拒絕、唯一final evidence、external drift新確認、break-glass relinquish與claim／obligation處理；確保unknown／accepted不冒充filled且原intent不重送。
- [x] 12.8 所有production-like adapter fixture只能存在test boundary；實際Runtime不得接受假行情或假broker成功。
- [x] 12.9 測試gate manifest缺失／tamper／build或Shioaji fingerprint改變、環境變數強開、automation偽造manual provenance／命中manual endpoint、合法manual ticket在automation gate關閉時的等價行為、probe被策略呼叫、跨run forged target、nonce重放與probe response loss；不得解鎖一般write master或盲目cleanup。
- [x] 12.10 測試canonical PnL fee/tax／full-day coverage缺值、午盤restart前外部虧損、deal重複／重排、跨日未reconcile、identity key-loss／collision、全域subscription usage未知與manual order-class回歸。

## 13. Shioaji simulation 分層驗收

- [x] 13.1 每次simulation write前保存不含秘密的證據：mode marker、`/api/v1/info.simulation=true`、generation、adapter固定完整帳號的遮罩摘要、readiness與1張上限；不得載入CA或production。
- [x] 13.2 優先由可信verifier重算並彙整0.3、0.3b、0.3c、0.4、0.6、0.7與current-day PnL source contract的既有正式證據／hash；不得為Gate彙整重做已證明的simulation委託。只有矩陣存在真實缺口時，才透過逐次授權probe-only envelope執行最小新增operation，並將遮罩結果hash回填[evidence.md](./evidence.md)。
- [x] 13.3 保護出場feature以獨立task-specific current contract／tick／BBO價位計畫，分別覆蓋prepare-before-entry、partial fill、OCO remainder、IOC unfilled與restart/reconcile；entry、working exit、marketable exit與IOC unfilled不得共用固定價格，每個broker operation各自綁短效exact envelope並逐次授權。無法確定重現的partial fill不得無界重送碰運氣，完成正式smoke後才可解鎖。
- [x] 13.4 七種策略逐一以獨立feature flag完成可控domain/adapter acceptance；市場時段可重現時再做有界quote→simulation order E2E，未成交不得冒充成功。
- [x] 13.5 關閉5173後驗證sidecar持續監控；關機／睡眠／斷網驗證離線與gap policy，不宣稱券商雲端。
- [x] 13.6 驗證Runtime status、macOS relogin、watchdog recovery、simulation return、rollback與uninstall obligation drain，涵蓋reconciling intent／pending-submit BrokerOrder；確保一般持股不誤擋、tracked remainder會擋、prepared intent與保護不自動resume。

## 14. 文件、驗證與交付

- [x] 14.1 更新README與runtime文件，固定警示「本機監控不是券商雲端」「觸發不等於成交」「未知結果禁止自動重送」「外部交易可能造成人工介入」。
- [x] 14.2 文件化七種類型的「官方可確認核心」與「本地安全縮限」分層、來源衝突、有效期、定時／定量decision tables、兩套不同20筆上限、所有non-draft不可修改與一年歷史。
- [x] 14.3 文件化四層狀態、pending protection／worst-case entry exposure／ExitClaim lineage與ExternalSellClaim、atomic OCO、canonical百分比／ATR／trailing公式、pause/resume/cancel、working order、RuntimeTrackedUnprotectedRemainder、manual resolution matrix與本機通知非證據。
- [x] 14.4 文件化Node／SQLite版本、private paths、backup/restore、migration、corruption、retention、rollback與uninstall drain。
- [x] 14.5 文件化same-origin gateway、endpoint matrix、server-derived provenance、capability／identity-key rotation、gate manifest、probe-only target lineage、Cloudflare禁止、mode雙重attestation＋durable-result shared lock、kill-switch deny-union與break-glass人工管道，不記錄秘密值。
- [x] 14.6 執行 `pnpm test`、相關browser tests、`pnpm build`、runtime script tests、security/fault suites、`openspec validate add-durable-smart-order-panel-and-protective-exits --strict`與 `git diff --check`。
- [x] 14.7 保存不含秘密的驗收矩陣與machine-readable manifest，逐項對應requirement、normal/failure/race scenario、simulation evidence hash、manual route coverage與feature gate；任何未通過類型維持disabled。
- [x] 14.8 清楚區分artifact apply-ready（可做Gate 0）、write-unlock-ready（Gate 0/1＋manifest＋current arm/readiness）與feature release-ready（Gate 2/3）；只有所有相應gate通過且使用者再度確認本機邊界後才標示feature完成。未授權不得production、CA、真實下單、archive、commit或push。
