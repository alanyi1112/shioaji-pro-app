## Context

目前 `OrderTicket` 先呼叫下單 API，成交事件出現後才由 `src/lib/bracket.ts` 在瀏覽器記憶體建立保護，再由 `src/lib/trigger-engine.ts` 依 5173 收到的行情觸發委託。一般 trigger 存在 `localStorage`，觸發時會先移除規則，並可透過 `bypassRisk` 送單。帳號選擇也可能在缺值時回退到 Shioaji server 的預設帳號。這些行為無法支撐關頁後監控、跨帳號隔離、重啟復原或未知 broker 結果。

現有 `production-readonly` 交易寫入防線位於 client／Vite proxy；sidecar 若直接呼叫 8080 會繞過它。現有風控設定在瀏覽器 `localStorage`，當日損益在瀏覽器記憶體，也不能由關頁後的 Runtime 沿用。order/deal normalizer 目前未完整保留帳號、`custom_field` 與 exchange sequence；position API 的證券數量是 `Share`，一般整股 order 則是「張」，若沒有明確單位邊界可能放大 1000 倍。

官方能力核對與本機程式證據整理在 [evidence.md](./evidence.md)。關鍵結論是：

- 大戶投智慧單由券商雲端監控，APP 無須開啟；同一 ID 跨帳號台股＋期權合計上限 20 筆，歷史保存一年。官方對建立後能否修改的公開說明互相衝突：現行總覽 FAQ、2026-01-29 手冊與逐類頁面偏向只能刪除，2025-12-11 教學文章 Q5 則寫可取消或修改；本設計不替券商裁決，獨立採 non-draft 交易 payload 不可原地修改的本地安全政策。
- 本次查核的Shioaji公開觸價範例由客戶端自行訂閱行情並呼叫`place_order`，公開文件／介面未提供broker-hosted智慧單建立功能。因此本設計只能承諾本機Runtime，不能推論券商內部能力不存在。
- 本次查核的Shioaji公開order介面未提供broker idempotency key；`custom_field`僅允許英數且最長6字元，不能據此宣稱絕對exactly-once。
- 盤中行情應使用 subscription／SSE，不能輪詢 snapshot、ticks 或 Kbars；order/deal 以事件為主，reconciliation 使用有界、明確帳號的 `update_status`／trades 查詢。

## Goals / Non-Goals

**Goals**

- 建立不依賴 5173 頁面生命週期、可持久化、可復原、可稽核的本機 simulation 智慧單 Runtime。
- 讓所有可啟用自動化之RealTimeStock股票帳號交易寫入經過同一mode、風控、帳號、數量與reservation authority；未完成手動order-class等價納管的帳號不開自動化。
- 將含保護的新單改為先持久化 entry intent 與 protection plan，再由 Runtime 送出進場。
- 以明確的狀態機、quote freshness、broker reconciliation 與故障策略避免錯帳號、重複送單、超賣與假成功。
- 採用七種台股智慧單的官方類型名稱與可確認核心流程，再套用本文件明示的本地安全縮限；每種類型獨立 gated、simulation-only，不宣稱與大戶投 feature parity。

**Non-Goals**

- 不提供券商託管、關機仍監控、跨裝置同步或遠端雲端 SLA。
- 不啟用 production、CA 或真實委託，不驗收正式帳號自動交易。
- 不把本機智慧下單描述為無人監督實盤的唯一停損、停利或風險保護；若未來另案支援正式寫入，仍須保留券商原生保護或明確人工備援。
- 不保證觸發後成交、成交價、排隊順位或 broker exactly-once。
- 不支援現股多單以外的自動部位出場；不支援零股、興櫃、權證、指數、特殊板、融資融券、當沖先賣、借券、期貨、選擇權與複委託。
- 不攔截或控制大戶投、其他 Shioaji client、電話或人工券商操作；只能偵測其造成的 broker state drift。

## Architecture

```text
┌──────────────────────────── 127.0.0.1 ─────────────────────────────┐
│                                                                   │
│  5173 React UI                                                    │
│       │ same-origin /__smart-orders + request revision            │
│       ▼                                                           │
│  Vite／packaged local gateway                                     │
│       │ 驗 Origin／Host／CSRF，從 0600 檔注入 capability          │
│       ▼                                                           │
│  Smart-order sidecar（single writer／fenced sender）               │
│       ├─ canonical mode／risk／kill switch                         │
│       ├─ quote coordinator／calendar／freshness                    │
│       ├─ strategy state machines／outbox／reconciliation           │
│       ├─ entry exposure + ExitClaim lineage                       │
│       └─ SQLite + audit journal + local notification               │
│       │ 明確 account + simulation generation                      │
│       ▼                                                           │
│  Shioaji HTTP／SSE server :8080（simulation only）                 │
└───────────────────────────────────────────────────────────────────┘

Cloudflare、非 loopback host、一般網頁與 browser JavaScript
                  └─────────────── 不可直達 sidecar ───────────────┘
```

5173 不持有 sidecar capability，也不直接成為持續監控 authority。same-origin gateway 讀取 repo 外、目前使用者私有且 mode `0600` 的隨機 capability，替內部請求加入認證。sidecar 只綁 `127.0.0.1`，所有 endpoint 都驗證 capability、精確 Host、Origin／Fetch Metadata、method 與 size limit，但依 endpoint 類型套用不同契約：mutation 要求 JSON、CSRF、schema、request ID、revision 與 replay guard；read 驗證 query schema 且無 side effect；SSE 驗證 auth／Origin、bounded cursor 或 `Last-Event-ID`；health 只回最小無個資摘要。不允許 wildcard CORS、GET side effect、simple-form mutation 或 Cloudflare 轉送。未來 packaged 模式也必須經過等價 gateway，不得另開較弱路徑。

這個 capability 主要防止一般惡意網站、CSRF 與非授權 gateway 呼叫；它不能防禦已取得同一 macOS 使用者權限、可讀取私有檔案的惡意程式。若同一使用者帳號已被入侵，Runtime MUST 視為信任邊界失守並依 emergency policy 停送，不能宣稱 loopback secret 是完整主機安全沙箱。

## Safety Invariants

以下 invariant 優先於功能便利性；無法證明時一律阻擋或轉人工處理。

1. **Simulation only**：每次 place、update、cancel 前立即同時驗證 mode marker 與 `/api/v1/info.simulation === true`，並在durable dispatching前取得跨程序 mode execution lease，綁定 API generation直到broker結果與identifiers已durable commit為acknowledged／terminal或unknown／reconciling。mode switch 必須取得 exclusive lock；未知、逾時、不一致、unmanaged 8080、結果只在記憶體或切換中的狀態不得送出／切換。
2. **Explicit account**：place 必須帶固定的 `broker_id + account_id + account_type`；query／position／`update_status` 必須 account-scoped。若 upstream update/cancel 只接受 `Trade`／`trade_id`，Runtime 必須先從固定帳號的 trades 唯一解析並在操作前後驗證帳號，不得捏造 upstream 不支援的 account 欄位，也不得使用 UI 當下帳號或 server default。
3. **Persist before effect**：先在 SQLite transaction 保存 canonical snapshot、activation、intent及適用的 `PendingProtectionCommitment`／`EntryExposureReservation`／`ExitClaim`，再發出 broker side effect；凡policy具有可預留上限，尚未成交 entry 必須原子保留worst-case新增曝險，但真正exit claim在confirmed fill前必須為0。
4. **No blind retry**：broker 可能已接受但 Runtime 未收到結果時，只能對帳；不能證明未送出就進入 `manual_intervention`，不自動重送。
5. **One active sender**：OS lock、DB fencing token 與 API generation 共同保證同一資料庫只有一個可送單程序；第二個程序只能讀或退出。
6. **Unit explicit**：價格使用 decimal string／整數 tick；數量以 base `Share` 持久化並帶 contract unit，只有在受測 adapter 邊界轉換 `CommonLot`。不允許隱含 1000 或 binary floating-point 比較。Gate 0另以current managed simulation唯讀probe前後固定managed process／generation／OpenAPI／account snapshot：positions固定送`unit=Share`，current Common order quantity只解讀為`CommonLot`，股票與ETF各自從canonical contract API取得`unit／category／reference／limit_up／limit_down／update_date`；report綁current production parser／observer／adapter source matrix並由獨立verifier重算，fixture、stale／重放、source drift或空positions但缺current OpenAPI契約一律無效。
7. **Locally bounded exposure and exit**：新增曝險評估納入所有manual／automation prepared、dispatching、working buy與EntryExposureReservation；exit以distinct ExitClaim lineage計量，OCO winner與Runtime working order只轉態不重複扣量。外部 App／電話可在最後檢查後競爭部位，屬無法消除的 TOCTOU 殘餘風險，drift 後必須停送、對帳與告警，不能宣稱券商原子的 reduce-only。
8. **Fresh data only**：過期、亂序、跨交易日、試撮、零股、非法或缺欄位行情不能推進條件。
9. **Trigger is not fill**：條件命中、intent 建立、broker 接受、部分成交與全部成交是不同狀態；UI 不得把其中任何一步冒充「已出場」。
10. **No silent degradation**：DB、calendar、contract、risk、account、trade subscription、quote、外部 working-order visibility 或 reconciliation 不可用時，不得降級成無持久化、無風控或快取行情送單。
11. **Machine-enforced gates and provenance**：server boundary衍生`manual_user_confirmed | automation | gate_probe`，browser不得指定或降級。automation必須同時滿足有效 gate manifest、Gate 1、feature gate、user write-master arm、strategy arm 與 current readiness；manual與probe走各自獨立且更窄的confirmation／nonce manifest，unknown provenance fail closed。

## Decisions

### 1. 產品名稱保留「智慧下單」，服務邊界固定為本機

面板標題沿用使用者要求的「智慧下單」，但面板 header、確認頁、監控列表及文件永久顯示「本機監控・非券商雲端」，並明示它是 simulation／客製化輔助工具、不作為實盤唯一保護。5173 關閉不影響 sidecar；Mac 關機／睡眠、網路斷線、8080 session 不可用或 sidecar 停止時不監控。離線狀態由前端根據 heartbeat 推導為「監控未知／離線」，不能假稱已由停止的 Runtime 將策略寫成 paused。

若產品目標改為關機後仍由券商雲端監控，必須取得券商正式支援的 host API 與授權後另立 change；本 proposal 不可延伸解釋。

真正零筆策略的空狀態以「新增智慧單」進入單選類型選擇器；全新建立預設選取「移動出場單」，但「下一步」只建立／更新草稿，不代表策略已建立、監控已啟用或 broker write 已獲授權。返回或複製既有草稿保留原類型。若移動出場單尚未通過獨立 feature gate 與 simulation 驗收，選擇器顯示不可用原因、不得以預設值繞過，也不得靜默改選其他類型。

### 2. 所有本專案交易寫入共用 trading-write gateway

sidecar 的 per-account queue 只能排序 sidecar 自己的請求，無法防止 OrderTicket、Flash Order、Grid 等本專案入口同時賣出相同部位。因此可啟用自動化之股票帳號的 place、update、cancel 必須共用 gateway／arbiter、canonical mode/risk 與 reservation。既有 UI 可保留，但不得再直送 8080。

切換前先建立 route／order-class matrix，逐一列出 OrderTicket、Flash、Grid、舊 trigger 與其他寫入入口，以及各自的 `Cash`／融資券／當沖、Common／IntradayOdd、LMT／MKT／MKP、ROD／IOC／FOK、place／update／cancel 契約。Gateway 是 transport／governance 邊界；本 change 的自動化 allowlist 只限制智慧單與自動保護，不能默默停用、改寫或重新分類既有手動功能。任一既有寫入路徑尚未能等價納管時，該帳號不得開啟自動化；若要移除既有手動能力，必須另列 Breaking Change 並取得使用者同意。

Gateway在可信server boundary依route、caller與nonce衍生`BrokerWriteProvenance`：`automation`綁strategy／activation／intent並驗完整automation conjunct；`manual_user_confirmed`只可來自已納管manual route與短效一次性使用者確認，仍受simulation、固定帳號、canonical risk／unit／reservation約束，但不要求strategy arm且scheduler不得呼叫；`gate_probe`只可來自獨立CLI run lineage與nonce。browser payload宣告provenance、automation呼叫manual endpoint或跨run probe target一律在broker bytes前拒絕。

外部 App 或其他 client 無法被 gateway 鎖住；Runtime 在策略建立、intent prepared、送出前、order/deal/cancel 後及週期性 bounded reconciliation 都重查 broker position 與 working orders。若外部 drift 使 invariant 無法成立，策略進 `recovery` 或 `manual_intervention`，不承諾自動修正。

### 3. Runtime 擁有 canonical 風控

風控 policy、policy revision、日損狀態、PnL as-of、account readiness 與 kill switch 持久化於 Runtime；前端只是受驗證的編輯器。建立策略與每次 broker 寫入前都重新評估。三種switch採deny-union並與dispatch共用arbiter線性化點；switch durable commit後不得開始新的被禁止write，已越過dispatch線性化點者只能完成confirmed／unknown與reconciliation，不能宣稱已撤回。

- `pause_new_exposure`：阻擋新增或增加曝險；已證明為現股多單 reduce-only 的保護出場與使用者明確取消工作單仍可進行。
- `pause_automation`：停止所有自動 place／update／cancel；使用者明確、再次確認的取消仍可經 gateway 執行。
- `emergency_block_all_writes`：阻擋 gateway 的所有 broker 寫入，包括保護單與取消；UI 必須明示需改用券商 App／客服處置。

硬性 mode、帳號、單位、position 與 contract invariant 永遠不可 bypass。風控／PnL 過期或無法證明 reduce-only 時，增加曝險與自動保護都 fail closed；不得保留 `bypassRisk` 後門。

canonical daily PnL 使用版本化 `PnlPolicy`，至少固定 `Asia/Taipei` trade date、per-account 與 identity-group aggregation、realized／unrealized／fee／transaction-tax components、來源欄位、估值價、as-of TTL、rounding 與 reset 規則。第一階段盤中 freshness TTL 為 5 秒；啟動／重啟時必須以account-scoped current-trade-date full reconciliation證明涵蓋Runtime啟動前及外部client的全部成交、費用與稅額，只靠啟動後event stream不足。deal／position event 重排時從去重後 canonical deal ledger 重算，不用增量累加猜測。任何 coverage、component、fee／tax、average cost、position、quote 或 authenticated identity mapping 無法從 Gate 0 核准來源取得時，受影響account與identity group的exposure-increasing write master 維持關閉，不得把缺值當 0。每次 dispatch 同時通過帳號上限與 identity-group 上限；跨交易日 reset 只有在官方 calendar、business session 與全部帳號 reconciliation 一致後發生。

### 4. 含保護的新單先 prepare，再送進場

使用者確認含保護的 entry 後，sidecar 在同一 transaction 保存：

- canonical confirmation snapshot 與 hash；
- 固定帳號、contract、`Cash/Common`、base-share 數量；
- entry order intent；
- protection formula、trigger 與 broker execution policy；
- `PendingProtectionCommitment`／`ProtectionObligation` 與事件 journal；此時 `filledShares=0`、`protectedShares=0`、`ExitClaim=0`；只要versioned policy具有quantity、notional、cash、position或order-count等可預留上限，就在同一transaction建立worst-case `EntryExposureReservation`，不得拿它扣既有部位。只有policy明示沒有任何可預留維度時才可省略，且manifest綁定該policy revision。

只有 transaction commit、mode/risk/readiness、single-writer fence 都成功後，才由 sidecar 送 entry。sidecar 不可用時阻擋整筆。這消除「先送進場，再由 browser 建立保護」的配置空窗，但不宣稱 broker 端 bracket：entry 成交到本機偵測並送出 exit 仍有市場與網路延遲。

broker confirmed fill 與 position reconciliation 一致後，Runtime 才在 transaction 中把相應shares建立為`ExitClaim.monitoring_reserved`、消耗／釋放相應 `EntryExposureReservation`，並更新 obligation 的 `filledShares/protectedShares`。entry 零成交終結時 obligation 以 zero-fill reason關閉，reservation與claim都歸零。若 protection 條件在 entry 尚有未成交餘量時命中，Runtime 先停止新的 activation；只有 `pause_automation` policy 未禁止自動 cancel 時才要求取消剩餘 entry並 bounded reconciliation，否則立即進 `manual_intervention`。取消結果未確認時高優先通知，不以可能過量的 exit 猜測處理。已確認的累計成交量才可建立 exit claim。

### 5. 使用 SQLite durable outbox，但不宣稱 exactly-once

sidecar 使用 Node.js LTS `>=24.15.0 <25` 的內建 `node:sqlite`；installer 必須解析並保存實際 Node 絕對路徑，不硬編 Homebrew 路徑。第一階段交易Runtime正式支援範圍固定為原生Apple Silicon `arm64` macOS實機；Intel Mac／`x64`、Rosetta、VM、Windows與Linux在installer、sidecar entry、evidence verifier與broker-authority projection都必須fail closed。這是本change的智慧下單交易Runtime邊界，不改變RealTimeStock一般前端與桌面主程式既有Apple Silicon／Intel／Windows／Linux支援。未來若要支援Intel交易Runtime，必須另立OpenSpec change，以當時current schema／source fingerprint取得原生Intel實機證據，不得沿用本change的arm64 report、trust manifest或host key。

因官方目前仍將 `node:sqlite` 標為 release candidate，Gate 0.9必須在一台原生、非hypervisor的Apple Silicon `arm64`實機，以current source fingerprint完成Node capability、WAL、`synchronous=FULL`、defensive mode、process crash durability、backup/restore、dedicated-worker event-loop isolation、latency／queue-age watchdog及LaunchAgent絕對Node路徑。報告使用單一arm64專用schema、私有Ed25519 host attestation與綁定current `runId + resultHash`的單host trust manifest；舊雙架構schema、`x64` report、未綁定或重放report一律拒絕。任一check未通過就停止交易Runtime並重新決定driver，不得在實作中悄悄替換。

SQLite 設定至少包含 `foreign_keys=ON`、WAL、`synchronous=FULL`、busy timeout、defensive mode、單一 writer 與 migration transaction。`node:sqlite`同步操作在dedicated worker／等價序列化executor執行；DB latency、queue age或backup超過versioned門檻立即使readiness為false，不能阻塞quote／trade event loop後繼續送單。資料表分離：

- `strategies`：不可變 non-draft activation snapshot、validity、identity group 與 policy revision；
- `activations`：條件 edge／schedule slot 的決定性 instance；
- `order_intents`：prepared／dispatching／unknown 與 deterministic local key；
- `broker_orders`：broker id、seqno、ordno、短 `custom_field`、account 與 status；
- `protection_obligations`：`PendingProtectionCommitment`、entry 最大量、實際 fill、confirmed exit、actively covered quantity、Runtime-tracked unprotected remainder與終結／release 原因；
- `entry_exposure_reservations`：policy具可預留維度時強制建立的worst-case新增曝險額度，不代表已持有部位；
- `exit_claims`：只對已確認position建立的account＋contract＋side＋base unit lineage；Runtime claim在`monitoring_reserved → intent_reserved → broker_working → consumed/released`間轉態，unknown阻擋，外部working sell使用獨立`ExternalSellClaim`；
- `observations`／`runtime_epochs`：必要的 bounded quote／stream／generation metadata；
- `event_journal`：exchange time、broker time、receive wall time、monotonic local sequence、reason code。

建立策略與每個 operation 都有 client request ID、payload hash、revision 與 replay guard。`prepared→dispatching`先durable fsync `dispatch_attempt_nonce`、sender fence、mode／risk／account／target revision；adapter只接受已驗證的dispatching record。從dispatching commit起，即使crash在第一個socket byte前也視為unknown／reconciling；只有仍為prepared且能證明adapter從未取得dispatch權者可在reconciliation與人工re-arm後送一次。SQLite unique key只避免本機重複 intent；外部 broker call 不在 transaction 內。故障點分為 send 前、dispatching後第一byte前、HTTP write 後無回應、ack 後未寫 DB、事件早於 ack、事件重送。只有 simulation 實證可 round-trip 的 broker identifiers 才能 correlation；canonical key至少綁固定帳號、`Asia/Taipei trade_date`、contract、side與已驗證broker IDs，`custom_field`只作輔助，未知結果永不自動重送。

備份使用 SQLite backup API 或一致性 snapshot，不直接複製活動中的單一 DB。disk full、permission、migration 或 integrity 失敗時停止 Runtime、保留原 DB 與備份，不得自動建立空 DB 假裝沒有策略。DB、WAL、SHM、backup 皆為私有權限。

### 6. 狀態分成四層，避免一個 `filled` 多種意思

| 層級 | 主要狀態 | 語意 |
|---|---|---|
| Strategy | `draft`、`observing`、`monitoring`、`paused`、`recovery`、`manual_intervention`、`cancel_pending`、`expired_with_obligation`、`completed`、`cancelled`、`expired` | 使用者建立的長期義務；只有 `draft` 可編輯交易欄位 |
| Activation | `armed`、`triggered`、`prepared`、`dispatching`、`working`、`part_filled`、`filled`、`cancelled`、`failed`、`unknown` | 一次條件 edge、交易日或 schedule slot |
| OrderIntent | `prepared`、`dispatching`、`acknowledged`、`reconciling`、`terminal`、`unknown` | 一個預期 broker side effect |
| BrokerOrder | `pending_submit`、`pre_submitted`、`submitted`、`part_filled`、`filled`、`cancelled`、`inactive`、`failed`、`unknown` | 經 broker 證據確認的狀態 |

每個 transition 有 allowlist、reason code、from revision、to revision 與 journal。pause 只停止未來 activation，不自動取消 working broker order；取消策略與取消 broker order 是不同 operation。resume 前重做 readiness/reconciliation，條件已成立時依策略保存的 activation policy 處理。任何已確認建立的 non-draft strategy，包括 paused、recovery、manual、cancel-pending 與 expired-with-obligation，交易欄位都不可修改；只能執行 allowlisted control operation 或複製為新 draft。

### 7. broker adapter 強制帳號、事件與 bounded reconciliation

建立 Node-safe adapter，不重用可能 fallback 到 browser current account 的 `src/lib/shioaji.ts` 路徑。place 直接帶完整固定帳號；query、positions、`update_status` 與 trade subscription 皆 account-scoped。若 Shioaji HTTP update/cancel 只接受 `Trade`／`trade_id`，adapter 先對固定帳號 `update_status`、列出 trades，以固定帳號＋trade date＋contract＋side＋broker IDs唯一解析並綁定broker-order revision。在per-account／per-order lock內、HTTP write緊鄰前再驗terminal state、remaining quantity與revision；排隊期間被外部fill／cancel／update即作廢舊intent並reconcile，可能已有bytes才發現則轉unknown且不retry。最後以 event／account-scoped reconciliation 驗證。無法唯一解析、回傳帳號不符或 contract probe 未證實時轉人工，不得捏造不存在的 account payload 或回退 default account。

Gate 0 必須另以官方完整性契約，或「sidecar停止時由另一個逐次授權simulation client建立多筆已知working sells，重啟後比對完整identifier／quantity／status集合」的可重現probe，證明 account-scoped trades／working-order view 能完整看見 Runtime 啟動前外部股票 working sell。只看見Runtime自己的order或單筆probe不足；固定帳號無法證明集合完整時，該帳號的 protection／smart-order write master為false。

事件是主路徑；polling 只用於啟動、斷線、generation 改變、heartbeat timeout、維護 epoch、未知 submission 與有界人工 refresh。沒有實證穩定 SSE event ID 前，不宣稱「事件序號缺口偵測」；以 disconnect/reconnect、heartbeat、API generation 與 reconciliation epoch 作為 gap 訊號。

### 8. 行情 coordinator 使用 subscription、freshness 與 gap policy

sidecar 自己維護 quote subscription refcount、重訂閱與 per-symbol freshness，不依賴 5173 registry，也不另開 Shioaji login。盤中不得輪詢 snapshots／ticks／kbars模擬即時行情。

每筆 observation 保存 canonical contract、quote field、trade date、exchange time、receive time、stream epoch、`simtrade`、`intraday_odd` 與 sequence（若 upstream 提供）。只有同一交易 session、欄位有限、時間單調、非試撮、非零股且未逾時的 observation 可更新條件。

- 快速單欄位 allowlist：成交價、買價、賣價、上漲、下跌、漲幅、跌幅、單量、總量；實作前逐欄對應實際 Shioaji Tick／BidAsk 欄位。
- AND 條件的所有 observation 必須同一交易日、同一 stream epoch，且 exchange/receive time 差不超過 3 秒；任一 stale 即不成立。OR 只使用造成 edge 的新鮮 observation。
- 新策略預設 `require_rearm`：啟用當下已為 true 時，先等待 false 再變 true。只有確認頁明確選擇 `immediate_if_true` 才可在 fresh current observation 立即 activation。
- 一般保護型 level 條件在重連後，若 fresh current observation 仍越界，可依保存政策觸發；需要 crossing 的策略若 gap 無法重建則進 recovery／人工處理，不臆測 crossing。
- trailing 在任何交易時段 subscription gap、sleep 或 event-loop pause 後都進 `manual_intervention`；查詢型 historical ticks 只能事後稽核，不得拿來重新解鎖自動出場，也不得把重連第一筆當新極值。只有能證明根本沒有缺 observation 的短暫 UI disconnect 才可沿用既有持久化極值。
- missed schedule slot 不補送、不 burst；定時定量到下個 slot 前若未恢復，該 slot 標為 missed。

Runtime 偵測 macOS sleep/wake、長 event-loop pause與 clock jump；wake 後先停止 dispatch、重新確認時間、calendar、orders、positions、subscriptions 與 quote epoch。

### 9. 交易日曆與時間 fail closed

所有策略使用 `Asia/Taipei` trade date、monotonic duration 與可校驗 wall clock。canonical scheduled calendar固定由證交所 `holidaySchedule` 年度JSON與櫃買中心 `bulletin/tradingDate` 年度JSON共同建立；Runtime只載入本年度完整日期集合，保存兩來源revision hash、schema version、涵蓋起訖與衍生`calendarVersion`。兩市場對同一日期的stock開休市判定必須完全一致；未知row語意、malformed schema、來源矛盾、非本年度日期或future-year推測一律使整份snapshot失效。每6小時重新抓取，snapshot最長12小時；refresh失敗會清除舊snapshot，不以週一到週五或上一年度資料繼續運作。

年度公告只能證明排定日曆，不能單獨證明颱風、天然災害或臨時休市。production trusted time authority固定為既有Shioaji business session中由quote coordinator簽發的Tick／BidAsk observation之`date`／`time`，並以contract exchange分開保存TSE／OTC evidence；plain object、browser input或未簽發authority不得餵入時間證據。Observation的exchange time、receive time與本機current wall clock必須在2秒內，trade date須落在current官方snapshot且當日開市，session採`[09:00, 13:30)`；evidence期限固定為exchange time＋2秒、receive time＋2秒及13:30三者最早者，wall clock倒退到receive time之前亦立即失效。臨時停市沒有fresh exchange-session quote時自然fail closed，不把年度公告的平日視為已開市。

calendar authority由local sidecar私有建立並注入issued Runtime controller。Quick與protective quote ingress都經module-private WeakMap將trusted observation交給core；controller的readiness只在目標market evidence current時成立。每一筆broker target在durable dispatch envelope取得時驗一次，且在每個resource operation unit核發後、對應transport first byte前再次同步重驗；時間／日期／market evidence在任何await或排隊期間失效時，不得送出broker byte。Runtime secondary、generation failover、stop或error皆關閉authority並清除snapshot與exchange evidence。

### 10. 價格與數量使用交易權威資料

送單與推導價位必須取得完整、未過期的 canonical contract，包括 exchange、security type、category、reference、limit up/down、unit 與 update date；不得用代碼前綴猜 ETF。

第一階段只有現股多單：

canonical百分比以整數basis points保存。若基準為`B`、`p=pctBps`、固定ATR為`A`、倍數為`k`，則stop百分比=`B×(10000-p)/10000`、take百分比=`B×(10000+p)/10000`、stop ATR=`B-kA`、take ATR=`B+kA`；第一階段`p`為1..9999，`k`為有限正數且受versioned policy上限約束。trailing activation用`B+distance`／`B×(10000+p)/10000`／`B+kA`；最高價=`max(savedHigh, eligibleLast)`；回撤用`savedHigh-distance`／`savedHigh×(10000-p)/10000`／`savedHigh-kA`。stop／回撤向上、take／activation向下取合法tick；非有限、overflow、stop／回撤不大於0或超contract限制都阻擋。golden vectors固定`B=100,p=300,A=2,k=2`得到97／103／96／104，`savedHigh=110,p=500`回撤104.5。

| 目的 | 理論價落在兩檔之間 | 理由 |
|---|---|---|
| 多單停損觸發價 | 向上到合法 tick | 不延後 `last <= stop` 的保護觸發 |
| 多單停利觸發價 | 向下到合法 tick | 不延後 `last >= take` 的保護觸發 |
| Sell LMT 委託價 | 依使用者選定的執行政策另算並再次確認 | 觸發門檻不等於委託價格 |

委託價另驗證買賣方向、漲跌停與允許組合。第一階段只允許 simulation contract spike 證實的 `LMT+ROD`、`LMT+IOC` 與 `MKT+IOC`；不支援 FOK、隱藏映射或自動追價。IOC 未成交／部分成交不自動重送；保留 remainder、標示未受保護並進人工處理，除非未來另立明確重試策略。

### 11. EntryExposureReservation、ExitClaim 與 OCO 以 lineage／remainder 為核心

每個exposure-increasing intent在policy有可預留維度時，都先以同一transaction建立worst-case `EntryExposureReservation`；risk計算納入manual／automation prepared、dispatching、working buy與既有reservation，避免兩筆並發買單各自通過但合計超限。terminal或reconciliation confirmed後才依實際fill消耗／釋放。

exit使用固定帳號＋canonical contract＋long position＋base shares的唯一`ExitClaim` lineage。Runtime claim依`monitoring_reserved → intent_reserved → broker_working → consumed/released`轉態，unknown阻擋；外部working sell另建`ExternalSellClaim`。OCO winner intent與Runtime broker working order只是同一claim的representation，不另扣量；account invariant以distinct claim ID加總。可新保護量等於最後 broker-confirmed 可用現股多單，扣除本地active claims及完整account-scoped view的外部claims。這只能約束 RealTimeStock intents；外部委託在 snapshot 後競爭仍是殘餘風險。

同一 protection group＋remainder generation 只有一個 active-dispatch slot。多個 leg 同時 eligible 時，Runtime 必須在同一 DB transaction 以 CAS／unique constraint 決定唯一 winner、將同一claim轉為intent_reserved並抑制sibling；loser 在任何 broker call 前停止。部分成交消耗claim並減少 protected remainder；工作單 terminal 且 reconciliation 明確後，才可用新的 remainder generation重新啟用其他 sibling。cancel 與 fill 競態以 broker 最終成交為準；存在unknown claim時不可啟用第二個 leg。winner commit 後當機仍保留唯一 winner；重啟對帳後必須由使用者重新 arm 才可送出 proven-unsent winner，若可能已 dispatch 則只對帳、不重送。

外部／手動成交造成部位減少時，若沒有working／unknown order，可把未觸發reservation縮至最新可用量並高可見度記錄；若有working／unknown競態則進`manual_intervention`。Runtime不得在drift後自動建立新的sell或重送；外部TOCTOU仍可能使broker結果超出本地最後snapshot，不能宣稱所有路徑絕對不形成空頭。

### 12. ATR 是版本化固定快照

ATR 預設為截至建立／確認時最近一根已完成日 K 的 Wilder ATR(14)。策略保存 timeframe、period、algorithm version、decimal ATR、`asOfTradingDate`、K 棒來源與完整性 hash。部分成交改變成交均價時只重算以均價為基準的價位，ATR 數值保持不變；Runtime 重啟不得換用新 ATR。除權息、contract 更新或資料 revision 使基準不可比時，策略暫停並要求建立新策略，不靜默改值。

### 13. 七種策略採官方可確認核心與本地安全縮限

- 快速單：`monitorContract == orderContract`，九種 allowlist 欄位擇一、保存 activation policy；九欄位未完成Shioaji三層mapping前逐欄disabled。
- 停損停利：只保護可驗證現股多單，position／monitor／order contract相同；官方手冊只證實選擇停損或停利，同時雙leg、ATR與本地OCO是明示的RealTimeStock extension，觸發與委託政策分離。
- 長效單：官方手冊確認`monitorContract` MAY不同於`orderContract`，兩者分別驗行情與委託readiness；inclusive 的 `Asia/Taipei` 起訖日期窗為 1–30 個 calendar dates，只在其中可驗證的交易 session 監控；每日最多一次，累計「實際成交」至目標；前日未達目標隔日重新監控，不補送未成交 IOC。
- 多條件：官方手冊確認最多7組、AND／OR、各monitor contract可不同且order contract可不同於所有監控商品；Runtime逐商品驗證subscription／mapping／risk。3秒coherence與OR edge為本地安全政策，九欄位未完成task 0.5前仍disabled。
- 母子單：第一階段只支援同一固定帳號的 Cash Common Buy 母單與 Sell 子單；`parent.monitorContract == parent.orderContract`、`child.monitorContract == child.orderContract`，但 parent 與 child MAY 是不同商品。母單監控窗採保守的 inclusive `Asia/Taipei` calendar-date span 1–30 日，全部實際成交才啟動一次子單；子單數量依自己的已確認快照與 child 商品可用現股驗證 reduce-only，不從母單數量跨商品推導。子單只在啟動交易日有效，依現行手冊於13:30未觸發或未成交即失效；Runtime仍須依broker policy對帳，不把失效自行解讀成任意cancel。母單外部revision drift使子單進人工，最後有效日收盤後才確認全成時不得跨日啟動。
- 移動出場：官方手冊確認基準價、可選fixed stop、有利最高價及固定價差／百分比回撤；保存啟動門檻、有利極值與回撤，固定ATR為本地extension；第一階段只支援現股多單。
- 定時定量：官方可確認單一商品、定時或定量、僅當日；現行手冊只確認定時的開始／結束／間隔與定量的開始／每次量／間隔。`official-smart-order-decision-tables.md` `2026-08-11.2`記錄精確端點、split、尾數、working、提早收盤與remainder算法仍未證實，因此兩種mode整體維持disabled。另列的不補送missed slot、不在前單unknown時建立下一單與不跨日，只是未來另案解鎖前仍須驗收的最低本地安全政策，不是目前可執行結果。

一般 1–30 日採不超過 30 個 inclusive `Asia/Taipei` calendar dates 的本地保守解讀，只在其中可驗證的交易 session 監控；Gate 0 必須保留官方 UI 截止日算法證據，若與本地解讀不同則在不放寬安全邊界下更新 spec，不宣稱兩者相同。此規則不覆蓋明定當日的母子單子單與定時定量。

Runtime 以 broker-authenticated、Gate 0 證明穩定的 canonical principal 建立 `identity_group_id = HMAC-SHA-256(identityKey, canonicalPrincipal)`；`identityKey` 是與 gateway capability 分離的 repo 外 `0600` per-install key，原始 principal 不寫 DB、UI、status 或 log。衍生結果跨重啟必須一致；key 遺失、rotation、principal mapping 衝突或無法跨帳號證明同一人時，write master fail closed，且有未終結義務時不得重建新 group 繞過上限。

本機上限以`COUNT(DISTINCT strategy_id)`計算；同一strategy同時有order／obligation／reservation仍只算一筆，但只要任一義務未終結就不能釋出名額。所有非終結RealTimeStock股票策略都計入同一identity group跨固定股票帳號20筆；paused、recovery、manual_intervention、cancel-pending與expired-with-obligation不能繞過。這是採同樣數值、但不同資源與更保守狀態集合的本地限制；本次查核的Shioaji公開文件／介面未提供與大戶投同一ID跨帳號台股＋期權券商雲端額度同步的能力，兩者不得被描述為同一上限。

本機歷程保留採`Asia/Taipei` calendar-year policy：`purgeEligibleAt`為strategy terminal／released時間與最後一筆關聯broker／audit evidence時間兩者較晚者加1個calendar year，不用固定365日。non-terminal strategy、unknown intent、working order、obligation或reservation永不因年限自動purge；閏日與月底由versioned calendar arithmetic及golden vectors固定。

### 14. Readiness、通知與資源上限

`health` 只代表程序可回應；`readiness` 才代表可建立或送出。readiness 同時要求：

- repository writable／integrity 通過、single-writer fence 有效；
- mode marker 與 `/info` 同為 simulation 且 generation 穩定；
- 固定帳號存在、signed、trade subscription 就緒，authenticated identity group 穩定；
- account-scoped orders／positions reconciliation 完成，且已證明能列出 Runtime 啟動前的外部 working sells；
- canonical risk／PnL／kill switch 新鮮；
- contract／calendar 有效；
- 目標 quote subscription 成功且 observation 新鮮；
- 沒有阻擋該 account/contract 的 unknown intent 或 reservation drift。

2330 Snapshot 只作 business-session watchdog probe，不等於交易 readiness。Runtime 共用既有 login，不自行另開連線。官方公開的 market data 50／10秒、accounting 25／5秒、orders 250／10秒、`api.subscribe()` 最多200個subscriptions／訂閱項目、每個`person_id`最多5個connections與每日1000次login是不同資源；官方頁面未定義200的Tick／BidAsk／商品等實際計數維度與跨client共享範圍，不能寫成「200個標的」或已證實的「同一login全域上限」。Gate 0 task 0.16必須先證明計數維度，以及5173、5174、watchlist、charts、alerts與smart-order的subscribe ownership／usage是否共享且可完整列舉；只有對已證實共享且計數維度明確的資源池，才採本地160上限與40 headroom。usage未知、外部client不可見或分類不明時智慧單不得新增subscription，write master維持關閉。place／update／cancel／`update_status` 等operation必須先分類到正確官方rate bucket；分類未完成前共用更保守的本地limiter，核准後仍以平均每秒5筆、bounded queue與安全capacity為本地上限。queue依序優先reconciliation／status、使用者確認cancel／已驗證reduce-only protection、新曝險；queue-head broker write緊鄰前重新驗position、working-sell set與target revision。subscribe失敗、queue滿或resource budget觸發時拒絕新策略並暫停受影響策略。

macOS 本機通知用於觸發、broker 接受、部分／全部成交、失敗、Runtime 離線與 manual intervention；通知是 best effort，不能當作狀態證據。唯一權威仍是 Runtime 快照與 broker reconciliation。

### 15. Gate manifest 與 probe-only safety envelope 是 dispatch 前置條件

Gate runner 產生 machine-readable、browser 不可修改的私有 `gate_manifest`，至少綁定 app build revision、sidecar schema／adapter revision、Shioaji server version與 capability fingerprint、Node／SQLite／OS platform fingerprint、Gate 0 evidence IDs與 result hashes、route/order-class coverage hash、PnL policy revision、使用者接受的本機產品邊界版本及各 feature gate。`automation` provenance每次 dispatch 都重新驗證：

```text
manifest valid
AND Gate 1 passed
AND feature gate passed
AND user write master armed
AND strategy explicitly armed
AND current readiness
```

`manual_user_confirmed`使用獨立manual route coverage manifest與短效一次性使用者confirmation，不要求strategy arm但仍驗共同simulation／account／risk／unit／reservation；`gate_probe`只接受獨立CLI run lineage、target ownership與nonce envelope。manifest mismatch、Runtime／Shioaji／adapter upgrade、mapping／policy revision 或證據失效立即回 observe-only。`SMART_ORDER_WRITE_MASTER`、環境變數、feature flag、DB 編輯、browser provenance或 UI 值都不能單獨覆蓋任何 conjunct；dispatch function 本身必須強制檢查，不能只靠頁面 disabled。

Gate 0 需要真實 simulation write 的 contract probe 使用獨立 CLI／entrypoint 與一次性 nonce，不可由策略 scheduler、quote callback、一般 feature flag 或 UI API 呼叫。每一次 place/update/cancel 都要當場取得使用者對「simulation、固定帳號（只在UI／evidence遮罩）、最大 1 CommonLot、預期操作」的明確授權，重新做 mode shared lease＋雙重 attestation，確認 CA／production 未載入，禁止自動 retry，並在 operation 後 bounded `update_status`／trade／position 對帳。probe update／cancel只能操作同run建立且canonical correlation唯一、仍non-terminal、revision未變的target；禁止任意或跨run trade_id。probe 結果未知時停止且標記人工處理；不得為 cleanup 猜測 cancel，也不得開啟一般策略 write master。

Task 0.3完成後的task-specific probe另採動態價位計畫，不修改或重用Task 0.3 sender。顯示授權前必須先成立observer／subscription readiness，並在同一短效唯讀preflight前後固定managed process、generation、source fingerprint、固定帳號、trade date、current positions／working orders、contract `reference／limit_down／limit_up／update_date／category`、合法tick、best bid／ask與可信exchange time。exact商品、side、price／price type／TIF、quantity、account scope、operation、run、target identity／revision、證據hash與期限全部綁進envelope、request hash及CLI HMAC；adapter只能送出相同exact payload。任何資料缺漏、過期、非法tick、穿價、漲跌停外、scope／revision漂移都在broker byte前拒絕。

0.3b的Buy LMT place以current BBO以下合法且不易成交的`P1`建立同run唯一target，update另取不同且同樣不穿價的`P2`，每一步重讀固定帳號target並升revision，最後才逐次授權cancel。0.3c的多筆外部working sells須先證明足夠且無unknown的可用position，另行核准client在sidecar停止期間以高於可成交範圍但不超過limit up的合法tick建立；重啟後核對完整集合。0.4需要真正deal event，另以current合法marketable LMT或已核准MKT+IOC驗完整correlation。0.6分別依working／Filled／IOC zero-fill目的選擇非marketable／marketable／明顯非marketable價位，MKT payload不得以猜測價格替代；不可確定重現的PartFilled或status不得用無界重送碰運氣。13.2優先重算並彙整既有正式證據，不為Gate重做已證明委託；13.3以獨立價位計畫分別覆蓋entry、working exit、marketable exit與IOC unfilled，不共用固定價格。

### 16. 生命周期操作不得遺棄 Runtime 追蹤義務

`production-readonly` 切換、feature flag 關閉、rollback、stop 與 uninstall 前，Runtime 先：

1. 停止接受新 activation；
2. 列出 non-terminal strategy、所有non-terminal side-effect intent（dispatching／acknowledged／reconciling／unknown）、所有non-terminal BrokerOrder（pending_submit／pre_submitted／submitted／part_filled）、EntryExposureReservation／ExitClaim 與 `RuntimeTrackedUnprotectedRemainder`；
3. 完成 bounded reconciliation；
4. production-readonly可保留沒有任何side-effect／claim／obligation的paused／quiesced strategy；一般 graceful stop／rollback／uninstall則仍預設拒絕任何non-terminal strategy。兩類操作都必須等Runtime相關broker order terminal、side-effect intent terminal、所有reservation／claim歸零、obligation terminal／released；prepared且可證明adapter未取得dispatch權者可明確cancel／release而不呼叫broker。「保留 working order並停止監控」只允許 break-glass 強制流程，不能算一般 drain；
5. 保存一致性 snapshot 與稽核結果。

`RuntimeTrackedUnprotectedRemainder = max(0, obligation.filledShares - obligation.confirmedExitedShares - obligation.activelyCoveredShares)`，只計Runtime建立的`ProtectionObligation`。`activelyCoveredShares`是distinct ExitClaim lineage投影，只包含fresh readiness下有效monitoring／intent claim或account-scoped reconciliation唯一確認同claim仍broker-working的base shares；representation不重複計數，設定、stale／offline監控、released／consumed或unknown claim都不算。一般既有持股若從未綁定obligation，不會單獨阻擋stop/uninstall。obligation只可在entry零成交且terminal、已確認全部退出／position歸零，或使用者以二次確認逐項relinquish並留下人工接手snapshot時terminal／released；對應entry reservation／exit claim必須歸零。

broker dispatch 與 mode switch 共用跨程序 mode lock：dispatch在durable dispatching前取得 shared execution lease，直到broker結果與identifiers已durable commit為acknowledged／terminal或unknown／reconciling；DB commit失敗時sender fail-stop且dispatching狀態持續阻擋。mode switch 取得 exclusive lock、先阻擋新 lease、等待既有 lease 全部結束，再改 mode marker／API generation。unmanaged 8080 或無法證明 generation 時 fail closed。回到 simulation／Runtime restart後建立新 generation、完成 reconciliation，但所有 strategy 與 proven-unsent prepared intent 仍顯示「已準備、尚未送出」，使用者重新確認最新 risk／confirmation 並 resume＋arm 前不得 dispatch；LaunchAgent 自動重啟不代表保護自動恢復。強制停止／切換必須二次確認並把受影響項目標為 unmonitored，但不能偽造 broker 結果。

每個`manual_intervention` reason code另有versioned resolution matrix，固定必要broker evidence、允許operation／state transition、是否可re-arm、reservation／claim／obligation處理與audit。generic resume不能解除；unknown submission只有唯一final broker evidence可正常結案，否則只能二次確認break-glass relinquish並標示unmonitored，原intent永不重送。

### 17. 舊 trigger 採唯讀盤點與人工重建

現有 `trigger-engine` 同時含交易 trigger 與純 alert。migration 只偵測 schema 完整的資料並顯示「待重建」；因舊資料沒有可靠帳號、confirmation revision 與 broker correlation，不做自動匯入或啟用。純 alert 保持原功能或移到無交易 side-effect 的 alert engine。單一 authority flag 原子切換新舊交易引擎，任何時刻只能有一個交易 sender。

## Migration and Rollout

1. 完成 Gate 0 official/API contract probes、route/order-class matrix、PnL／identity／subscription policy、threat model 與產品邊界確認；只有逐次人工授權的 probe-only CLI 可送最小 simulation smoke，一般策略全程 observe-only。
2. 建立 domain model、decimal／unit type、state transition table、risk policy、reservation 與 deterministic fault tests。
3. 建立 pinned Node runtime、SQLite repository、backup/restore、single-writer、outbox 與 reconciliation；仍禁止 broker write。
4. 建立 same-origin gateway、sidecar lifecycle、mode generation fencing、readiness 與 shadow observations。
5. 逐帳號將所有 RealTimeStock 股票交易寫入接到 gateway，對每個既有手動 order class 做 payload／確認／風控等價回歸；任何旁路存在時該帳號自動化維持關閉。
6. 獨立開發保護出場；通過「先保存後進場」、故障點、部分成交與 simulation smoke 後才允許該 feature。
7. 七種策略各自開發、各自 feature flag、各自通過 domain／adapter／simulation 驗收後解鎖。
8. 舊 trigger 只提供人工重建；不在 migration 時自動啟用。
9. rollback／uninstall 走 obligation drain，不刪 DB、WAL、backup 或 audit。

## Test Strategy

- **純 domain**：狀態 transition、決定性 activation ID、decimal/tick、Share/CommonLot、ATR snapshot、calendar、freshness、AND coherence、schedule、三種 reservation、atomic OCO winner、canonical PnL、identity-group count與risk classification。
- **repository／fault injection**：DB busy/disk-full/read-only/corruption、migration rollback、雙 Runtime、send 前 crash、write 後 response loss、ack 後 DB crash、event-before-ack、duplicate event、backup/restore。
- **security**：缺 capability、惡意 Host、DNS rebinding、跨來源 fetch/form、缺／錯 Origin、GET mutation、content-type/body limit、request replay、log/DB secret scan、Cloudflare／非 loopback拒絕。
- **adapter contract**：explicit place account、account-scoped update/cancel resolution、Runtime 啟動前外部 working-order visibility、`custom_field` 六字元、order/deal round-trip、event account、trade subscription、`update_status`、position/PnL units、MKT/LMT/IOC/ROD、既有手動 order-class matrix與simulation unsupported products。
- **recovery**：5173 關閉、sidecar restart不自動re-arm、8080 watchdog restart、SSE reconnect、sleep/wake、clock jump、mode shared/exclusive lease、unknown submission、position drift、OCO simultaneous winner／fill-cancel race。
- **simulation smoke**：只由獨立 probe-only envelope 或已完整解鎖的 feature 執行；每次寫入前實證 `/info.simulation=true`、使用明確測試帳號與最小 1 張、逐次人工授權、絕不載入 CA／production且不盲目 cleanup；盤後無法控制行情的情境以 adapter fixture 測，不以假行情冒充實際 E2E。
- **UI/accessibility**：預設／最小 footprint 無裁切、確認快照變更即失效、鍵盤／focus、錯誤與未受保護狀態高可見度、永久本機標示。

## Risks / Trade-offs

- 本機 Runtime 仍可能因關機、睡眠、斷網或 session 失效停止監控；永久揭露並以 gap policy／人工處理，不能包裝成雲端。
- persist-before-effect 不能把 SQLite transaction 與 broker transaction 原子化；以 at-most-once automatic dispatch、correlation 與 unknown-stop 降低重複委託風險。
- 統一 trading-write gateway 擴大改動面，但若不統一就無法對本專案手動單與智慧單提供 account-wide reservation。
- Gateway 無法鎖住外部 App／電話與最後 broker snapshot 之間的競態；「本地驗證 reduce-only」仍可能被外部 TOCTOU 破壞，因此 UI、確認與文件必須揭露，且 drift 後不自動重送。
- `node:sqlite` 目前不是穩定等級；必須以原生Apple Silicon arm64 Gate 0 crash probe決定是否可用，不能為趕進度跳過。Intel交易Runtime不是本change的deferred checkbox，而是未來另案產品範圍。
- fail closed 可能延誤保護出場；這是避免錯帳號、超賣或重複委託的取捨，UI 與本機通知必須立即揭露需人工介入。
- 本機 20 筆採官方相同數值，但資源、支援商品與計數狀態不同；一年歷史也是本地保存政策，兩者都不代表建立或占用券商雲端智慧單。
- 重啟後一律人工 re-arm 可避免 crash recovery 意外送出，但也會中斷自動保護；確認頁必須把「LaunchAgent 重啟不等於保護恢復」列為高可見風險。若未來要讓已證明 reduce-only 的保護自動恢復，須另立獨立 protection master change。

## Blocking Questions / Evidence Gates

以下項目不是留給實作者自由選擇；每項都必須在 tasks 的 Gate 0 取得證據並更新 [evidence.md](./evidence.md)，否則 write master 維持關閉：

1. 使用者是否接受「本機監控・非券商雲端」的產品邊界；若答案是否定，停止此 change。
2. machine-readable gate manifest、dispatch conjunct 與 probe-only envelope 是否能保證環境變數／feature flag 不可單獨解鎖。
3. 目前 Shioaji HTTP server 的 `custom_field`、order ID、deal ID、帳號與 account-scoped trades 是否可在 simulation 完整 round-trip，且能否看見 Runtime 啟動前由外部 client 建立的 working sell。
4. place 明確帳號，以及 update/cancel 以固定帳號唯一解析 `Trade`／`trade_id` 的實際 HTTP 契約；不存在的 upstream account 欄位不得被假設。
5. 同一 login 的 quote／trade SSE subscription ownership、全域用量、重連、browser unsubscribe 互動及事件欄位是否足以執行 freshness／reconciliation 契約。
6. 所有既有股票交易入口的 route／manual order-class matrix 能否等價納管；任何旁路存在時對應帳號自動化保持關閉。
7. 支援的自動委託組合、既有手動委託組合、position `Share`、contract unit與 canonical PnL components 的實際 payload。
8. authenticated canonical principal 是否可穩定跨股票帳號對應，且 keyed HMAC 在 restart／rotation／key-loss 時可 fail closed。
9. Node `>=24.15.0 <25` `node:sqlite` 在原生Apple Silicon `arm64`實機的durability、WAL、`synchronous=FULL`、backup/restore、defensive mode、dedicated-worker isolation、latency／queue-age watchdog與LaunchAgent絕對Node路徑；Intel交易Runtime另案。
10. TWSE／TPEx 官方交易日曆與 trusted time 的 canonical 取得、版本、涵蓋期間、臨時休市更新與失效判定，以及官方 1–30 日 cutoff 算法。
11. 定時與定量兩種 mode 的現行官方欄位、單位、推導、尾數與收盤契約；未證實 mode 維持 disabled。
12. packaged desktop 若存在，如何經過與 5173 等價的 same-origin/capability gateway；未證明前只支援本機 5173。

OpenSpec artifacts 通過 strict validation只代表「artifact apply-ready，可開始執行 Gate 0」；Gate 0／1 manifest 全通過才是 write-unlock-ready；Gate 2／3 對應 feature 全通過才是 feature release-ready。三者不得混稱完成。
