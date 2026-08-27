# safe-local-runtime-mode-switch Specification

## Purpose
TBD - created by archiving change add-safe-local-runtime-mode-switch. Update Purpose after archive.
## Requirements
### Requirement: 登入後預設啟動 simulation 本機服務
系統 MUST 以 macOS 使用者層級服務在登入後啟動 Shioaji simulation API 與本機 Web，且 MUST 將服務限制於 loopback 位址。

#### Scenario: 使用者登入 macOS
- **WHEN** 已安裝本機 runtime 且使用者登入 macOS
- **THEN** 系統自動啟動 simulation API 與 Web，`/api/v1/info` 回報 `simulation: true`

#### Scenario: 常駐程序異常退出
- **WHEN** simulation API 或 Web 常駐程序非預期退出
- **THEN** `launchd` 重新啟動失敗的服務，不切換到 production

### Requirement: production-readonly 必須手動且暫時啟用
系統 MUST 僅在使用者明確執行模式切換命令時啟用 production-readonly，且重新登入或重開機後 MUST 回到自動啟動 simulation 的設定。

#### Scenario: 手動切換正式行情唯讀
- **WHEN** 使用者執行 `production-readonly` 切換且前置檢查通過
- **THEN** 系統停止 simulation API、啟動唯一的 production API job，並保持 Web URL 不變

#### Scenario: 重新登入或重開機
- **WHEN** 上一個工作階段曾使用 production-readonly 後重新登入或重開機
- **THEN** production job 不會自動載入，simulation API 依預設 LaunchAgent 啟動

### Requirement: 模式切換必須互斥且可回復
系統 MUST 保證 simulation 與 production API job 不會同時占用 8080，並提供可重複執行的 simulation 回復命令。

#### Scenario: 8080 已被已知 runtime job 占用
- **WHEN** 使用者切換模式且 8080 正由另一個已知模式 job 使用
- **THEN** 系統先停止原 job、等待 port 釋放，再啟動目標模式

#### Scenario: production 行情未建立
- **WHEN** production 登入成功但唯讀行情 API 回傳 `SessionNotEstablished` 或其他失敗
- **THEN** 系統不得宣稱正式行情可用，並顯示切回 simulation 的明確操作

### Requirement: production-readonly 必須阻擋交易寫入
系統 MUST 在 production-readonly 模式阻擋下單、改價、改量、刪單、組合下單與組合刪單，且 MUST 不影響行情、帳務及委託查詢。

#### Scenario: Web 嘗試送出交易寫入
- **WHEN** production-readonly 模式下 Web 對已知交易寫入 API 發出請求
- **THEN** client guard 或 Vite proxy 以唯讀錯誤拒絕，且請求不得轉送至 Shioaji server

#### Scenario: Web 查詢委託或帳務
- **WHEN** production-readonly 模式下 Web 查詢 trades、positions 或 account data
- **THEN** 系統允許唯讀請求繼續送往 Shioaji server

### Requirement: production-readonly 不得載入 CA 或保存秘密
系統 MUST 在正式行情唯讀切換前拒絕非空 CA 設定，且 LaunchAgent、mode marker、log 與狀態輸出 MUST NOT 包含 API key、secret、CA 密碼或帳戶識別資料。

#### Scenario: 偵測到 CA 設定
- **WHEN** `.env` 含有非空 `SJ_CA_PATH` 或 `SJ_CA_PASSWD`
- **THEN** production-readonly 切換失敗並僅提示移除 CA 設定，不輸出設定值

#### Scenario: 查看 runtime 狀態
- **WHEN** 使用者執行狀態命令
- **THEN** 輸出僅包含模式、job、port、health 與行情測試摘要

### Requirement: 狀態診斷必須區分服務與行情
系統 MUST 分別呈現本機 Web、Shioaji HTTP health、登入模式與行情業務測試，避免將市場休市、session 未建立或程序停止混為一談。

#### Scenario: 市場休市但 server 健康
- **WHEN** 本機 API 可回應且即時 SSE 沒有新成交
- **THEN** 狀態不得僅因無新 tick 判定本機服務中斷

#### Scenario: 本機程序停止
- **WHEN** 5173 或 8080 沒有 listener
- **THEN** 狀態明確標示對應本機服務未執行

### Requirement: MultiView 服務必須納入本機 runtime 生命週期
本機 runtime install MUST 安裝並啟動獨立 MultiView LaunchAgent，status、simulation 與 uninstall MUST 一併管理 5174 服務，但 MultiView 失敗 MUST NOT 停止或重設 5173／8080。重新登入或重開機後仍 MUST 以 simulation 為預設，MultiView 不得自行切換至其他模式。

#### Scenario: 安裝本機 runtime
- **WHEN** 使用者執行 runtime install 且 dependency 與本機資料路徑通過檢查
- **THEN** simulation API、RealTimeStock Web 與 MultiView Web／Worker LaunchAgent 均被安裝並在 loopback 啟動
- **AND** 任何非 simulation job 維持未自動載入

#### Scenario: MultiView 啟動失敗
- **WHEN** 5174 因 dependency、port 或 D1 問題未通過 health
- **THEN** runtime status 明確標示 MultiView 失敗，5173／8080 的既有模式維持不變
- **AND** 系統 MUST NOT 為修復 MultiView 自動切換至非 simulation 模式或讀取秘密

### Requirement: MultiView 必須只在 simulation 運作並保持 data-only
MultiView 啟動及每次行情／契約／串流請求 MUST 重新確認 8080 的實際模式與 business availability。只有 simulation 可建立 SSE、訂閱或讀取行情；任何非 simulation 模式 MUST 停止 5174 或回 `simulation_required`。5174 adapter 的 order／account／CA 禁止規則 MUST 永久保持相同。

#### Scenario: simulation 啟動 MultiView
- **WHEN** 8080 回報 simulation 且 business request 通過
- **THEN** MultiView 依目前可見商品 bootstrap 並建立去重 SSE
- **AND** data-only allowlist 不得新增任何交易或帳務路徑

#### Scenario: runtime 切至非 simulation
- **WHEN** 8080 回報非 simulation，或模式在現有 SSE 期間改變
- **THEN** runtime MUST 停止 5174，且 adapter MUST 清除行情 provisional、SSE、訂閱與契約快取
- **AND** 手動啟動的 5174 也 MUST 回 `simulation_required`，不得讀取或顯示該模式行情

### Requirement: Runtime status 必須分別呈現三個服務與 MultiView 資料層
狀態診斷 MUST 分別顯示 Shioaji API listener／mode／business test、RealTimeStock 5173、MultiView 5174、MultiView D1 integrity、即時來源與盤後 pipeline 摘要。單一 HTTP 200、SSE heartbeat 或 listener MUST NOT 代表其他層正常。

#### Scenario: 5174 正常但 D1 損壞
- **WHEN** MultiView Web 可回 200，但 D1 integrity 或 schema gate 失敗
- **THEN** status MUST 分別顯示 Web up 與 data unhealthy
- **AND** 盤後功能不得標示 ready

#### Scenario: Shioaji 健康但行情 session 未建立
- **WHEN** 8080 health 成功但 Snapshot／Kbars business test 失敗
- **THEN** status MUST 顯示 API up、market unavailable 與 MultiView delayed fallback
- **AND** 不得顯示 Shioaji realtime ready

### Requirement: Uninstall 不得未經確認刪除 MultiView 資料
runtime uninstall MUST 停止並移除本工具建立的 MultiView LaunchAgent 與安裝腳本，但 MUST 預設保留本機 D1、備份、清單與設定。任何資料刪除 MUST 是另外、明確且指向精確路徑的操作。

#### Scenario: 一般 uninstall
- **WHEN** 使用者執行 runtime uninstall
- **THEN** 5174 job 與 plist 被移除，本機 D1、備份與個人清單仍可復原
- **AND** 輸出明確告知資料保存位置且不包含個人內容

### Requirement: 非 simulation fail-closed 必須能在隔離狀態驗證
系統 MUST 提供不切換目前 runtime、不建立 production job、不讀取正式行情的隔離驗證方式，證明任何非 simulation mode 都不啟動 MultiView，且 adapter 在商品契約或行情解析前回 `simulation_required`。

#### Scenario: synthetic 非 simulation mode
- **WHEN** 驗收工具以 repo 外臨時 state 提供 `simulation=false`
- **THEN** runtime plan MUST 不包含 5174 啟動，adapter MUST 在轉送前拒絕契約、Snapshot、Kbars 與 SSE
- **AND** 目前 simulation 8080／5173／5174 MUST 不受影響

### Requirement: 本機生命週期驗收必須保持資料可復原
MultiView 的 restart、備份、restore、uninstall 與重新安裝驗收 MUST 使用精確路徑，並在每個會寫入的步驟前保存可驗證備份。一般 uninstall MUST 保留本機 D1、備份、個人清單與設定；restore 後 MUST 通過 schema、hash、row count 與 `PRAGMA integrity_check`。

#### Scenario: uninstall 後重新安裝
- **WHEN** 使用者執行一般 uninstall 再重新 install／start
- **THEN** 5174 job MUST 可恢復，原 D1、備份與個人清單 MUST 保留且 integrity check 通過

#### Scenario: macOS 重新登入
- **WHEN** 使用者在其他驗收完成且保存狀態後重新登入 macOS
- **THEN** runtime MUST 預設為 simulation，8080／5173／5174 MUST 恢復，且本機資料 hash／row count MUST 與登出前一致

### Requirement: Simulation business session 必須由有界 watchdog 自動恢復
系統 MUST 以獨立的使用者層級 watchdog 每 30 秒執行一次固定、有界且唯讀的 2330 Snapshot business probe，並 MUST 將 HTTP listener、`/health`、實際 mode 與 business availability 分層判定。只有 mode marker 與 `/api/v1/info` 都顯示 simulation、目前 API generation 曾取得合法非空 Snapshot，且連續三次明確回傳 `SessionNotEstablished` 時，watchdog 才能建立 recovery incident 並重啟 simulation API。

#### Scenario: 已建立的 simulation session 中途失效
- **WHEN** 目前 API generation 已通過 business probe，之後在 HTTP health 仍成功時連續三次回傳 `SessionNotEstablished`
- **THEN** watchdog 建立單一 recovery incident，並只對 simulation API LaunchAgent 執行一次受控重啟

#### Scenario: 任一次 business probe 恢復成功
- **WHEN** 尚未達重啟門檻前取得合法非空 Snapshot
- **THEN** watchdog 清除 consecutive failure count 並維持目前 API generation 為 healthy／armed

#### Scenario: 初始 session 從未建立
- **WHEN** 新的 API generation 在至少 90 秒 warm-up 後仍未曾取得合法 business Snapshot
- **THEN** watchdog 維持 unarmed 與可診斷的離線狀態，不得僅因 `SessionNotEstablished` 自動重啟

#### Scenario: 非 session-specific 錯誤
- **WHEN** 市場沒有新 Tick、SSE 沒有事件、單次 timeout、listener down、mode mismatch、一般 HTTP 錯誤或 response shape 不合法
- **THEN** watchdog 只記錄固定安全 reason code，且不得把該結果計入 `SessionNotEstablished` 重啟門檻

### Requirement: Watchdog 重啟必須有限且不得擴大影響範圍
watchdog MUST 只以 `launchctl kickstart -k` 或等效 user-domain 操作重啟已安裝的 simulation API job，MUST NOT 執行完整模式切換，且 MUST NOT bootout、bootstrap、重啟或寫入 5173、5174、MultiView D1、daily pipeline 或 TDCC pipeline。每次重啟後 MUST 保留至少 90 秒 recovery grace；單一 incident 的後續重啟 MUST 至少套用 2 分鐘與 5 分鐘退避，總次數 MUST 不超過三次，耗盡後 MUST 進入 circuit-open。

#### Scenario: 第一次自動重啟
- **WHEN** armed simulation generation 達到連續三次 `SessionNotEstablished` 門檻
- **THEN** 系統只重啟 8080 simulation API，且 5173、5174、D1 與盤後 pipeline 維持目前生命週期與資料狀態

#### Scenario: 重啟後 session 仍未建立
- **WHEN** recovery grace 結束後 business probe 仍明確回傳 `SessionNotEstablished`
- **THEN** watchdog 依 2 分鐘、5 分鐘的最小退避安排後續嘗試，且相同 incident 最多執行三次重啟

#### Scenario: 重啟上限耗盡
- **WHEN** 相同 recovery incident 已執行三次重啟且仍未取得合法 Snapshot
- **THEN** watchdog 進入 circuit-open、停止自動重啟並持續提供安全診斷，直到 Snapshot 成功或使用者明確執行 simulation 回復命令

#### Scenario: Session 恢復
- **WHEN** recovery incident 期間取得合法非空 Snapshot
- **THEN** watchdog 清除 incident、退避與 circuit 狀態，將目前 API generation 標示為 healthy／armed

### Requirement: Watchdog 生命週期與狀態必須遵守 simulation 安全邊界
runtime install MUST 安裝並載入 simulation watchdog；simulation 回復命令 MUST 重設 watchdog incident 並啟動新的 warm-up；production-readonly 切換 MUST 在啟動 production API 前停止 watchdog；uninstall MUST 移除 watchdog job、plist 與純診斷 state。watchdog MUST NOT 切換至 production、載入 CA、呼叫交易／帳務／server-management API，或保存任何秘密及個人資料。

#### Scenario: 切換 production-readonly
- **WHEN** 使用者明確執行 production-readonly 模式切換
- **THEN** runtime 在啟動 production API 前停止 watchdog，且該 watchdog 不得重啟或取代 production job

#### Scenario: 查看 runtime status
- **WHEN** 使用者執行 `pnpm local-runtime status`
- **THEN** 輸出 watchdog job、state、consecutive failure、restart count、last reason 與 next eligible time 的固定安全摘要
- **AND** 輸出不得包含 response body、商品清單、帳戶、environment、API key、secret 或 CA 資料

#### Scenario: 移除本機 runtime
- **WHEN** 使用者執行一般 uninstall
- **THEN** watchdog job、plist 與純診斷 state 被移除，且 `.env`、MultiView D1、備份、清單與設定保持可復原

### Requirement: Runtime install 必須分離應用服務與 smart-order 的 Node authority

系統 MUST 讓 smart-order sidecar、diagnostics、repository probe 與 mode lease 使用符合 Node LTS `>=24.15.0 <25` 的持久化 private Node contract；Web、MultiView、watchdog 與資料 pipeline MUST 使用獨立的 application Node authority。application Node 不得改變、繞過或降級 smart-order 的版本、平台、generation、sender fence 或 write-master 安全閘門。

#### Scenario: 持久化 Node 無法由 LaunchAgent 讀取 Documents source
- **WHEN** smart-order Node 符合安全版本但 macOS 不允許該 binary 從背景讀取 repository 的 UI 或 pipeline source
- **THEN** Web、MultiView、watchdog 與資料 pipeline MUST 能改用 application Node 啟動
- **AND** smart-order sidecar MUST 繼續使用原本的持久化 Node contract

#### Scenario: Application Node 不符合 smart-order 版本範圍
- **WHEN** application Node 為 Node 25 以上，但持久化 smart-order Node 符合 Node LTS 安全範圍
- **THEN** 一般應用服務 MAY 使用 application Node
- **AND** smart-order sidecar、diagnostics、repository probe 與 mode lease MUST NOT 使用該 application Node

### Requirement: 安全 quiesce 不得被相同 epoch 的保守 revision 前進鎖死

當 durable repository 的 current runtime epoch、sender fence 與 API generation 均與 authenticated sidecar 相同時，lifecycle quiesce MUST 以 transaction 內讀取的目前 repository revision 執行單向安全收斂；controller 的 expected revision 因 continuity invalidation 或其他保守狀態前進而落後時，MUST NOT 要求 force bootout。此例外 MUST 只適用於關閉 dispatch 的 quiesce，不得套用交易或一般業務 mutation。

#### Scenario: Continuity invalidation 後執行安裝
- **WHEN** 同一 runtime epoch 因 continuity gap 從 revision 0 前進至 revision 1，controller 隨後要求 graceful stop
- **THEN** repository MUST 以 revision 1 作為 quiesce source revision，原子前進至 `quiescing`
- **AND** lifecycle operation identity、journal 與回傳 revision MUST 綁定 revision 1

#### Scenario: Epoch 或 generation 已改變
- **WHEN** quiesce 的 runtime epoch、sender fence 或 API generation 不再是 repository current authority
- **THEN** repository MUST fail-closed 且不得建立 lifecycle fence、暫停策略或停止服務

#### Scenario: 仍有 lifecycle obligation
- **WHEN** repository 目前 lifecycle projection 含 strategy、intent、order、reservation、claim、obligation 或 reconciliation blocker
- **THEN** quiesce MUST 回到 `observe_only` 或 `reconciling` 並回報 drain blocked
- **AND** runtime install MUST NOT bootout sidecar

#### Scenario: 已有不同 operation 的 quiesce
- **WHEN** durable runtime 已處於 `quiescing` 且 operation 與新請求不同
- **THEN** repository MUST 拒絕新請求並保留原 durable operation identity

### Requirement: 本機 runtime 生命週期必須納入智慧單 sidecar 與 gateway
`install`、`simulation`、`status`、`production-readonly`、watchdog recovery、stop、rollback 與 `uninstall` MUST 明確管理 smart-order sidecar、same-origin gateway capability、SQLite repository 與 write-master 狀態。sidecar MUST 只在 simulation 計畫且原生Apple Silicon `arm64`、非VM的macOS實機上可安裝／啟動，且不得新增 production 自動送單權限。Intel／`x64`、Rosetta、VM、Windows或Linux可維持RealTimeStock一般前端／桌面主程式原有支援，但smart-order LaunchAgent、sender與broker authority MUST保持不可用。

#### Scenario: 安裝本機 runtime
- **WHEN** 使用者執行 install 且 Node／SQLite／路徑與權限 capability gate 通過
- **THEN** 系統 MUST 安裝 loopback smart-order job 與私有控制面檔，但策略 MUST 保持 observe-only、write master 關閉

#### Scenario: 查看 status
- **WHEN** 使用者執行 `pnpm local-runtime status`
- **THEN** 輸出 MUST 分開顯示 sidecar job、health、readiness、mode generation、repository、reconciliation、active obligation count 與 write-master 摘要，且不得包含 capability、帳號、策略內容或秘密

### Requirement: sidecar 每次交易寫入都必須重新驗證 simulation
sidecar 不得以啟動時模式或 Vite guard 作為持續授權。每次 place、update、cancel 前 MUST 同時驗證 mode marker、`/api/v1/info.simulation === true`、同一 API generation、single-writer fence 與固定帳號 readiness，並在durable `dispatching` commit前取得跨程序 shared mode execution lease；lease MUST持有到broker結果與identifiers已durable commit為acknowledged／terminal，或durable commit為unknown／reconciling。mode switch MUST取得exclusive lease、先阻擋新dispatch並等待既有lease結束；結果只存在記憶體、未知、不一致、逾時、unmanaged 8080或 generation 變更 MUST阻擋。

#### Scenario: Vite 未參與 broker 呼叫
- **WHEN** sidecar 準備直接呼叫 8080
- **THEN** sidecar adapter MUST 完整執行 mode attestation，不得因 loopback 或已通過先前檢查而略過

#### Scenario: TOCTOU mode 競態
- **WHEN** preflight 後、broker write 前 mode marker 或 API generation 改變
- **THEN** 舊 fence MUST 失效，broker write MUST NOT 發出

#### Scenario: dispatch 已持有 execution lease
- **WHEN** place／update／cancel 已進入 shared mode lease且另一程序要求 production-readonly
- **THEN** mode switch MUST等待該write以confirmed或unknown／reconciling狀態完成durable commit後才取得exclusive lease並改generation，不得只靠HTTP response或重讀marker猜測沒有競態

#### Scenario: ack 已回傳但 DB commit 尚未完成
- **WHEN** broker已回accepted identifiers，但Runtime尚未durable保存acknowledged就發生mode switch或crash
- **THEN** execution lease不得正常釋放；sender MUST fail-stop，復原後dispatching intent先阻擋切換並reconcile

### Requirement: 切換 production-readonly 前必須 quiesce 並處理智慧單義務
production-readonly 一般切換 MUST先關閉新activation與write master、取得exclusive mode lock、完成account-scoped reconciliation，並列出所有non-terminal strategy、所有non-terminal side-effect intent（至少`dispatching`、`acknowledged`、`reconciling`、`unknown`）、所有non-terminal BrokerOrder（至少`pending_submit`、`pre_submitted`、`submitted`、`part_filled`）、ExitClaim／EntryExposureReservation與 `RuntimeTrackedUnprotectedRemainder`。單純paused／quiesced strategy若沒有broker order、side-effect intent、reservation、claim或obligation MAY留在DB而不阻擋production-readonly；但只要存在上述side effect、非零reservation／claim或未終結protection obligation，一般切換 MUST拒絕，直到取得broker final evidence並使其terminal／released。仍為`prepared`且可證明adapter從未取得dispatch權的intent MAY先明確cancel／release而不得呼叫broker。保留working order後停止監控只可走明確break-glass強制切換，必須二次確認、snapshot、unmonitored audit與券商人工處置提示，不能算 graceful drain。

#### Scenario: 條件命中時要求切換 production-readonly
- **WHEN** 某 intent 為 dispatching／unknown，使用者執行 mode switch
- **THEN** runtime MUST 拒絕切換並先 reconciliation，不得一邊啟動 production 一邊讓舊 sidecar完成寫入

#### Scenario: 仍有 working simulation order
- **WHEN** reconciliation 證明存在 working order
- **THEN** runtime MUST 要求使用者明確選擇並確認 broker 結果；不得靜默停止監控或假稱 order 已取消

#### Scenario: reconciling intent 或 pending-submit order
- **WHEN** 任一side-effect intent為reconciling，或BrokerOrder為pending_submit／pre_submitted／part_filled
- **THEN** production-readonly一般切換 MUST拒絕並列出精確阻擋狀態，不能因它尚未標成working或unknown而忽略

#### Scenario: 只有 quiesced strategy 無交易義務
- **WHEN** paused strategy沒有任何broker order、side-effect intent、reservation、claim或protection obligation
- **THEN** production-readonly MAY在保留唯讀資料下切換；不得把單純資料列誤稱為未結束broker side effect

### Requirement: watchdog 或 API generation 改變後智慧單必須先 recovery
simulation watchdog 重啟 8080、business session 恢復或 API generation 改變時，sidecar MUST 使舊 fence 失效、停止 dispatch、重建固定帳號 trade subscriptions並 reconciliation orders／positions／reservations。全部 readiness 通過前 MUST NOT 恢復 monitoring writes。

#### Scenario: watchdog 重啟 8080
- **WHEN** business-session watchdog 對 simulation API 執行受控重啟
- **THEN** sidecar MUST 進 recovery，保留持久化義務並禁止 broker writes，直到新 generation 完整對帳

#### Scenario: recovery 完成
- **WHEN** 新generation的manifest、mode、帳號、identity、external working-order visibility、orders、positions、trade subscription、canonical risk／PnL、global resources、calendar、contract與quote readiness全部通過
- **THEN** 策略仍 MUST 保持 paused／observe-only，只有使用者明確 resume 與 arm 才可再次送單

### Requirement: stop rollback 與 uninstall 不得遺棄未終結智慧單
`RuntimeTrackedUnprotectedRemainder` MUST定義為 `max(0, obligation.filledShares - obligation.confirmedExitedShares - obligation.activelyCoveredShares)`，只計Runtime建立的`ProtectionObligation`。`activelyCoveredShares` MUST為distinct `ExitClaim` lineage的投影：只可包含fresh Runtime readiness下仍為`monitoring_reserved`／`intent_reserved`且有效監控的base shares，或account-scoped reconciliation唯一確認同claim仍`broker_working`的shares；不同representation不得重複相加，stale／offline監控、released／consumed或unknown claim不得計入。一般既有持股若未綁定obligation不得單獨阻擋生命週期。一般stop、feature flag關閉、rollback或uninstall MUST預設拒絕在存在任何non-terminal strategy、non-terminal side-effect intent、non-terminal BrokerOrder、非零EntryExposureReservation／ExitClaim或未終結／未released obligation時停止sidecar。`prepared`且未授予adapter dispatch權者可先明確cancel／release，不得呼叫broker。obligation只可因entry零成交terminal、broker-confirmed全部退出／position歸零，或使用者二次確認逐項relinquish並保存人工接手snapshot而terminal／released；對應reservation／claim必須歸零。強制操作 MUST二次確認、保存一致性snapshot、逐項記錄人工處置並標示unmonitored；一般uninstall MUST保留DB、WAL、backup與audit。

#### Scenario: 一般 uninstall 有 active strategy
- **WHEN** 使用者執行 uninstall 且仍有智慧單義務
- **THEN** uninstall MUST 停止並列出精確阻擋項目，不得移除 sidecar job 或控制面後留下靜默未監控策略

#### Scenario: 所有義務已終結
- **WHEN** reconciliation證明所有strategy／broker order／unknown intent terminal、所有Runtime protection obligation terminal或released且reservation為0
- **THEN** uninstall MAY 移除 job、plist與 capability，但 MUST 預設保留私有資料庫、備份與 audit

#### Scenario: 只有一般既有持股
- **WHEN** 帳號仍有既有股票部位，但從未建立對應Runtime `ProtectionObligation`，且沒有Runtime strategy、working order、unknown intent或reservation
- **THEN** 該持股 MUST NOT 單獨阻擋一般stop／uninstall；UI不得把它誤列為Runtime遺棄的保護義務

#### Scenario: Runtime追蹤的未受保護remainder仍存在
- **WHEN** 某obligation有broker-confirmed fill，但confirmed exit與actively covered shares不足，且使用者尚未relinquish
- **THEN** 一般stop／rollback／uninstall MUST拒絕並列出精確base shares與人工處置選項

### Requirement: 非 loopback 與 Cloudflare 不得啟動智慧單 Runtime
runtime plan MUST 只允許 smart-order sidecar 與 gateway 綁定本機 loopback；任何 production、Cloudflare、公開 host、remote tunnel 或 synthetic non-simulation mode MUST 不包含智慧單交易控制面，且 MUST 在讀取策略或 broker adapter 前 fail closed。

#### Scenario: synthetic 非 simulation 驗證
- **WHEN** 隔離驗收以 repo 外臨時 state 提供 `simulation=false`
- **THEN** runtime plan MUST 不啟動 smart-order sender，gateway 與 adapter MUST 在任何 broker 呼叫前回 `simulation_required`，目前 simulation 服務不得受影響
