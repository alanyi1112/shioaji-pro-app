## ADDED Requirements

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
