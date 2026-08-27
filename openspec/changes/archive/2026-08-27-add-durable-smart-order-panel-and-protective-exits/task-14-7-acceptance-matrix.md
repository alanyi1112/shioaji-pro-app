# Task 14.7 離線驗收矩陣

- Matrix ID：`smart-order-task-14-7/offline/2026-08-12.1`
- 對應 change：`add-durable-smart-order-panel-and-protective-exits`
- 驗收範圍：只做離線 artifact traceability；未連線 broker、8080 或任何服務，未取得 simulation write、production、CA 或真實委託授權。
- Machine-readable 權威：[task-14-7-acceptance-manifest.json](./task-14-7-acceptance-manifest.json)。本表每列的 Requirement、case ID、evidence、manual route coverage 與 gate 必須由 `task-14-7-acceptance-validator.mjs` 依 canonical source path 與 SHA-256 逐欄核對。

## Scenario 角色與 fail-closed 判定

- `N`（normal）：直接執行同一 Requirement 綁定的規範 Scenario，`injection=none`；Scenario 本身若是拒絕案例，正常結果就是依規範拒絕。
- `F`（failure）：在同一 Requirement 的規範 Scenario 注入必要輸入或 dependency 失效，預期 fail closed 且沒有未驗證 broker side effect。
- `R`（race）：在同一 Requirement 的規範 Scenario 注入 authoritative state／revision 並發漂移，預期只有一個線性化 authority，且沒有重複 side effect。
- 若某 Requirement 的規範只提供一個 Scenario，N／F／R MAY 共用該 source Scenario，但三個 case 的 role、injection 與 expected outcome 必須互異且由 validator 固定；不得借用其他 Requirement 的 Scenario。
- 目前沒有 current eligible live simulation evidence；所有 case 的 `status=missing`、`simulationEvidence.sha256=null`。
- `manual-stock-write-route-coverage.md` 現為 `coverageComplete=true`、`manualEquivalencePassed=true`、`serverDerivedProvenancePassed=true`；但 current eligible live simulation evidence 與 write-unlock conjunct 仍缺失，所以所有 gate 繼續是 `disabled`。

## Requirement 對應表

下表只投影 machine-readable manifest。任一欄漂移、刪除、重複或錯綁 gate 都會讓 validator 失敗。

| Requirement ID | Requirement | Normal case | Failure case | Race case | Simulation evidence | Manual route coverage | Feature gate |
|---|---|---|---|---|---|---|---|
| `DSR-001` | 智慧單必須明示為本機監控而非券商雲端 | `DSR-001-N` | `DSR-001-F` | `DSR-001-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-002` | 本機控制面必須有 same-origin 認證與 CSRF 邊界 | `DSR-002-N` | `DSR-002-F` | `DSR-002-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-003` | Runtime 必須是 single-writer 並使用具故障邊界的 SQLite | `DSR-003-N` | `DSR-003-F` | `DSR-003-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-004` | 策略與 broker 操作必須固定綁定明確交易身分 | `DSR-004-N` | `DSR-004-F` | `DSR-004-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-005` | authenticated identity group 必須穩定不可逆且在不確定時 fail closed | `DSR-005-N` | `DSR-005-F` | `DSR-005-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-006` | 持久化模型必須分離策略、activation、intent 與 broker order | `DSR-006-N` | `DSR-006-F` | `DSR-006-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-007` | 每個 broker side effect 必須先持久化意圖 | `DSR-007-N` | `DSR-007-F` | `DSR-007-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-008` | 自動送單只能提供 at-most-once dispatch 不得宣稱 broker exactly-once | `DSR-008-N` | `DSR-008-F` | `DSR-008-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-009` | broker reconciliation 必須明確帳號、有界且以事件為主 | `DSR-009-N` | `DSR-009-F` | `DSR-009-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-010` | 所有 RealTimeStock 交易寫入必須經同一 gateway 與 arbiter | `DSR-010-N` | `DSR-010-F` | `DSR-010-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-011` | 每個 broker write 必須使用 server-derived provenance 防止 confused deputy | `DSR-011-N` | `DSR-011-F` | `DSR-011-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-012` | 每次交易寫入必須雙重證明 simulation | `DSR-012-N` | `DSR-012-F` | `DSR-012-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-013` | Runtime 必須持有 canonical 風控與分級 kill switch | `DSR-013-N` | `DSR-013-F` | `DSR-013-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-014` | canonical daily PnL 必須有版本化計算與新鮮度契約 | `DSR-014-N` | `DSR-014-F` | `DSR-014-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-015` | 行情條件必須使用即時 subscription 與可驗證新鮮度 | `DSR-015-N` | `DSR-015-F` | `DSR-015-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-016` | 斷線、睡眠與 clock gap 必須採可重建或人工處理 | `DSR-016-N` | `DSR-016-F` | `DSR-016-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-017` | 交易日曆與 canonical contract 不可用時必須停止 | `DSR-017-N` | `DSR-017-F` | `DSR-017-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-018` | 部位 reservation 與張股單位必須 account-wide | `DSR-018-N` | `DSR-018-F` | `DSR-018-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-019` | health 與交易 readiness 必須分開 | `DSR-019-N` | `DSR-019-F` | `DSR-019-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-020` | Runtime 資源使用必須遠離官方上限 | `DSR-020-N` | `DSR-020-F` | `DSR-020-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-021` | 策略控制與 confirmation 必須版本化且不可變 | `DSR-021-N` | `DSR-021-F` | `DSR-021-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-022` | manual intervention 必須依 reason code 使用版本化解除矩陣 | `DSR-022-N` | `DSR-022-F` | `DSR-022-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-023` | observe-only 與 write master 必須預設安全 | `DSR-023-N` | `DSR-023-F` | `DSR-023-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-024` | gate manifest 必須在 dispatch path 機械性強制執行 | `DSR-024-N` | `DSR-024-F` | `DSR-024-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-025` | Gate 0 simulation probe 必須使用不可被策略重用的 safety envelope | `DSR-025-N` | `DSR-025-F` | `DSR-025-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-026` | 歷程、通知與資料保留不得冒充 broker 證據 | `DSR-026-N` | `DSR-026-F` | `DSR-026-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `DSR-027` | 舊交易 trigger 與新 Runtime 不得同時送單 | `DSR-027-N` | `DSR-027-F` | `DSR-027-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `PET-001` | 下單面板價別必須使用中文名稱且保留 canonical code | `PET-001-N` | `PET-001-F` | `PET-001-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`protective_exit`／disabled |
| `PET-002` | 自動保護第一階段只支援現股多單整股 | `PET-002-N` | `PET-002-F` | `PET-002-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`protective_exit`／disabled |
| `PET-003` | 含保護的新單必須先保存完整計畫才可送進場 | `PET-003-N` | `PET-003-F` | `PET-003-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`protective_exit`／disabled |
| `PET-004` | confirmation 必須綁定精確 entry 與保護 payload | `PET-004-N` | `PET-004-F` | `PET-004-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`protective_exit`／disabled |
| `PET-005` | 停損停利必須支援價位百分比與 ATR | `PET-005-N` | `PET-005-F` | `PET-005-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`protective_exit`＋`stop_take`／disabled |
| `PET-006` | ATR 必須使用版本化固定快照 | `PET-006-N` | `PET-006-F` | `PET-006-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`protective_exit`＋`stop_take`／disabled |
| `PET-007` | 價格換算必須使用 canonical contract 與方向性 tick arithmetic | `PET-007-N` | `PET-007-F` | `PET-007-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`protective_exit`＋`stop_take`／disabled |
| `PET-008` | 觸發條件與 broker 委託政策必須分離 | `PET-008-N` | `PET-008-F` | `PET-008-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`protective_exit`＋`stop_take`／disabled |
| `PET-009` | 正式保護數量與基準必須使用累計實際成交 | `PET-009-N` | `PET-009-F` | `PET-009-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`protective_exit`＋`stop_take`／disabled |
| `PET-010` | 既有部位的百分比與 ATR 基準必須明確且可驗證 | `PET-010-N` | `PET-010-F` | `PET-010-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`protective_exit`＋`stop_take`／disabled |
| `PET-011` | 保護命中時尚有 entry 餘量必須先處理競態 | `PET-011-N` | `PET-011-F` | `PET-011-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`protective_exit`＋`stop_take`＋`trailing_exit`／disabled |
| `PET-012` | 移動出場必須保存啟動門檻與有利極值 | `PET-012-N` | `PET-012-F` | `PET-012-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`protective_exit`＋`trailing_exit`／disabled |
| `PET-013` | 同組保護必須以 reservation 與 OCO remainder 防止重複出場 | `PET-013-N` | `PET-013-F` | `PET-013-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`protective_exit`＋`stop_take`＋`trailing_exit`／disabled |
| `PET-014` | 外部部位變動不得導致超賣 | `PET-014-N` | `PET-014-F` | `PET-014-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`protective_exit`＋`stop_take`＋`trailing_exit`／disabled |
| `PET-015` | UI 必須區分保護生命週期與未受保護數量 | `PET-015-N` | `PET-015-F` | `PET-015-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`protective_exit`＋`stop_take`＋`trailing_exit`／disabled |
| `PET-016` | 保護設定在最小 footprint 必須可讀可操作 | `PET-016-N` | `PET-016-F` | `PET-016-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`protective_exit`／disabled |
| `SLR-001` | 本機 runtime 生命週期必須納入智慧單 sidecar 與 gateway | `SLR-001-N` | `SLR-001-F` | `SLR-001-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `SLR-002` | sidecar 每次交易寫入都必須重新驗證 simulation | `SLR-002-N` | `SLR-002-F` | `SLR-002-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `SLR-003` | 切換 production-readonly 前必須 quiesce 並處理智慧單義務 | `SLR-003-N` | `SLR-003-F` | `SLR-003-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `SLR-004` | watchdog 或 API generation 改變後智慧單必須先 recovery | `SLR-004-N` | `SLR-004-F` | `SLR-004-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `SLR-005` | stop rollback 與 uninstall 不得遺棄未終結智慧單 | `SLR-005-N` | `SLR-005-F` | `SLR-005-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `SLR-006` | 非 loopback 與 Cloudflare 不得啟動智慧單 Runtime | `SLR-006-N` | `SLR-006-F` | `SLR-006-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`／disabled |
| `SOP-001` | 工作區必須提供永久標示本機邊界的智慧下單面板 | `SOP-001-N` | `SOP-001-F` | `SOP-001-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`quick`＋`good_till`＋`multi_condition`＋`parent_child`＋`stop_take`＋`trailing_exit`＋`scheduled_quantity`／disabled |
| `SOP-002` | 面板必須與商品聯動但不得改寫已建立策略 | `SOP-002-N` | `SOP-002-F` | `SOP-002-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`quick`＋`good_till`＋`multi_condition`＋`parent_child`＋`stop_take`＋`trailing_exit`＋`scheduled_quantity`／disabled |
| `SOP-003` | 面板必須提供七種型別化台股智慧單 | `SOP-003-N` | `SOP-003-F` | `SOP-003-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`quick`＋`good_till`＋`multi_condition`＋`parent_child`＋`stop_take`＋`trailing_exit`＋`scheduled_quantity`／disabled |
| `SOP-004` | 全新智慧單的類型選擇器必須預設移動出場單 | `SOP-004-N` | `SOP-004-F` | `SOP-004-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`quick`＋`good_till`＋`multi_condition`＋`parent_child`＋`stop_take`＋`trailing_exit`＋`scheduled_quantity`／disabled |
| `SOP-005` | 建立前必須確認 Runtime 回傳的 canonical 不可變快照 | `SOP-005-N` | `SOP-005-F` | `SOP-005-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`quick`＋`good_till`＋`multi_condition`＋`parent_child`＋`stop_take`＋`trailing_exit`＋`scheduled_quantity`／disabled |
| `SOP-006` | 快速單只可使用九種已驗證行情條件 | `SOP-006-N` | `SOP-006-F` | `SOP-006-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`quick`／disabled |
| `SOP-007` | 停損停利單只能保護可驗證現股多單 | `SOP-007-N` | `SOP-007-F` | `SOP-007-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`stop_take`／disabled |
| `SOP-008` | 長效單必須依 1 至 30 日與累計實際成交量執行 | `SOP-008-N` | `SOP-008-F` | `SOP-008-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`good_till`／disabled |
| `SOP-009` | 多條件單必須限制七條並要求 coherent fresh observations | `SOP-009-N` | `SOP-009-F` | `SOP-009-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`multi_condition`／disabled |
| `SOP-010` | 母子單必須遵守每leg商品相等與完整有效期 | `SOP-010-N` | `SOP-010-F` | `SOP-010-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`parent_child`／disabled |
| `SOP-011` | 移動出場必須只對可驗證現股多單追蹤有利極值 | `SOP-011-N` | `SOP-011-F` | `SOP-011-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`trailing_exit`／disabled |
| `SOP-012` | 定時定量必須僅限建立當日並禁止補送 | `SOP-012-N` | `SOP-012-F` | `SOP-012-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`scheduled_quantity`／disabled |
| `SOP-013` | 策略有效期與歷史必須符合明確例外 | `SOP-013-N` | `SOP-013-F` | `SOP-013-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`quick`＋`good_till`＋`multi_condition`＋`parent_child`＋`stop_take`＋`trailing_exit`＋`scheduled_quantity`／disabled |
| `SOP-014` | 同一 authenticated identity 的未終結策略總數不得超過 20 | `SOP-014-N` | `SOP-014-F` | `SOP-014-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`quick`＋`good_till`＋`multi_condition`＋`parent_child`＋`stop_take`＋`trailing_exit`＋`scheduled_quantity`／disabled |
| `SOP-015` | 第一階段支援範圍必須雙層阻擋 | `SOP-015-N` | `SOP-015-F` | `SOP-015-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`quick`＋`good_till`＋`multi_condition`＋`parent_child`＋`stop_take`＋`trailing_exit`＋`scheduled_quantity`／disabled |
| `SOP-016` | pause、resume、cancel 與 broker order 操作必須分離 | `SOP-016-N` | `SOP-016-F` | `SOP-016-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`quick`＋`good_till`＋`multi_condition`＋`parent_child`＋`stop_take`＋`trailing_exit`＋`scheduled_quantity`／disabled |
| `SOP-017` | 面板狀態不得把觸發或接受冒充成交 | `SOP-017-N` | `SOP-017-F` | `SOP-017-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`quick`＋`good_till`＋`multi_condition`＋`parent_child`＋`stop_take`＋`trailing_exit`＋`scheduled_quantity`／disabled |
| `SOP-018` | 面板必須在接近下單面板 footprint 內保持可存取 | `SOP-018-N` | `SOP-018-F` | `SOP-018-R` | `SIM-CURRENT-NONE`／hash=null | `MRC-2026-08-11.1`／complete | `runtime_core`＋`quick`＋`good_till`＋`multi_condition`＋`parent_child`＋`stop_take`＋`trailing_exit`＋`scheduled_quantity`／disabled |

## 現階段結論

- Requirement coverage：67／67；normal／failure／race case 各 67 個，但全部仍是 `missing`，沒有被誤標為 passed。
- Current eligible simulation evidence：0；hash 明確為 `null`，不沿用 fixture、historical failed attempt 或人工宣告。
- Manual route coverage：未完成；所有帳號 automation eligibility 維持 `disabled`。
- Feature gates：`runtime_core`、`protective_exit` 與七種類型共 9 個 gate 全部 `disabled`。
- 本 artifact 只可支持 `artifact apply-ready`；`write-unlock-ready=false`、`feature-release-ready=false`、`brokerWriteAuthority=false`。
