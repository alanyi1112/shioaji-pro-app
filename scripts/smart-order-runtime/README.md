# 智慧下單本機 sidecar Runtime

目前 sidecar 是 `simulation-only` 的 observe-only 基礎設施，目的在驗證本機私有儲存、SQLite durability、loopback control plane 與生命週期邊界。它不含券商 adapter 寫入權限，`dispatchAllowed` 與 `smart_order_write_master` 固定為 `false`，也不代表 LaunchAgent 重啟後會自動恢復任何保護。

## 啟動與 Node 契約

- 平台範圍只套用智慧下單交易Runtime：第一階段正式支援原生、非VM的Apple Silicon `arm64` macOS實機。Intel／`x64`、Rosetta、VM、Windows與Linux會在installer、sidecar entry與Gate verifier明確fail closed，不安裝／啟動sender，也不取得broker authority。RealTimeStock一般前端與桌面主程式的既有平台支援不變；未來Intel交易Runtime另立OpenSpec change。
- `scripts/realtimestock-runtime install` 只接受 Node.js LTS `>=24.15.0 <25`，解析實際執行檔後把絕對路徑以 `0600` 保存於 `REALTIME_STOCK_APP_SUPPORT/node-runtime-path`。
- sidecar LaunchAgent 不從 `PATH` 猜 Node；它只執行上述 persisted absolute path，process entry 會再次核對原生Apple Silicon `arm64`／非hypervisor平台、版本、LTS、realpath、私有 `simulation` mode marker 與同代 `simulation:*` API generation。
- sidecar 只綁 `127.0.0.1` 的隨機 port。discovery、gateway capability、identity key、SQLite 與 backup 都位於 repo 外的 current-user 私有目錄。
- `REALTIME_STOCK_APP_SUPPORT` 會同時傳給 5173 Web service 與 sidecar，讓 same-origin gateway 和 sidecar 使用相同的私有控制面根目錄。

## Mode 切換

- `simulation` 先停止舊 sidecar、建立新的私有 API generation、啟動並驗證 simulation API 與 5173，再啟動 write-disabled sidecar。
- `production-readonly` 必須先確認 sidecar job 已停止且私有 discovery 已清除，之後才可停止 simulation API 或啟動 production-readonly API。無法確認時整次切換 fail closed。
- watchdog 仍只管理既有 simulation business session；每一次 API process incarnation（包含 KeepAlive、watchdog kickstart與手動service restart）都會在listener啟動前旋轉私有 API generation。sidecar每秒重讀私有marker；generation改變、marker不可讀或離開simulation時，先在仍持有exclusive sender lease下latch＋durable invalidate，將monitoring／observing策略降為recovery、撤銷舊re-arm、使dispatching intent轉reconciling／unknown、撤下舊control plane，最後才釋放lease並退出，由新process以reconciling／observe-only重啟。現階段sidecar沒有broker write authority，任何recovery都不會自行re-arm策略；status固定顯示reconciliation required。

## Status 與 uninstall

`status` 只顯示 allowlist 的去識別化摘要：job、loopback discovery、observe-only readiness、generation 是否存在、私有 repository 是否存在、reconciliation、obligation count 是否未知，以及 write master disabled。它不輸出 port、capability、帳號、策略內容或任何秘密值。

`production-readonly`、mode switch、stop 與 `uninstall` 都必須先透過私有control plane完成durable lifecycle audit／quiesce。任何non-terminal strategy、side-effect intent、BrokerOrder、commitment、obligation、reservation、claim、ResolutionCase、SafetyBlocker或缺少當epoch full reconciliation都會在停止服務或刪除檔案前 fail closed。只有authenticated durable audit證明該operation的blocker count為0，才可移除LaunchAgent與未使用的gateway capability；DB、WAL、backup、strategy、identity key與audit預設保留。一般既有持股本身不算智慧單義務，但未完成reconciliation時仍不得把它推定為安全。

## 產品邊界與七種類型

這套功能的產品定位固定為「RealTimeStock 本機智慧下單」：Mac sidecar 可在 5173 頁面關閉後繼續執行已核准的本機監控，但 Mac 關機、睡眠、斷網、Shioaji session 中斷或 sidecar 停止時不會監控。它不是大戶投的券商雲端智慧單，也不能作為實盤唯一保護。

七種類型採「官方可確認核心＋RealTimeStock 本地安全縮限」：

| 類型 | 可確認核心 | 本地安全縮限／目前 release 狀態 |
| --- | --- | --- |
| 快速單 | 單一商品依行情條件觸發委託 | 九個欄位逐項 Gate；預設 `require_rearm`；目前 disabled |
| 長效單 | 1–30 日監控、每日最多觸發一次、按實際成交累計 | 前日 working／unknown 未對帳前不進下一日；目前 disabled |
| 多條件單 | 最多七條、AND／OR，可有多個監控商品 | AND 同交易日／epoch且 3 秒 coherence，任一 stale 整體不成立；目前 disabled |
| 母子單 | 母單全成才啟動子單 | 每一 leg 的監控商品必須等於該 leg 委託商品；子單只限母單全成當日；目前 disabled |
| 停損停利單 | 現股多單的固定停損／停利 | 必須使用 broker-confirmed position、ExitClaim 與 OCO remainder；目前 disabled |
| 移動出場單 | 啟動門檻、有利最高價、回撤與固定停損 | 交易時段行情 gap 一律人工處理，historical ticks 不解鎖；目前 disabled，也是全新草稿選擇器預設類型 |
| 定時定量單 | 單一商品、定時或定量、僅當日 | slot／split／尾數／收盤算法尚未取得足夠證據，兩種 mode 均 disabled |

逐欄位、比較子、有效期、母子 leg 拓樸與定時／定量未證實分支的版本化表格，以 change 內的
[`official-smart-order-decision-tables.md`](../../openspec/changes/add-durable-smart-order-panel-and-protective-exits/official-smart-order-decision-tables.md)
為準；來源、版本衝突與本地決策分層則記錄於
[`evidence.md`](../../openspec/changes/add-durable-smart-order-panel-and-protective-exits/evidence.md)。未列為已證實的格子不是「沿用猜測預設」，而是機械性 `disabled`。

官方來源對「設定後是否可修改」與零股範圍有版本差異；RealTimeStock 不冒充券商 feature parity。任何已確認建立的 non-draft strategy（包含 paused、recovery、manual、cancel-pending、expired-with-obligation）交易欄位一律不可原地修改，只能執行 allowlisted pause／resume／cancel、另行取消 broker order，或複製成新 draft 後重新確認。

RealTimeStock 採獨立、較保守的「同一已驗證身分跨固定股票帳號 20 筆」本機上限；paused、recovery、manual、cancel-pending、expired-with-obligation與未終結 broker／obligation／reservation仍計入。大戶投公開的同一 ID 跨帳號「台股＋期權 20 筆」是另一個券商雲端額度，本機不讀取、不占用、不同步，也不能用它判定本機 readiness。

## 狀態、數量與保護義務

交易流程不得折疊成一個「成功」狀態：

1. `Strategy` 保存不可變 definition 與使用者確認。
2. `Activation` 表示一次條件 edge 或 schedule slot 命中。
3. `OrderIntent` 表示本機準備中的 place／update／cancel side effect。
4. `BrokerOrder` 只按 broker 證據區分 pending、accepted、working、part-filled、filled、cancelled、inactive、failed、unknown。
5. `PendingProtectionCommitment` 在送進場前保存待建立的保護承諾；實際成交後才依 final fill materialize `ProtectionObligation`。
6. `EntryExposureReservation`、`ExitClaim` 與 `ExternalSellClaim` 分別表示最壞進場曝險、Runtime 出場權利與外部 working sell；不同 representation 不得重複計量。

條件成立不等於委託已送出，broker accepted 不等於成交，部分成交不等於策略已完成。只有 broker side effect 與所有本機義務都 terminal，才可進入歷程；歷程依 Asia/Taipei calendar-year 規則至少保存一年。通知只用來提醒，不是 broker 證據。

價格以 decimal string／integer tick 計算，數量持久化為帶單位的 base `Share`；只有受驗證 adapter 邊界能做 `CommonLot` 轉換。百分比使用 integer bps，ATR 使用固定的 Wilder snapshot；trigger 門檻與 broker 委託價／價別／效期分開保存及確認。固定停損向上、停利／activation 向下依合法 tick 作保守 rounding；trailing 使用已確認 normal-lot last trade 更新有利 extreme，回撤門檻與實際出場委託價仍是兩個欄位。`RuntimeTrackedUnprotectedRemainder` 只可依已確認成交、已確認退出與仍有效的 distinct ExitClaim projection計算；任何 claim unknown 時結果也必須是 unknown，不能當 0。

`pnpm probe:smart-order-task0-7-unit`是獨立的managed simulation唯讀能力驗證，不會訂閱事件、變更服務或呼叫任何broker write endpoint。它持有shared mode lease並前後驗證managed process、simulation marker、API generation、`/api/v1/info`與current OpenAPI；固定帳號只存在記憶體，report不保存帳號識別資料。positions請求固定`unit=Share`，即使目前沒有持股列，也必須由current OpenAPI同時證明`Unit` enum含`Share`且stock position的`quantity／yd_quantity`為integer；Common order必須在前後account-scoped trades讀取中一致，並用同一份股票canonical contract `unit`精確換算。`2330`股票與`0050` ETF contract則各前後讀取並驗證`category／reference／limit_up／limit_down／unit／update_date`完整且未過期。任一source、process、generation、position、Common order或contract漂移，或沒有current Common order evidence，整份report fail closed；fixture、舊schema、stale／重放、result hash／source matrix不符及任何broker write計數非0都不具Task 0.7資格。

同一 protection group 只能有一個 OCO winner 與一個 active dispatch slot。sibling 在任何 broker bytes 前抑制；partial fill 只消耗相同 claim lineage 的 remainder，不能再建立第二份 coverage。winner commit、cancel/fill race 或結果未知時不得猜測勝負，必須保留 blocker 並轉人工處理。

pause 只停止未來 activation，不自動取消 working broker order。resume 必須重新驗證 current definition／confirmation、mode、risk、quote 與 gate，不是把 paused row 直接改回監控。取消本機策略與取消 broker order 是兩個不同操作；無法唯一確認 broker final result 時必須進 `manual_intervention`，原 intent 不得自動重送。每個人工 reason 只能使用版本化 resolution matrix 所列證據與操作；break-glass 需要兩次獨立確認，並保留 relinquished exposure blocker 與人工接手 audit。本機通知只提醒使用者查看，不可讓任何狀態前進。

## SQLite、backup 與 retention

- repository 使用 Node `node:sqlite` 的 dedicated worker、single writer、OS lock與 DB fence；`foreign_keys=ON`、WAL、`synchronous=FULL`、busy timeout與 defensive mode固定啟用。
- Application Support 根目錄、`smart-order` 私有目錄、DB／WAL／SHM／backup、gateway capability與 identity key都必須由目前使用者擁有；目錄 `0700`、秘密與資料檔 `0600`，symlink／錯誤 owner／群組可讀一律拒絕。
- 已初始化安裝另有 repository expectation marker。marker存在但 DB 遺失時不得自動建立空資料庫；migration、integrity、permission、read-only、disk-full或 backup驗證失敗時 write readiness fail closed。
- backup 使用一致性 SQLite snapshot，restore 必須比對 schema、hash、row count、`integrity_check`與 `foreign_key_check`。一般 uninstall 不刪 DB、WAL、backup、identity key或 audit。
- retention 以較晚的 terminal／released／最後關聯證據時間加一個 Asia/Taipei calendar year計算，不用固定365日。non-terminal、working、unknown、obligation、reservation與未終結 claim永不因年限刪除。
- migration 只允許受版本控制的向前步驟，整批 transaction 成功後才更新 `user_version`；任何 partial／unknown schema、foreign-key conflict 或 migration fault 都回到最後 durable 版本並保持 write readiness false。程式降版／rollback 只可讀取相容資料；不得自動降 schema、建立空 DB、刪除新欄位或把 unresolved side effect 當成已清空。
- stop／rollback／uninstall 的 drain 條件涵蓋 non-terminal Strategy、side-effect intent、BrokerOrder、PendingProtectionCommitment、ProtectionObligation、EntryExposureReservation、ExitClaim 與 SafetyBlocker。一般持股不等於本機義務；但只要上述集合無法證明為零，就不得移除監控資料或宣稱安全停止。

目前 fault suite 已涵蓋 migration rollback、read-only、permission、corruption、backup/restore與 bounded journal。`pnpm probe:smart-order-node-sqlite` 唯一會走 `scripts/realtimestock-runtime node-sqlite-probe`：wrapper先驗真實repo外private App Support、persisted Node 24 LTS絕對路徑與實際sidecar LaunchAgent，再由parent固定current source fingerprints、spawn fresh child並於完成後重算；child只在private暫存目錄做SQLite fault probe，不連Shioaji、不啟停服務且不做broker write。它以production repository worker、backup/restore verifier與sidecar startup contract驗證WAL、`synchronous=FULL`、defensive mode、SIGKILL crash durability、worker event-loop隔離、latency watchdog fail-closed及實際persisted Node／LaunchAgent鏈。installed runtime與plist都以`O_NOFOLLOW`開啟並做讀取前後inode／size／mtime驗證；installed runtime bytes必須與current repo runtime SHA完全相同，plist則只由已固定的bytes經stdin解析，拒絕stale copy與path swap。

原生Apple Silicon實機第一次probe會在新版private evidence store `node-sqlite-capability-arm64-v2`建立專用Ed25519 attestation key並保存current signed `arm64.report.json`；`node-sqlite-host-public`只輸出可enroll的公開record。操作者以`node-sqlite-trust-host <arm-public-json> <arm-report-json>`明確建立單host trust manifest，將current report的`runId + resultHash`綁定到該arm64 host key。每次enrollment都在exclusive私有lock下遞增generation；generation、canonical trust-manifest SHA、單一host key ID、綁定report lineage與包含platform policy的current source matrix共同形成authority digest。

production Gate runner只從current-user、`0700`、no-symlink新版evidence store讀取exact一份`0600` arm64 report，重算current authority、驗證trusted signature、current source fingerprints、Node／SQLite版本與完整check matrix，才簽發`node_sqlite_capability`；manifest產生後會再重驗一次，repository dispatch projection也會以production `appSupportRoot`重算authority digest。trust rotation、source drift、report替換或`runId + resultHash`不符立即轉observe-only。Intel／`x64`、Rosetta、hypervisor、Windows、Linux、Node 25+、舊雙架構schema、untrusted self-sign、自改／偽造report、重放report、fixture或direct worker entry一律無效。Intel交易Runtime不屬於本change驗收矩陣，未來另案且必須重做當時current schema與原生Intel實機證據。

## Same-origin gateway 與 write provenance

瀏覽器只可呼叫 5173 的 `/__smart-orders/*`。gateway 由 repo 外私有檔讀取 capability，對 sidecar request 注入 HMAC proof；mutation body使用加密 envelope，sidecar response也必須以 request ID、Runtime epoch、status、content type與 body hash回簽。瀏覽器、URL、status、log、SQLite與 response都不能取得 capability或 identity key。

控制面必須同時驗證 loopback socket、exact Host、Origin／same-origin Referer、Fetch Metadata、method、content type、body/query上限、route-specific schema、request ID、revision、replay與 response proof。Cloudflare、remote tunnel、forwarded headers、wildcard CORS、simple-form mutation、GET side effect、packaged direct API與 stale discovery port一律拒絕；packaged desktop 尚未證明等價 gateway 前維持 fail closed。

endpoint matrix 分為 mutation、read、SSE 與最小 health 四類：mutation 才能使用一次性 CSRF／request replay，read 不得有 side effect，SSE 必須有 authenticated bounded cursor／gap語意，health 不得輸出帳號、port、epoch、generation、路徑或秘密。若任一類尚未完成 hostile test，該 endpoint 保持未接線，而不是放寬到 generic proxy。

gateway capability 與 identity HMAC key 是兩把不同的 repo 外 `0600` 金鑰：前者每次 simulation Runtime generation／安裝生命週期旋轉，後者只在明確 identity-key rotation 流程更換。遺失、owner／mode錯誤、symlink、mapping conflict 或 rotation 中斷都使相關身份與 write readiness fail closed；舊 key／舊 capability 不得回復為 current。

`BrokerWriteProvenance` 只能由可信 server route與 caller lineage衍生：

- `manual_user_confirmed`：互動式 UI 的短效、一次性、payload-bound確認；不要求 strategy arm，但仍要求 simulation、fixed account、canonical risk／unit／reservation。
- `automation`：綁 strategy、activation、intent、current gate manifest、feature flag、user write master、arm與全部 readiness。
- `gate_probe`：只供獨立 CLI、逐 operation 授權、同 run target與最多 1 CommonLot simulation probe。

browser payload 宣告任何 provenance都無效；scheduler 命中 manual endpoint、一般 UI 命中 automation route、probe跨 run操作 target都必須在任何 broker bytes 前拒絕。只要仍有 OrderTicket、Flash、Grid、trigger或其他直接 8080 broker write旁路，對應帳號 automation eligibility就必須是 disabled。

machine-readable gate manifest 必須綁 current build、schema／adapter、Node／SQLite／OS、simulation capability、route coverage、PnL policy、產品邊界同意、證據 class／source digest／result hash及逐類 feature gate。verifier 必須重算 eligibility，不接受環境變數、UI toggle或 report 自稱的布林值。probe 只能使用獨立 CLI、一次性 nonce、同 run 建立且唯一 correlation 的 target；不得由策略引擎重用或清理別人的委託。

`pnpm probe:smart-order-gate -- <absolute-private-envelope-json>`只會透過managed sidecar的獨立private control plane準備一筆probe-only safety envelope，不執行broker write。輸入檔必須是目前使用者持有的`0600`非symlink絕對路徑；CLI在互動式TTY顯示operation語意、完整帳號的遮罩摘要、1 CommonLot上限、Runtime epoch與API generation摘要，並要求綁定該次operation的確認句。prompt前後的private discovery與獨立capability必須完全相同；server仍會重驗一次性HMAC、current generation／epoch、shared mode lease、前後simulation attestation及CA／production未載入。任何response loss只會留下durable unknown latch，禁止自動重送或盲目cleanup。實際place／update／cancel transport仍由Task 0.3b機械封鎖。

每次 broker mutation 的唯一線性化順序是：取得 shared mode execution lease → 核對 private mode marker 與 `/api/v1/info.simulation=true` → 核對同一 API generation／sender fence → durable `dispatching` commit → 才允許 adapter 寫出第一個 byte。lease 必須持有到 broker identifiers／結果 durable acknowledged、terminal或 unknown／reconciling commit；mode switch 使用 exclusive lease，不能穿越仍在 dispatch 的 side effect。

三種 kill switch（identity、account、emergency）採 deny-union：任一 switch 禁止的動作不能被另一個 switch 重新允許。switch revision 與 dispatch 共用 arbiter 線性化點；已越過 broker-write 點的請求只能進 confirmed／unknown＋reconcile，不可宣稱被緊急開關撤回。break-glass 是 reason-specific 人工接手管道，不是第四種解除 write gate 的方式。

## 三種完成層級

- **artifact apply-ready**：規格、domain、資料模型與 fail-closed邊界足以繼續實作及執行 Gate 0；不代表可送出任何 broker bytes。
- **write-unlock-ready**：Gate 0/1、current machine-readable manifest、simulation雙重attestation、固定帳號、PnL／risk／resource／reconciliation、current confirmation／arm／readiness與 user write master全部同時成立；只能解鎖manifest明列且已核准的 simulation route。
- **feature release-ready**：該智慧單類型的Gate 2或Gate 3、正常、失敗、重啟、斷線、時間、partial／unknown與UI驗收全通過，且使用者再次確認本機產品邊界；一種類型通過不得替另一種類型解鎖。

目前只在第一層持續實作；Task 0.3a只完成probe safety envelope的production準備路徑，實際Gate 0 broker probe、策略 write master、broker adapter與七種類型feature flag均未解鎖。環境變數、UI toggle或單一測試成功不能提升層級，也不能載入 CA、切換 production或送出真實委託。未經使用者明確授權，也不得以任何完成層級推論可以archive OpenSpec change、commit或push。
