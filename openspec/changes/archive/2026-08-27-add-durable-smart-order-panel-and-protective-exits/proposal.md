## Why

現有下單面板的 bracket 與條件觸發由瀏覽器記憶體、`localStorage` 及 5173 的行情連線執行；頁面關閉、重新整理、睡眠喚醒、帳號切換或 SSE 斷線時，可能停止監控、遺失保護狀態，甚至在無法確認 broker 結果時重複送單。既有風控也以瀏覽器 `localStorage` 與記憶體為權威，無法在頁面關閉後保護常駐 Runtime。

永豐金大戶投官方智慧單是券商雲端洗價，APP不必保持開啟；本次查核的Shioaji公開文件則只提供由客戶端訂閱行情、觸發後呼叫`place_order`的做法，未提供可建立券商代管智慧單的公開介面。因此RealTimeStock在目前可驗證能力下只能建立「本機智慧下單」，不能以sidecar冒充券商雲端服務。這個產品邊界、交易安全閘門、帳號／數量單位、未知結果與斷線復原必須先寫成可測契約，才可開始任何自動送單實作。

## What Changes

- 新增 simulation-only 的本機智慧單 Runtime；5173 關閉後仍由本機電腦監控，但電腦關機、睡眠、網路或 Shioaji session 中斷時不具備券商雲端 SLA。UI 永久顯示「本機監控・非券商雲端」、Runtime heartbeat、行情新鮮度與可送單狀態。
- 所有 RealTimeStock 對可啟用自動化之股票帳號的交易寫入改經同一個本機 trading-write gateway／arbiter；由可信server boundary衍生且不可由browser偽造的`manual_user_confirmed`、`automation`、`gate_probe` provenance分別套用安全閘門。先盤點並回歸既有手動委託矩陣，不能把自動功能的 `Cash/Common` 縮限誤套到手動 FOK、零股或當沖，也不能保留直送 8080 的旁路。任一路徑尚未納管時，該帳號的自動化 write master 必須維持關閉。
- 將 simulation mode、權威風控、kill switch、帳號綁定、商品契約、canonical PnL與曝險／出場claim移入常駐 Runtime；PnL必須涵蓋本交易日Runtime啟動前及外部client的完整成交／費稅，可預留風控維度必須在送出前原子保留worst-case新增曝險，出場以單一ExitClaim lineage避免重複扣量。未知、過期、不一致或無法證明 reduce-only 時一律 fail closed。
- 採本機 SQLite 儲存策略、activation、送單意圖、broker 對應、reservation 與事件歷程；只承諾「同一已確認 activation 不重複自動 dispatch」，不宣稱 broker exactly-once。broker 已受理但回應遺失時，無法唯一對帳即進入 `manual_intervention`，不得自動重送。
- 含保護出場的進場單改為「先由 Runtime 原子保存進場意圖＋保護計畫，再由 Runtime 送出進場」。Runtime 無法完成保存或 readiness 不完整時，整筆新單必須阻擋，不得留下先成交、後補保護的空窗。
- 下單面板將 `LMT`、`MKT` 顯示為「限價單」、「市價單」，並加入固定價位、百分比、ATR 與移動出場；觸發價與 broker 委託價／價別／效期分開設定及確認。
- 新增可加入工作區的「智慧下單」面板，列出快速單、長效單、多條件單、母子單、停損停利單、移動出場及定時定量；每一類都有獨立feature gate，未證實欄位或算法維持disabled。所有已確認建立的策略採不可變快照、明確狀態與一份可稽核歷程。
- 校正官方可確認的核心語意：一般監控期間為1至30日；快速單監控商品等於委託商品；長效與多條件可使用不同監控／委託商品；母子單每一leg的監控商品等於該leg的委託商品、母單全成才啟動子單且子單只限當日；定時定量只限當日；長效單每日最多觸發一次並以累計實際成交量計算；歷史保存一年。定時／定量的精確slot、split、尾數與收盤算法尚無公開證據，兩種mode先disabled。官方修改語意存在「只能刪除」與「可修改」的來源衝突，本 change 不冒充feature parity而獨立採non-draft不可原地修改。官方另以同一ID跨帳號「台股＋期權」合計20筆為券商雲端額度，刪除／完成不計；本次查核的Shioaji公開文件／介面未提供讀取或占用該額度的能力。
- RealTimeStock 另採同樣數值但不同資源的本機保守上限：同一 authenticated identity group 跨本 change 支援的股票帳號，最多 20 筆本機未終結策略／義務；其計數狀態比官方公開文案更保守，UI 不得把兩套上限混為一談。
- 第一階段只允許 TSE／OTC、`STK`、`Cash`、`Common` 的股票與 ETF 整股 simulation 委託；自動賣出只支援可驗證的現股多單 reduce-only。零股、權證、指數、興櫃／特殊板、融資融券、當沖先賣、借券、期貨、選擇權、複委託及跨市場全部拒絕。
- 引入 observe-only／shadow mode 與獨立的 simulation 自動送單總開關。安裝、migration、mode 切換或 reconciliation 後預設不自動恢復送單，必須由使用者在最新確認快照上重新啟用。
- 第一階段智慧下單 sidecar／Node `node:sqlite` 交易 Runtime 的正式支援平台縮限為原生 Apple Silicon `arm64` macOS實機；Intel Mac／`x64`、Rosetta、VM、Windows與Linux不得安裝或啟動sender，也不得取得broker authority。RealTimeStock一般前端與桌面主程式原有平台支援不變；未來Intel交易Runtime須另立OpenSpec change並取得原生Intel實機證據，不得沿用本change的arm64證據。
- 實作前新增硬性能力驗證：Shioaji 帳號綁定、外部 working-sell集合完整性、含trade date的order/deal correlation、trade subscription、account-scoped且revision-safe的update/cancel resolution、行情欄位與時間、委託組合、current-trade-date full PnL、全登入 subscription budget、Node／SQLite crash durability、安全 gateway threat model。Gate runner 必須產生不可由 browser 或單一環境變數繞過的 machine-readable gate manifest；任一 P0 gate 未通過時不得解鎖 simulation 寫入。
- 後續Gate 0／保護出場simulation probe不得沿用Task 0.3固定`115`或直接猜測市價。每次operation必須先在唯讀preflight取得current contract、合法tick、BBO、可信交易日期／時間、固定simulation帳號positions／working orders與current generation／source fingerprint，再依該task目的產生短效exact envelope；資料缺漏、過期、漂移、穿價、超出漲跌停或tick非法一律fail closed。Task 0.3既有sender、request hash、source fingerprint、完成證據與durable unknown邊界保持不可變且不可重用。

## Capabilities

### New Capabilities

- `durable-smart-order-runtime`: 定義本機 Runtime、single-writer、same-origin 安全 gateway、帳號綁定、權威 mode／風控、持久化狀態、at-most-once 自動 dispatch、broker reconciliation、行情新鮮度、部位 reservation、資源上限、稽核與復原。
- `protective-exit-order-ticket`: 定義中文價別、先保存保護後送進場、固定／百分比／ATR／移動出場、實際成交基準、合法檔位、委託執行政策、部分成交與 OCO remainder。
- `smart-order-panel`: 定義「智慧下單」工作區面板、永久本機標示、官方可確認的七種類型核心流程、本地安全縮限、不可變確認快照、有效期、上限、管理與歷程。

### Modified Capabilities

- `safe-local-runtime-mode-switch`: 納入 smart-order Runtime 與 trading-write gateway 的 install、status、simulation、`production-readonly`、watchdog、rollback 與 uninstall 生命週期；每次交易寫入都須雙重證明 simulation，且切換模式前必須安全停送、對帳與處理未終結義務。

## Scope and Safety Boundary

- 本 change 只規劃與驗收 Shioaji simulation，不授權 production、CA、正式帳號自動交易或真實委託。
- 面板名稱可使用「智慧下單」，但產品與文件 MUST 稱為「本機智慧下單」，定位為 simulation 與客製化輔助工具，不得以「雲端智慧單」「關機仍監控」或「等同大戶投」宣傳，也不得描述為無人監督實盤的唯一保護。
- 官方大戶投文件只用來核對策略語意；RealTimeStock 不複製其商標、視覺、文案或未公開能力。
- 本次查核的Shioaji公開order介面未提供broker idempotency key；規格不承諾委託必成交、價格保證或絕對exactly-once。
- 本機20筆上限以`COUNT(DISTINCT strategy_id)`計RealTimeStock自己保存的股票策略與未終結義務，且採比官方公開狀態更保守的計數；本次查核的Shioaji公開文件／介面未提供查詢或占用大戶投同一ID跨帳號「台股＋期權」券商雲端額度的能力，UI與文件不得宣稱兩者共用或同步。
- Gateway 只能約束 RealTimeStock 自己控制的 writes；外部 App、另一 client 或電話委託可在最後一次對帳後競爭部位，因此「本地驗證 reduce-only」不是券商原子的 reduce-only 保證，仍須揭露 TOCTOU 殘餘風險。
- 外部 App、另一個 Shioaji client 或券商人工操作仍可能改變部位。Runtime 必須偵測並 reconciliation，但不能宣稱能封鎖外部交易。
- 第一階段不提供自動重試未成交 IOC、不追價、不在斷線期間補送錯過的排程，也不從不完整歷史推測跨 gap 的 crossing 或 trailing 極值。

## Impact

- 前端：`src/components/order-ticket.tsx`、所有交易寫入入口、工作區 block registry、智慧單設定／監控元件、帳號與即時狀態 hooks。
- Runtime：`scripts/realtimestock-runtime`、LaunchAgent、mode marker、watchdog、Node sidecar、same-origin gateway、SQLite repository 與本機通知。
- 平台：本change的交易Runtime只支援原生Apple Silicon `arm64` macOS；installer、sidecar entry、Gate verifier與host attestation共同fail closed。此限制不套用到RealTimeStock一般前端／桌面主程式。
- 交易整合：建立 Node-safe 且強制顯式帳號的 Shioaji adapter；補齊 order/deal event 的帳號、`custom_field`、exchange sequence 與 broker order 狀態正規化。
- 風控：瀏覽器不再是智慧單權威；Runtime 保存版本化 canonical PnL／風控、採deny-union與共同線性化點的三種分級控制 `pause_new_exposure`、`pause_automation`、`emergency_block_all_writes`，以及 protection obligation、EntryExposureReservation與ExitClaim lineage。
- 資料：以 decimal string／整數 tick／明確 `Share`、`CommonLot` 單位持久化；禁止用 binary floating-point 或隱含張股轉換作為交易權威。張股權威必須由current managed simulation唯讀證據綁定position OpenAPI／`unit=Share`、current Common order及股票／ETF canonical contract完整欄位，fixture、舊schema或只接受空回應不得單獨完成Gate。
- 相容性：既有 browser trigger 只做唯讀偵測與人工重建；純 alert 功能不得因停用舊交易 trigger 而消失；新舊交易引擎不得同時成為送單 authority。
- 驗證：domain／adapter deterministic tests、故障注入、simulation contract smoke 與有界市場時段 E2E 分層執行；任何驗收證據不得包含秘密或完整帳號。

## Release Gates

1. **Gate 0 — 產品與 API 能力確認**：使用者確認接受「本機監控、非券商雲端」；獨立且每次人工授權的 probe-only safety envelope 證實帳號、外部 working orders、`custom_field`、order/deal、trade subscription、update/cancel resolution、委託組合、數量單位與 PnL 來源，並產生綁定 build、adapter、Shioaji、平台及證據 hash 的 gate manifest。Gate 0 只允許受控 probe，不會開啟策略 write master。
2. **Gate 1 — Runtime 安全核心**：安全 gateway、simulation 雙重 attestation、canonical risk、SQLite、single-writer、outbox、reconciliation、reservation 與 fault tests 完成；仍維持 observe-only。
3. **Gate 2 — 保護出場**：先保存後進場、部分成交、OCO remainder、position drift 與未成交狀態通過 deterministic 與 simulation 驗收後，才可獨立解鎖。
4. **Gate 3 — 七種智慧單**：每種類型使用獨立 feature flag；只有該類型所有正常、失敗、重啟、斷線與時間情境通過後才能啟用，不以其他類型的成功代替。

## Breaking Changes

- 所有受支援帳號的 RealTimeStock 交易寫入都必須經過同一 gateway；舊的 browser-only 送單捷徑與 `bypassRisk` 不再適用於智慧單。
- 已啟用策略不可原地修改；使用者只能暫停、繼續、取消或複製為新草稿，修改任何交易欄位都產生新策略 ID 與新確認。
- production-readonly遇到任何non-terminal side-effect intent、non-terminal BrokerOrder、reservation／claim或未終結`ProtectionObligation`時預設拒絕；單純paused／quiesced且無交易義務的strategy可留在唯讀DB。stop、停用功能、rollback或uninstall則仍在任何non-terminal strategy或上述義務存在時預設拒絕。一般既有持股若從未建立 Runtime 保護義務，不會單獨阻擋生命週期操作。
