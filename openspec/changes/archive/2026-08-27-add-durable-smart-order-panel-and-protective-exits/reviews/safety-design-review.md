# 智慧下單安全設計正式審查紀錄

## 審查識別

- 審查紀錄版本：`smart-order-safety-design-review/2026-08-12.1`
- 審查基線版本：`smart-order-safety-design-baseline/2026-08-12.1`
- 審查日期：2026-08-12（Asia/Taipei）
- 審查方式：由 Codex formal safety review 依六個互相獨立的 review lens 逐項初審、處置與再審；本紀錄不是外部稽核或券商認證
- 對應 change：`add-durable-smart-order-panel-and-protective-exits`
- 對應 task：0.12
- 審查結果：六個 review lens 的**文件／設計模型範圍**均予以 `sign-off`；沒有未關閉的文件層 P0／P1 finding

本紀錄只表示中央 trading-write gateway、canonical risk／kill switch、account-wide reservation／claims、mode shared／exclusive lock、quote-gap recovery 與 order execution policy 的書面安全契約已完成正式審查。它不表示 route coverage、Gate 0／1、broker contract、canonical PnL、外部 working-order 集合完整性、行情 continuity、simulation acceptance 或任何 feature gate 已通過，也不授予 broker write authority。task 0.3–0.9、0.13–0.17 與下列 integration blockers 未完成前，策略 write master、一般 simulation broker write、production 與 CA 全部 MUST 維持 fail closed。

本次審查只讀取本機 OpenSpec artifact；沒有連線 8080、沒有讀取或保存帳號、沒有建立行情／trade subscription、沒有呼叫 place／update／cancel，也沒有啟動、停止或修改任何現行服務。

## 綁定輸入與內容雜湊

| 輸入 | SHA-256 | 審查用途 |
|---|---|---|
| `design.md` | `75bd12e92f78c4d17c7a365b154acc3224d9ebc30b6ab5011649cb6b7e4ca511` | 安全 invariant、中央 gateway、風控、mode lease、gap、execution、rollout 與 Gate 邊界 |
| `specs/durable-smart-order-runtime/spec.md` | `bd4b2fdb3d95d81f9e1ce8aed91e6e2b080a6ca0726e5d7773d66acf2afad970` | gateway／provenance、risk／PnL、reservation／claim、mode lock、quote、reconciliation 與 resource policy 的 normative 契約 |
| `specs/protective-exit-order-ticket/spec.md` | `eb3d60f5f5316355b7b4fe36a71a6ecb755e1d54b6024e9221b1bdeb2230429b` | trigger／execution 分離、entry race、IOC、OCO remainder、價格與數量政策 |
| `specs/safe-local-runtime-mode-switch/spec.md` | `667cae555f3544dbf4617c1ce12745f0566b1dedbb2a6a6bfa8f16b89dfc1b33` | shared／exclusive mode lease、durable result、recovery 與 lifecycle fail-closed 契約 |
| `specs/smart-order-panel/spec.md` | `832950c6cb3eb46dfbac2618557598d25b28167b586bd78a79fa25833df3a7c7` | confirmation、策略控制、狀態揭露、feature gate 與 unsupported branch 契約 |

任一綁定輸入的內容或 SHA-256 改變，本紀錄的 sign-off 立即失效，必須重新執行六個 review lens 並更新 finding disposition；不得只改版本字串、task checkbox、evidence 或 gate manifest 來沿用本紀錄。

## 審查準則與共同判定

六個 review lens 共同使用下列判定準則：

1. **P0**：設計若未處理，可能允許錯帳號、錯模式、重複或未授權 broker write、超額新增曝險、超賣、或把未知結果誤當安全終態。
2. **P1**：設計若未處理，會削弱可稽核性、可恢復性、資料新鮮度、支援矩陣或產品邊界，並可能在特定失敗情境放寬安全契約。
3. **Gate／integration blocker**：文件契約已明確，但仍缺受管 Runtime、route coverage、broker／行情 capability 或 simulation evidence；它不是已關閉的產品能力，且 MUST 使相應 write conjunct 為 false。
4. finding 只有在 normative 契約明確指定 authority、線性化點、durable state、失敗處置與禁止路徑後才可標示 `closed`；以 UI disabled、環境變數、測試 fixture、通知或未受管報告取代均不算關閉。
5. 所有 lens 的 sign-off 都只屬 artifact／設計層。review sign-off 不是 gate manifest evidence 的 `passed` conjunct，也不能取代 current arm、readiness、simulation attestation 或使用者逐次授權。

## Reviewer sign-off 摘要

| Review lens | 審查範圍 | P0／P1 再審結果 | Sign-off |
|---|---|---|---|
| `GW` 中央 gateway／provenance | 所有 RealTimeStock place／update／cancel、route coverage、manual／automation／probe 權限隔離 | 2 P0＋1 P1 closed；integration blockers另列 | `signed_off_document_scope` |
| `RK` canonical risk／kill switch | Runtime authority、PnL freshness、deny-union、arbiter revision、emergency 線性化語意 | 2 P0＋1 P1 closed；integration blockers另列 | `signed_off_document_scope` |
| `AR` account-wide reservation／claims | worst-case entry reservation、ExitClaim／ExternalSellClaim、OCO、外部 drift／TOCTOU | 3 P0＋1 P1 closed；integration blockers另列 | `signed_off_document_scope` |
| `ML` mode shared／exclusive lock | 雙重 simulation attestation、shared execution lease、exclusive switch、durable result／unknown | 2 P0＋1 P1 closed；integration blockers另列 | `signed_off_document_scope` |
| `QG` quote-gap recovery | subscription authority、freshness、epoch／gap、crossing、trailing、schedule、clock／calendar | 2 P0＋2 P1 closed；integration blockers另列 | `signed_off_document_scope` |
| `OE` order execution policy | trigger／broker policy分離、委託組合、target revision、timeout、rate queue與未知結果 | 3 P0＋2 P1 closed；integration blockers另列 | `signed_off_document_scope` |

## GW：中央 trading-write gateway／provenance

### 審查結論

- 對任何可啟用自動化的股票帳號，所有 RealTimeStock 控制的 place／update／cancel 都必須經同一 gateway／arbiter；browser、sidecar 或既有功能不得直送 8080。
- gateway 是 governance／transport authority，不得把智慧單的 `Cash/Common` allowlist 誤套到既有手動委託。route／order-class coverage 尚未證明等價時，保留既有手動功能現況，但相應帳號 automation write master 固定為 false。
- `BrokerWriteProvenance` 只能由可信 server boundary 依 route、caller 與一次性 nonce 衍生。browser payload、scheduler 或 quote callback 都不能把 automation 降級為 `manual_user_confirmed`，也不能跨 run 重用 `gate_probe` target。
- gateway 只能治理 RealTimeStock 自己控制的 writes；外部 App、電話或其他 client 的變動必須透過 reconciliation 偵測並停止受影響 automation，不能宣稱已被 gateway 鎖住。

### Finding closure 與再審

| Finding ID | Severity | 初審問題 | 處置／normative contract | 再審結果 |
|---|---|---|---|---|
| `GW-P0-01 uncontrolled write-route bypass` | P0 | 任一既有 route 可繞過 gateway，account-wide risk／reservation 即不成立 | route／order-class coverage matrix與per-account automation gate為硬前置；任一路徑未納管或手動等價未證明時automation master必為false，禁止直送8080 | `closed`；文件不存在以部分coverage解鎖整個帳號的分支 |
| `GW-P0-02 client-forged provenance` | P0 | automation可能偽造manual／probe authority，繞過strategy與feature gate | provenance只由server依可信route、caller、短效confirmation／run nonce衍生；client supplied、跨route、跨run與重放在broker bytes前拒絕 | `closed`；manual、automation與probe使用互不替代的conjunct |
| `GW-P1-01 external-client governance overclaim` | P1 | 將gateway誤宣稱能阻止券商App／其他client交易，會隱藏TOCTOU | 明列外部client不受gateway鎖定；position／working-order drift觸發reconciliation、pause／manual與告警 | `closed`；產品邊界與殘餘風險已有明確揭露 |

## RK：canonical risk／kill switch

### 審查結論

- risk policy、policy revision、current-trade-date canonical PnL、account／identity aggregation、readiness與kill switches均由Runtime持久化；browser `localStorage`、UI值或`bypassRisk`沒有交易 authority。
- `pause_new_exposure`、`pause_automation`、`emergency_block_all_writes`採禁止條件聯集，並與dispatch共用arbiter revision與線性化點。較寬鬆switch不能重新允許另一switch已禁止的operation。
- switch durable commit前仍在queue的write必須在broker bytes前拒絕；已越過dispatch線性化點的write只能保守完成confirmed或unknown／reconciling，不能宣稱emergency已撤回。
- PnL、position、account、identity、fee／tax、policy或reconciliation coverage任一缺失／逾5秒時，受影響新增曝險與不能證明reduce-only的保護一律fail closed；缺值不得當0。

### Finding closure 與再審

| Finding ID | Severity | 初審問題 | 處置／normative contract | 再審結果 |
|---|---|---|---|---|
| `RK-P0-01 kill-switch override or lost update` | P0 | 多個switch並發或不同revision可能互相覆寫，重新放行被禁止write | effective policy固定為deny-union；switch mutation與dispatch共用arbiter revision／CAS與線性化點 | `closed`；所有禁止條件同時生效，解除一個switch不會解除其他switch |
| `RK-P0-02 emergency falsely retracts in-flight write` | P0 | emergency在dispatch後commit時若標示write已取消，可能漏對帳或重送 | 線性化點前拒絕；線性化點後只允許durable confirmed或unknown／reconciling並強制reconciliation，不宣稱撤回 | `closed`；文件明確區分queue中與已越過dispatch點的語意 |
| `RK-P1-01 stale or partial PnL treated as zero` | P1 | 缺fee／tax、pre-start／external成交或identity aggregation時可能錯放新增曝險 | versioned PnlPolicy、current-trade-date full reconciliation、去重重算、5秒TTL與account＋identity雙層gate；缺任一component即false | `closed`；沒有以啟動後event stream或缺值0解鎖的分支 |

## AR：account-wide reservation／claims

### 審查結論

- 所有可增加曝險的manual／automation intent，在policy有可預留維度時，必須於建立intent的同一transaction保存worst-case `EntryExposureReservation`，並在account＋identity同一arbiter revision納入position、working buy、prepared／dispatching與既有reservation。
- exit使用account＋contract＋long-position＋base Share的唯一`ExitClaim` lineage；`monitoring_reserved → intent_reserved → broker_working`是同一claim的representation轉態，按distinct claim ID＋remainder generation只計一次。
- 外部working sell使用獨立`ExternalSellClaim`；啟動前多筆集合完整性未經Gate 0證明時該帳號automation disabled。queue等待後仍須在broker write緊鄰前重驗position、working-sell set與revision。
- 本機revalidation只能證明RealTimeStock依最後broker證據不主動超額；外部client在最後snapshot後仍可能競爭，下一個event／reconciliation必須停送與告警，不能宣稱broker原子reduce-only。

### Finding closure 與再審

| Finding ID | Severity | 初審問題 | 處置／normative contract | 再審結果 |
|---|---|---|---|---|
| `AR-P0-01 concurrent exposure oversubscription` | P0 | 兩筆各自合法的buy可能以同一舊快照同時通過，合計超account／identity上限 | 同一arbiter transaction／CAS依序建立worst-case reservation，納入全部manual／automation與broker曝險 | `closed`；最多允許符合新aggregate的請求，不以尚未成交忽略reservation |
| `AR-P0-02 exit/OCO representation double count` | P0 | monitoring、winner intent與working order若各扣一次，可能錯判可用量或送第二個exit | 每份shares使用唯一ExitClaim lineage與single active-dispatch slot；winner、working只是同claim轉態，unknown阻擋siblings | `closed`；同一claim在三種representation始終只計一次 |
| `AR-P0-03 invisible external working sells` | P0 | Runtime只看自己的order或單筆probe，可能在外部working sell存在時超賣 | 多筆外部集合完整性是account readiness硬Gate；未證明則automation disabled，並在queue-head write-adjacent再次重驗 | `closed`；設計選擇拒絕能力不完整帳號，不以不完整view估算 |
| `AR-P1-01 residual external TOCTOU hidden` | P1 | 即使最後snapshot合法，外部client仍可在broker write前競爭 | spec／UI必須揭露非原子保證；後續drift立即stop、reconcile、manual且不重送 | `closed`；殘餘風險未被包裝為絕對reduce-only |

## ML：mode shared／exclusive process lock

### 審查結論

- 每次place／update／cancel都必須在broker write緊鄰前同時驗證mode marker與`/api/v1/info.simulation === true`、同一API generation、single-writer fence與固定帳號readiness。
- dispatch在durable `dispatching` commit前取得跨程序shared execution lease，持有到broker identifiers／結果已durable commit為acknowledged／terminal，或durable commit為unknown／reconciling；HTTP response或記憶體ack都不足以釋放。
- mode switch取得exclusive lease、先阻擋新shared lease並等待既有lease全部以durable result結束後才可變更marker／generation。DB commit失敗時sender fail-stop，dispatching blocking state保留。
- unknown marker、`/info` timeout／mismatch、generation change、unmanaged 8080或切換中狀態一律fail closed；回simulation／recovery後仍observe-only並需使用者resume＋arm。

### Finding closure 與再審

| Finding ID | Severity | 初審問題 | 處置／normative contract | 再審結果 |
|---|---|---|---|---|
| `ML-P0-01 mode-switch TOCTOU` | P0 | preflight為simulation但write前切換generation，可能對非simulation endpoint送出 | durable dispatch前取得shared lease並綁generation；exclusive switch先封鎖新lease、等待既有lease完成durable結案 | `closed`；mode marker與`/info`不是彼此分離的瞬時檢查 |
| `ML-P0-02 memory-only ack releases authority` | P0 | broker ack已回但DB尚未fsync就釋放lease，切換或crash可能遺失結果 | lease必須持有到durable acknowledged／terminal或durable unknown／reconciling；fsync失敗sender fail-stop | `closed`；memory-only response不能建立安全終點或允許mode switch |
| `ML-P1-01 unmanaged endpoint or unknown generation` | P1 | 8080非受管、generation不明或timeout時若沿用舊狀態可能送錯模式 | unmanaged／unknown／timeout／mismatch全部使readiness false；watchdog generation change觸發recovery與full reconciliation | `closed`；沒有以listener up或舊attestation降級放行的分支 |

## QG：quote-gap recovery

### 審查結論

- Runtime自行維護即時Tick／BidAsk subscription、refcount、stream epoch與重訂閱；盤中不得以snapshot／ticks／Kbars輪詢冒充即時行情。
- observation必須保存contract、field、trade date、exchange／receive time、stream epoch與品質旗標；跨日、亂序、試撮、零股、非法值或stale不能推進條件。AND另要求同日／同epoch與3秒coherence。
- 沒有經實證的穩定全域event ID時，不宣稱精確sequence-gap detection；disconnect／reconnect、heartbeat、generation、sleep／wake、event-loop pause與clock jump都使dispatch停止並先reconcile。
- crossing gap不能重建時進recovery／manual；trailing在交易時段subscription gap、sleep或event-loop pause後一律manual，historical ticks只供稽核；missed schedule不catch up或burst。

### Finding closure 與再審

| Finding ID | Severity | 初審問題 | 處置／normative contract | 再審結果 |
|---|---|---|---|---|
| `QG-P0-01 reconnect-first-quote false trigger` | P0 | crossing或level策略可能把重連第一筆誤當連續資料而觸發 | gap先停止dispatch並reconcile；crossing不可證明就recovery／manual，level也只依保存且核准的gap policy | `closed`；不存在以第一筆quote推測gap內edge的分支 |
| `QG-P0-02 historical ticks re-arm trailing` | P0 | 不完整historical ticks重建極值可能導致錯誤自動出場 | trailing gap固定manual；historical ticks只可事後稽核，不能重設extreme、解鎖或送單 | `closed`；只有能證明無缺observation的UI disconnect可沿用，且restart仍需re-arm |
| `QG-P1-01 synthetic SSE sequence guarantee` | P1 | upstream未提供穩定event ID卻宣稱精確gap偵測，會形成假安全感 | 明確採connection／heartbeat／generation epoch與full reconciliation，不虛構全域sequence | `closed`；能力聲明與可驗證來源一致 |
| `QG-P1-02 missed schedule catch-up burst` | P1 | 離線slot復原後補送可能錯過市場條件並造成burst | missed slot固定到期、不補送、不跨日；前單working／unknown時下一slot blocked | `closed`；沒有復原後catch-up queue |

## OE：order execution policy

### 審查結論

- trigger field／comparator／price與broker `price_type`／`order_type`／limit price／validity分開保存及確認；trigger命中只建立intent，不能把trigger價暗中當broker委託價或把接受冒充成交。
- 第一階段automation僅在Gate 0核准後允許`LMT+ROD`、`LMT+IOC`、`MKT+IOC`；FOK、MKP、隱藏映射、自動追價與未核准產品保持disabled，且不誤改既有手動支援矩陣。
- place固定完整帳號；update／cancel若upstream只收Trade／trade ID，必須由固定帳號refreshed trades以account、trade date、contract、side、immutable broker IDs與revision唯一解析，並在operation lock內於broker write緊鄰前重驗terminal／remaining quantity／revision。
- dispatch／可能寫出socket後的timeout、response loss或connection error一律unknown／reconciling且不重排、不重送；IOC remainder不自動重送。broker queue保留reconciliation／status與user-confirmed cancel／reduce-only protection的安全容量。

### Finding closure 與再審

| Finding ID | Severity | 初審問題 | 處置／normative contract | 再審結果 |
|---|---|---|---|---|
| `OE-P0-01 trigger price conflated with broker price` | P0 | 觸發門檻若直接成為未揭露委託價，可能產生不符合使用者確認的broker write | trigger與execution policy分離、各自canonical化與確認；LMT另驗方向、tick與漲跌停 | `closed`；trigger true只代表建立intent，不代表接受、成交或特定委託價 |
| `OE-P0-02 timeout or response loss automatic retry` | P0 | broker可能已接受時重送同一write會重複下單 | dispatch後任何不確定結果轉unknown／reconciling，以固定帳號對帳且永不自動retry；IOC remainder同樣不重送 | `closed`；at-most-once dispatch與broker exactly-once聲明已明確分離 |
| `OE-P0-03 stale update/cancel target` | P0 | queue等待期間order被外部fill／cancel／update，舊Trade可能操作錯誤target或quantity | canonical correlation＋broker-order revision，per-account／per-order lock與write-adjacent revalidation；改變即作廢／reconcile | `closed`；若可能已送bytes則unknown，不以舊target再試 |
| `OE-P1-01 unsupported order-class inference` | P1 | 因UI顯示或相似名稱推定FOK／MKP／其他組合，可能送出未驗證payload | automation只接受Gate 0實證組合，其他branch明確disabled；manual matrix另行等價回歸 | `closed`；未證實能力不由實作者猜測 |
| `OE-P1-02 safety work starved by new exposure queue` | P1 | 新曝險塞滿queue可能阻止reconciliation、status或cancel | bounded queue、較保守共同limiter、安全預留容量與優先序；queue-head仍重驗所有authority | `closed`；安全工作不依賴新曝險queue剩餘空間 |

## 跨領域 finding：review 不得成為 write authorization

| Finding ID | Severity | 初審問題 | 處置／normative contract | 再審結果 |
|---|---|---|---|---|
| `XS-P0-01 document sign-off unlocks broker write` | P0 | 若把0.12完成誤當Gate 1或feature pass，可能在route／broker／PnL／行情證據未完成時開啟write master | 明確分離artifact apply-ready、write-unlock-ready與feature release-ready；dispatch仍須manifest valid、Gate 1、feature gate、user master arm、strategy arm、current readiness與provenance-specific conjunct | `closed`；本review不是`passed` gate evidence，不產生任何write authority |

## 目前 integration／Gate blockers

以下項目是本次再審確認仍開放的 integration／Gate blocker。它們不是以文件 sign-off 取代的 finding；每一列都必須讓相關 manifest conjunct、readiness或feature gate維持false。

| 範圍 | 尚未完成的 task／證據責任 | 目前 disposition |
|---|---|---|
| 中央 gateway／provenance | 0.13、3.3、3.7、6.2、12.9：完整route／manual order-class coverage、same-origin injection、可信mutation route、server-derived classifier與偽造／等價回歸 | `open_current_integration`；任何旁路存在時相應帳號automation master=false |
| canonical risk／PnL／identity | 0.14、0.15、6.1、6.3、6.9、8.7、12.10：full-day deal／fee／tax、5秒TTL、account＋identity aggregate、stable principal與key-loss／collision | `open_gate_0_1`；缺component／coverage不得當0或解鎖新增曝險 |
| reservation／claim／外部 working sells | 0.3c、0.7、5.5、6.4–6.8、12.4：多筆外部集合完整性、Share↔CommonLot、durable ledger、queue-head revalidation、OCO fault與position drift | `open_gate_0_1`；受影響帳號automation／protection disabled |
| shared／exclusive mode lock | 0.3a、4.1、4.3–4.6、4.8–4.9、12.3已建立受管shared lease、雙重attestation、generation／watchdog與drain；13.1另完成現行唯一transport writer的durable preflight與exact-request one-shot receipt | `open_gate_0_1`；一般broker adapter仍缺0.3b Gate contract issuer且strategy write authority不可用 |
| quote／calendar／resource continuity | 0.5、0.8、0.16、5.4–5.12、12.5、13.5與13.4明列的後續市場E2E證據：field mapping、trade subscription、SSE／sleep gap、calendar／time、global ownership與有界quote→simulation E2E | `open_gate_0_3`；13.4離線domain／adapter acceptance已完成，但未證實欄位／類型／subscription demand與尚無市場E2E的七種feature仍維持disabled |
| broker execution contract | 0.3b、0.4、0.6、2.7、5.1–5.3、7.8、12.1、13.2–13.3：explicit account、update／cancel target、correlation、order/deal狀態、核准order combos與故障注入 | `open_gate_0_2`；不得送一般broker write或宣稱保護已解鎖 |
| machine-readable gating | 0.3–0.9、0.13–0.17與13.2–13.3仍有未完成項：current build／adapter／Shioaji／platform fingerprints、result hashes與broker contract；13.1只完成forward prewrite enforcement。13.4的七種離線acceptance已由source hash與巢狀verifier綁定，但不包含市場E2E或write unlock | `open_gate_manifest`；七種feature gate固定disabled；fixture、review文字、環境變數或UI值不能補足任何conjunct |

## Write-master 不可開啟的機械結論

本紀錄再審後固定以下結論：

1. task 0.12 的文件層 P0／P1 closure只允許後續依artifact實作與驗證；它不把change提升為write-unlock-ready。
2. 任一 integration／Gate blocker仍開放時，對應`automation` gate manifest conjunct與current readiness MUST為false；review檔案存在、版本號或SHA格式正確都不能改變此結果。
3. `manual_user_confirmed`仍需完成manual route coverage、短效一次性confirmation及共同simulation／account／risk／unit／reservation gates；不能以本review省略。
4. `gate_probe`仍需獨立CLI、逐operation授權、一次性nonce、同run target lineage、shared mode lease與雙重simulation attestation；本review沒有授權任何probe write。
5. production、CA與真實下單完全不在本change授權範圍；即使未來所有simulation gates通過，也不能由本review推導production authority。

## 機械驗證

| 檢查 | 必要結果 |
|---|---|
| `shasum -a 256` 綁定五份OpenSpec輸入 | 必須與「綁定輸入與內容雜湊」逐項一致 |
| `openspec validate add-durable-smart-order-panel-and-protective-exits --strict` | 通過 |
| `git diff --check -- openspec/changes/add-durable-smart-order-panel-and-protective-exits/reviews/safety-design-review.md` | 通過 |

上述檢查只驗證文件結構、內容綁定與格式；不驗證Runtime implementation、broker／quote contract、Gate 0／1或simulation E2E，且不得被gate runner誤分類為live evidence。

## Sign-off conclusion

對綁定的`smart-order-safety-design-baseline/2026-08-12.1`，六個review lens確認：中央trading-write gateway與server-derived provenance、Runtime canonical risk／PnL與kill-switch deny-union、account-wide EntryExposureReservation／ExitClaim lineage、shared／exclusive mode lease與durable result、quote gap的保守恢復政策，以及trigger／broker execution policy分離，在文件模型內具有明確authority、線性化點、失敗處置與禁止路徑；所有本次文件層P0／P1 finding均已關閉，予以正式sign-off。

本sign-off不關閉任何上列integration／Gate blocker。只有相應route coverage、受管Runtime／broker／行情證據、Gate 0／1、manifest、current arm／readiness與feature Gate 2／3全部通過，且依規格重新取得必要使用者確認後，才可能由dispatch path逐筆授予下一層broker write判斷；在此之前策略write master MUST無法開啟。
