# 智慧下單狀態轉移表與故障邊界

## 文件狀態

- 文件版本：`smart-order-state-transitions/2026-08-11.4`
- 對應 change：`add-durable-smart-order-panel-and-protective-exits`
- 對應工作：task 0.11、1.2、1.9、1.14、2.3、2.6、4.1、4.3、6.4、6.7、6.10、12.1、12.3、12.4、12.7、14.3
- 範圍：Gate 0 的書面模型與 review baseline；**不是實作證據、不是 Gate 通過、不是 simulation write 解鎖依據**。
- 安全邊界：本文只描述 simulation-only 本機 Runtime。本文不授權 production、CA、正式帳號或任何 broker write。

### 0.1 `2026-08-11.4` 紅隊 finding 關閉紀錄

| Finding | v2處置 | 對應章節 |
|---|---|---|
| `ST-P0-01 manual_intervention scope` | `manual_intervention`只保留為Strategy state；其他entity使用自身`unknown`／`reconciling`／`safety_blocked`，並連到ResolutionCase | 1.2、2、7、12 |
| `ST-P0-02 terminal conflict rollback` | terminal entity永不回轉；矛盾證據建立新的ResolutionCase與account／contract SafetyBlocker，必要時只讓仍non-terminal的Strategy進manual | 1.2、12.4 |
| `ST-P0-03 incomplete reason/edge registry` | 每張transition table都是versioned typed edge registry；每列有edge ID、明確from/to、actor、write provenance、reason，且第12節列出完整typed registry schema與reason定義 | 1.3、3–9、11–12 |
| `ST-P0-04 OCO activation impossible model` | 採**單一Activation／remainder generation**；candidate legs為不可dispatch的`ProtectionLegEvaluation` child records，loser只在child record標`suppressed` | 4、9、10 |
| `ST-P0-05 OrderIntent operation ambiguity` | OrderIntent固定`place | update | cancel`、typed owner lineage、target revision與operation-specific terminal outcome；cancel intent不再混為BrokerOrder cancelled | 5 |
| `ST-P0-06 entry remainder/zero-fill ambiguity` | 固定requested／filled／openPotential／terminalUnfilled quantities；partial-entry terminal與true zero-fill分開 | 7.2–7.4 |
| `ST-P0-07 break-glass erases unknown exposure` | break-glass會建立durable `RelinquishedUnknownExposure` SafetyBlocker；release本機義務不會自動解鎖相衝突write | 12.4–12.6 |
| `ST-P0-08 OS lease treated as durable` | 明確分離process-scoped ephemeral OS shared/exclusive lease與DB durable DispatchBlocker；crash釋放OS lease但不清除durable blocker | 11.2、13 |
| `ST-P1-01 actor/provenance conflation` | `actor_kind`與`broker_write_provenance`拆欄；broker event／reconciliation不是write provenance | 1.3、各edge tables |
| `ST-P1-02 wildcard/blocking gaps` | 移除`任一`wildcard，明列所有from states；blocking scope與解除條件由SafetyBlocker registry決定 | 2–12 |
| `ST-P1-03 protectedShares ambiguity` | `protectedShares`定義為distinct、fresh、non-unknown ExitClaim投影，與filled／exited／unprotected建立等式 | 7.4、14 |

上述是**文件模型 finding closure**，不是第15節五角色正式sign-off；task 0.11仍保持未完成。

## 1. 共通名詞與不可違反的規則

### 1.1 狀態類別

| 類別 | 定義 | 對 dispatch 的影響 |
|---|---|---|
| `non-terminal` | 尚有待觀察、待送出、broker side effect、對帳、部位、reservation、claim 或 protection obligation 的可能性 | 必須納入生命週期 drain；除非該狀態的明確 allowlist 允許，否則不得 dispatch |
| `blocking non-terminal` | 目前事實不足以安全推進，例如entity的`unknown`／`reconciling`／`safety_blocked`、Strategy的`recovery`／`manual_intervention`，或存在open SafetyBlocker | 依blocker scope阻擋account／contract／strategy的新broker write |
| `terminal` | 該實體在目前 lineage／generation 已無可再推進的 side effect；終結證據與數量已 durable 保存 | 不得回到 non-terminal；後續工作必須建立新 entity、generation 或 draft |
| `released terminal` | 使用者或系統依明確契約終止本機責任，但不一定代表 broker 結果成功 | UI 與 audit 必須顯示 release 原因；不得把 release 顯示為 broker 成交／取消 |

`unknown` 一律是 blocking non-terminal。任何「看起來可能沒送出」「HTTP 沒回應」「只看到一筆 event」「通知已出現」都不能把 `unknown` 當 terminal。

### 1.2 每一筆轉移的共同欄位

每一筆狀態轉移 MUST 在同一 SQLite transaction／CAS 中保存：

- entity ID、entity kind、lineage／generation；
- `from_state`、`to_state`、`from_revision`、`to_revision = from_revision + 1`；
- allowlisted `reason_code` 與 reason schema version；
- `observed_wall_time`、`observed_wall_time_source`、`wall_time_trust_status = trusted | degraded | untrusted | unknown`、monotonic local sequence、durable `committed_at`與`RuntimeEpoch.id`；時間敏感edge只有`trusted`可推進，其他值以`CALENDAR_OR_TRUSTED_TIME_UNKNOWN`進blocking state，不能用本機顯示時間猜測；
- 觸發轉移的 evidence ID／hash；完整帳號、capability、key、CA 或秘密不得進入 journal；
- 單一`actor_kind`：`runtime_evaluator | runtime_dispatcher | interactive_user | broker_event_consumer | reconciliation_service | resolution_service | lifecycle_service | gate_runner`；每筆transition只能有一個實際writer actor；
- `authorization_evidence_ids`：零至多筆不可變授權證據，例如`UserArmAuthorization`、`UserRearmAuthorization`或`BreakGlassAuthorization`。授權者不是共同writer，不得序列化成第二個`actor_kind`；
- `broker_write_provenance`：`none | manual_user_confirmed | automation | gate_probe`；只有可能取得broker socket authority的dispatch edge可為非`none`，broker event與reconciliation永遠是`none`；
- 需要時保存 fixed account 的不可逆／遮罩 reference、broker revision、mode generation、risk revision、confirmation hash 與 sender fence。

以下規則適用所有表：

1. 只有表中列出的邊可以轉移；未列出的邊以 `STATE_TRANSITION_NOT_ALLOWLISTED` 拒絕並 journal。
2. stale revision、重複 event 或相同 idempotency key不得建立第二筆 entity；若內容相同回傳既有結果，內容不同則以 `STATE_REVISION_CONFLICT` 拒絕。
3. terminal entity 不得重新開啟、改成另一terminal state或回到non-terminal。終結後出現矛盾broker evidence時，原entity保持不變，另建`ResolutionCase(kind=terminal_evidence_conflict)`與open SafetyBlocker；只有關聯Strategy當下仍為non-terminal時才可轉`manual_intervention`，terminal Strategy也不得回轉。
4. `manual_intervention` **只可作為Strategy控制狀態**，不是broker結果，也不是ProtectionObligation／claim／reservation狀態。其他entity保留自己的`unknown`／`reconciling`／`safety_blocked`，並以`resolution_case_id`連到人工處理案件。
5. browser、環境變數、feature flag 或 client payload 不得指定 `from_state`、`to_state`、`reason_code`、provenance 或 terminal outcome。
6. broker event 可以跳過中間顯示狀態，例如 `pending_submit → filled`，但仍須通過固定帳號 correlation、revision 與 final-evidence 規則。
7. `pause` 只阻止未來 Activation；它不會取消 BrokerOrder、釋放 ExitClaim 或終結 ProtectionObligation。
8. `cancel strategy`、`cancel broker order`、`release reservation／claim` 與 `break-glass relinquish` 是不同 operation，不得合併成一個按鈕或 reason code。

### 1.3 Typed edge registry schema

第3至第11節每一列都是不可省略欄位的typed edge definition：

```ts
type StateEdgeDefinition = {
  registryVersion: 'smart-order-state-transitions/2026-08-11.4';
  edgeId: string;
  entityKind: string;
  from: string | '__create__';
  to: string;
  allowedActorKinds: readonly string[];
  brokerWriteProvenance: readonly ('none' | 'manual_user_confirmed' | 'automation' | 'gate_probe')[];
  reasonCodes: readonly string[];
  evidenceClassesByReason: Readonly<Record<string, readonly string[]>>;
  atomicCompanions: readonly string[];
};
```

transition journal另只保存一個`actor_kind`，且該值必須屬於edge的`allowedActorKinds`；表格中的`或`／`|`只表示allowlist，絕不表示同一transition有多個writer。需要使用者核准但由service寫入的edge，service是唯一`actor_kind`，使用者核准只進`authorization_evidence_ids`。

Runtime MUST由registry查edge，不得用`if (terminal) ...`、prefix matching、任意字串reason或UI提供的from/to決定轉移。同一列列出多個from state時，實作／machine-readable registry MUST展開為每個from一筆獨立edge；本文不得使用`任一non-terminal`等wildcard。每個展開後edge必須選一個allowlisted reason，並把第12.1節該reason的`requiredEvidenceClass`完整複製到`evidenceClassesByReason[reason]`；metadata不一致時registry build直接失敗。

為避免表格過寬，本文的「同上」只是一個**逐欄逐字複製前一列非「同上」值**的排版巨集，不是wildcard或執行期繼承。machine-readable registry、測試fixture與journal schema不得保存「同上」；必須展開成完整的`allowedActorKinds`、`brokerWriteProvenance`、`reasonCodes`、`evidenceClassesByReason`與`atomicCompanions`。`A-F`、`A-G`或以`|`列出的from/to也只是一組明列edge的排版縮寫，machine-readable registry必須拆成各自唯一`edgeId`的單一from／單一to定義。

### 1.4 Atomic companion registry

`atomicCompanions`沒有隱含值：registry compiler MUST先為**每一個展開後edge**寫入明確空陣列`[]`，再依下表以完整record名稱取代。下表未列edge的最終值就是`[]`；不得在執行期推測。群組edge ID必須先依1.3節展開，再逐edge複製相同companions。

| Edge IDs | `atomicCompanions`（同一SQLite transaction／CAS） |
|---|---|
| `STR-001` | `ImmutableStrategyDefinition`、`ConfirmationSnapshot`、`UserAuthorizationEvidence` |
| `STR-009A`、`STR-009B`、`STR-009C`、`STR-009D`、`STR-009E`、`STR-009F` | `ResolutionCase.open`、scope-matched `SafetyBlocker.open` |
| `STR-010` | terminal `ResolutionCase`、fresh `ConfirmationSnapshot`、`UserAuthorizationEvidence` |
| `ACT-005`、`INT-001`（entry owner） | `OrderIntent.prepared`、`PendingProtectionCommitment.prepared`、`ProtectionObligation.pending_entry`、policy-required `EntryExposureReservation.reserved` |
| `ACT-007`、`INT-002`、`DDB-001` | 相同intent nonce／sender fence下的`Activation.dispatching`、`OrderIntent.dispatching`、`DurableDispatchBlocker.open` |
| `INT-004`、`DDB-002` | correlated `BrokerOrder` current state、`DurableDispatchBlocker.cleared_acknowledged` |
| `INT-005A`、`INT-005B`、`DDB-005` | `OrderIntent.reconciling`、`DurableDispatchBlocker.cleared_reconciling_durable` |
| `INT-006`、`DDB-004` | `OrderIntent.unknown`、`DurableDispatchBlocker.cleared_unknown_durable`、scope-matched `SafetyBlocker.open` |
| `INT-007`、`DDB-003` | operation-specific terminal outcome、target `BrokerOrder` projection、reservation／claim settlement、`DurableDispatchBlocker.cleared_terminal` |
| `INT-009`、`INT-011`、`INT-014` | operation-specific terminal outcome、target `BrokerOrder` projection、reservation／claim settlement；break-glass variant另依本表break-glass companion set |
| `BRO-010A`、`BRO-010B`、`BRO-010C`、`BRO-010D`、`INT-001`（update/cancel owner） | target `BrokerOrder.controlRevision + 1`、對應`OrderIntent.prepared`、target reservation |
| `PPC-001`、`POB-001`、`EER-001` | entry `OrderIntent.prepared`與三個owner-matched protection records |
| `PPC-005A`、`PPC-005B`、`PPC-006`、`PPC-007A`、`PPC-007B`、`PPC-008A`、`PPC-008B`、`PPC-008C`、`POB-002`、`POB-005`、`EER-002`、`EER-003A`、`EER-003B` | cumulative entry quantities、reservation、obligation、ExitClaim與position projection |
| `POB-011A`、`POB-011B`、`POB-011C`、`POB-011D`、`POB-011E`、`POB-011F` | `ProtectionObligation.safety_blocked`、reason-matched `ResolutionCase.open`、scope-matched `SafetyBlocker.open` |
| `POB-006`、`EXC-003`、exit-owner `ACT-005`、exit-owner `INT-001` | one Activation、winner `ProtectionLegEvaluation`、suppressed leg evaluations、`ExitClaim.intent_reserved`、exit `OrderIntent.prepared` |
| `POB-008A`、`POB-008B`、`POB-008C`、`POB-009`、`POB-010A`、`POB-010B`、`POB-010C`、`EXC-008`、`EXC-009` | cumulative exit quantities、claim generation settlement、obligation projection與position projection |
| `ACT-015E`（`MANUAL_BREAK_GLASS_RELINQUISHED` variant）、`PPC-011`、`POB-014`、`EER-006C`、`EXC-010C`、`INT-011`（break-glass）、`INT-014`（break-glass）、`RC-006` | released／failed local entity、`ResolutionCase.relinquished_unknown`、`RelinquishedUnknownExposure.open`、burned nonce、`BreakGlassAuthorization`與audit snapshot |
| `RTE-016` | `RuntimeEpoch.failed_stop`、本次forced-stop涉及的全部released／failed local entities、`ResolutionCase.relinquished_unknown`、`RelinquishedUnknownExposure.open`、burned nonces、`BreakGlassAuthorization`與audit snapshot；全部以同一transaction作為唯一linearization point |
| `RC-001`、`SB-001` | scope-matched `ResolutionCase.open`、`SafetyBlocker.open` |
| `RC-004A`、`RC-004B`、`RC-004C`、`SB-002` | immutable resolution evidence、derived ledger reprojection、resolved blocker |
| `SB-003` | verifier-bound successor `SafetyBlocker.open`；record ID、lineage、generation、canonical scope、unknown-effect bounds及binding hash全部使用successor metadata |

若同一edge因owner／reason選擇不同companion variant，registry key MUST是`edgeId + reasonCode + ownerKind`，並在dispatch前解析成一組完整不可變陣列；沒有命中的variant一律拒絕，不可退回`[]`。

## 2. 狀態總覽與終結分類

| Entity | Non-terminal | Blocking non-terminal | Terminal |
|---|---|---|---|
| Strategy | `draft`、`observing`、`monitoring`、`paused`、`cancel_pending`、`expired_with_obligation` | `recovery`、`manual_intervention` | `completed`、`cancelled`、`expired` |
| Activation | `armed`、`triggered`、`prepared`、`dispatching`、`working`、`part_filled` | `unknown` | `filled`、`cancelled`、`failed`、`missed` |
| OrderIntent | `prepared`、`dispatching`、`acknowledged` | `reconciling`、`unknown` | `terminal`，另帶不可混用的 `terminal_outcome` |
| BrokerOrder | `pending_submit`、`pre_submitted`、`submitted`、`part_filled` | `unknown` | `filled`、`cancelled`、`inactive`、`failed` |
| PendingProtectionCommitment | `prepared`、`entry_dispatching`、`waiting_entry_result`、`materializing` | `unknown` | `materialized`、`zero_fill_terminal`、`released_pre_dispatch`、`released_manual` |
| ProtectionObligation | `pending_entry`、`monitoring`、`exit_dispatching`、`exit_working`、`partially_exited` | `reconciling`、`safety_blocked` | `fulfilled`、`zero_fill_terminal`、`released_manual` |
| EntryExposureReservation | `reserved`、`partially_consumed` | `unknown` | `consumed`、`released` |
| ExitClaim／ExternalSellClaim generation | `monitoring_reserved`、`intent_reserved`、`broker_working` | `unknown` | `consumed`、`released` |
| RuntimeEpoch | `starting`、`fenced`、`reconciling`、`observe_only`、`ready_unarmed`、`write_armed`、`quiescing` | 無；不安全條件以 `reconciling`／`observe_only` 表示且 write readiness 為 false | `stopped`、`failed_stop`、`superseded` |
| DurableDispatchBlocker | `open` | `open` | `cleared_acknowledged`、`cleared_terminal`、`cleared_unknown_durable`、`cleared_reconciling_durable` |
| SafetyBlocker | `open` | `open` | `resolved`、`superseded_by_stricter_blocker` |
| ResolutionCase | `open`、`evidence_collecting` | `decision_required` | `resolved_by_final_evidence`、`resolved_by_reconfirmation`、`relinquished_unknown` |

補充：

- `draft` 雖為 non-terminal，但沒有交易 authority、不計入本機 20 筆 active strategy 上限，且可在尚未建立任何 obligation／intent 前捨棄。
- Strategy 只有在所有關聯 OrderIntent、BrokerOrder、PendingProtectionCommitment、ProtectionObligation、EntryExposureReservation 與 ExitClaim 都 terminal／released，且 `RuntimeTrackedUnprotectedRemainder = 0` 時，才可進入 terminal。
- `Activation.missed` 用於確定性 schedule slot 在不 ready／盤外時到期且不得dispatch。OCO losing legs不是Activation；它們是同一Activation下的`ProtectionLegEvaluation(status=suppressed)`，避免同ID多row或每leg重複dispatch。
- `OrderIntent.terminal` MUST只使用第5.1節依`place | update | cancel`分組的operation-specific `terminal_outcome`；任何無operation前綴的legacy outcome全部非法且不得migration成預設值。任何`*_relinquished_unknown`都不能顯示為broker已取消、未成交或操作成功。

### 2.1 Non-draft immutable Strategy definition

`draft → observing`的同一transaction會產生`ImmutableStrategyDefinition`與`strategy_definition_hash`。自此不論Strategy位於`observing`、`monitoring`、`paused`、`recovery`、`manual_intervention`、`cancel_pending`、`expired_with_obligation`或terminal，下列欄位皆不可原地修改：

- `strategy_id`、`strategy_type`、fixed account／identity-group opaque refs；
- market、canonical contract／symbol、side、base unit與quantity policy；
- condition AST、condition combinator、comparison semantics、observation source與edge／immediate policy；
- order operation template、price／order type／TIF／lot policy，以及update/cancel target-selection policy；
- schedule／validity／timezone／trusted-calendar revision；
- protection plan（stop-loss、take-profit、trailing、OCO、ATR／percent／price basis）與entry-before-exit policy；
- risk-policy revision、owner kind、intended broker-write provenance與confirmation snapshot hash。

允許改變的只有state-machine營運欄位：entity state／revision、`arm_generation`、observation cursor、schedule cursor、RuntimeEpoch binding、broker correlation、quantities、claims、blockers與resolution references；這些欄位也只能走本文typed edge／CAS。任何immutable欄位變更都必須copy-to-draft，建立新的`strategy_id`與`strategy_definition_hash`、重新確認；舊Strategy繼續drain且不得把既有Activation／OrderIntent／claim搬到新Strategy。直接SQL、migration default、UI patch或manual resolution都不得改寫non-draft definition。

## 3. Strategy transition table

`STR-009A-F`的`reasonCodes`精確allowlist為：`BROKER_OUTCOME_UNKNOWN`、`BROKER_CORRELATION_AMBIGUOUS`、`BROKER_ACCOUNT_MISMATCH`、`BROKER_FINAL_EVIDENCE_CONFLICT`、`ACTIVATION_ID_CONFLICT`、`ENTRY_RESULT_UNKNOWN`、`EXIT_CLAIM_UNKNOWN`、`EXTERNAL_POSITION_DRIFT`、`QUOTE_GAP_CROSSING_UNKNOWN`、`TRAILING_GAP_EXTREME_UNKNOWN`、`POSITION_OR_UNIT_UNKNOWN`、`PROTECTION_UNPROTECTED_REMAINDER`、`DB_INTEGRITY_FAILED`、`IDENTITY_MAPPING_CONFLICT`。新增manual reason必須先升版本文與resolution matrix，不得以任意字串代替。

| Edge ID | From → To | Actor／write provenance | 必要條件／reason code | 禁止事項 |
|---|---|---|---|---|
| `STR-001` | `draft → observing` | `interactive_user`／`none` | canonical confirmation、fixed account、immutable snapshot durable；`USER_CONFIRMATION_ACCEPTED` | 不得直接monitoring／dispatch |
| `STR-002` | `draft → cancelled` | `interactive_user`／`none` | 無intent/order/reservation/claim/commitment/obligation；`USER_DRAFT_DISCARDED` | 不是broker cancel |
| `STR-003` | `observing → monitoring` | `runtime_evaluator`／`none` | valid `UserArmAuthorization`、full reconciliation、current readiness、write master與strategy arm有效；`USER_RESUME_AND_ARM_CONFIRMED` | 不得由restart／flag自動進入 |
| `STR-004` | `observing → paused` | `interactive_user`／`none` | 保留策略但不監控；`USER_PAUSE_REQUESTED` | 不取消broker order |
| `STR-005A` | `observing → recovery` | `runtime_evaluator`／`none` | 可重建readiness gap；`READINESS_LOST_RECONCILIATION_REQUIRED` | 不得dispatch |
| `STR-005B` | `monitoring → recovery` | `runtime_evaluator`／`none` | 同上 | 同上 |
| `STR-005C` | `paused → recovery` | `runtime_evaluator`／`none` | 同上 | 同上 |
| `STR-006` | `monitoring → paused` | `interactive_user`或`runtime_evaluator`／`none` | user pause或deny-union；`USER_PAUSE_REQUESTED`／`POLICY_PAUSE_AUTOMATION` | 不釋放working claim |
| `STR-007` | `paused → monitoring` | `runtime_evaluator`／`none` | valid `UserArmAuthorization`、full reconciliation、新readiness、原activation policy、明確resume＋arm；`USER_RESUME_AND_ARM_CONFIRMED` | 不改寫`require_rearm` |
| `STR-008` | `recovery → paused` | `reconciliation_service`／`none` | 新epoch對帳完成、無open blocker；`RECOVERY_RECONCILED_REARM_REQUIRED` | 不得直接monitoring |
| `STR-009A` | `observing → manual_intervention` | `resolution_service`／`none` | 建立ResolutionCase；使用本節明列的`STR-009A-F` reason allowlist | 不得generic resume |
| `STR-009B` | `monitoring → manual_intervention` | `resolution_service`／`none` | 同上 | 同上 |
| `STR-009C` | `paused → manual_intervention` | `resolution_service`／`none` | 同上 | 同上 |
| `STR-009D` | `recovery → manual_intervention` | `resolution_service`／`none` | 同上 | 同上 |
| `STR-009E` | `cancel_pending → manual_intervention` | `resolution_service`／`none` | 同上 | 同上 |
| `STR-009F` | `expired_with_obligation → manual_intervention` | `resolution_service`／`none` | 同上 | 同上 |
| `STR-010` | `manual_intervention → paused` | `resolution_service`／`none` | valid `UserRearmAuthorization`、matrix核准、ResolutionCase terminal、full reconciliation＋新confirmation；`MANUAL_RESOLUTION_RECONFIRMED` | 不得重送舊unknown intent |
| `STR-011A` | `observing → cancel_pending` | `interactive_user`／`none` | `USER_CANCEL_STRATEGY_REQUESTED` | strategy cancel≠broker cancel |
| `STR-011B` | `monitoring → cancel_pending` | `interactive_user`／`none` | 同上 | 同上 |
| `STR-011C` | `paused → cancel_pending` | `interactive_user`／`none` | 同上 | 同上 |
| `STR-011D` | `recovery → cancel_pending` | `interactive_user`／`none` | 同上 | 同上 |
| `STR-012A` | `monitoring → expired_with_obligation` | `lifecycle_service`／`none` | validity結束且仍有non-terminal義務；`VALIDITY_ENDED_WITH_OBLIGATION` | 不得直接expired |
| `STR-012B` | `paused → expired_with_obligation` | `lifecycle_service`／`none` | 同上 | 同上 |
| `STR-012C` | `recovery → expired_with_obligation` | `lifecycle_service`／`none` | 同上 | 同上 |
| `STR-012D` | `manual_intervention → expired_with_obligation` | `lifecycle_service`／`none` | 同上；ResolutionCase仍保留 | 不得消除manual evidence |
| `STR-012E` | `cancel_pending → expired_with_obligation` | `lifecycle_service`／`none` | 同上 | 同上 |
| `STR-013` | `cancel_pending → cancelled` | `lifecycle_service`／`none` | 全部義務terminal/released、remainder=0、無open blocker；`STRATEGY_CANCEL_DRAIN_COMPLETE` | 不得有working/unknown |
| `STR-014` | `expired_with_obligation → expired` | `lifecycle_service`／`none` | 全部義務terminal/released、remainder=0、無open blocker；`EXPIRY_DRAIN_COMPLETE` | 不因時間自動釋放 |
| `STR-015A` | `monitoring → completed` | `reconciliation_service`／`none` | broker-confirmed target達成、義務結清；`STRATEGY_TARGET_COMPLETED` | trigger/ack不算完成 |
| `STR-015B` | `paused → completed` | `reconciliation_service`／`none` | 同上 | 同上 |
| `STR-016A` | `observing → expired` | `lifecycle_service`／`none` | validity結束且從未有side effect／義務；`VALIDITY_ENDED_NO_OBLIGATION` | 有unknown/working不得使用 |
| `STR-016B` | `paused → expired` | `lifecycle_service`／`none` | 同上 | 同上 |

Strategy terminal 後只允許唯讀 history、purge eligibility 計算及 copy-to-draft；copy會建立新的 `strategy_id`，不是 terminal 回轉。

## 4. Activation transition table

| Edge ID | From → To | Actor／write provenance | 必要條件／reason code |
|---|---|---|---|
| `ACT-001` | `__create__ → armed` | `runtime_evaluator`／`none` | deterministic key唯一；`ACTIVATION_ARMED` |
| `ACT-002` | `armed → triggered` | `runtime_evaluator`／`none` | fresh edge或已確認immediate；`CONDITION_EDGE_FALSE_TO_TRUE`／`CONDITION_IMMEDIATE_CONFIRMED` |
| `ACT-003` | `armed → missed` | `lifecycle_service`／`none` | slot到期且不ready／盤外／prior non-terminal；`SCHEDULE_SLOT_MISSED_NOT_READY`／`SCHEDULE_SLOT_BLOCKED_BY_PRIOR` |
| `ACT-004` | `armed → cancelled` | `lifecycle_service`／`none` | strategy取消／無義務到期；`ACTIVATION_CANCELLED_BEFORE_TRIGGER` |
| `ACT-005` | `triggered → prepared` | `runtime_evaluator`／`none` | Activation＋OrderIntent＋reservation／claim原子commit；`INTENT_PREPARED_DURABLE` |
| `ACT-006` | `triggered → failed` | `runtime_evaluator`／`none` | pre-dispatch不可恢復validation failure；`ACTIVATION_VALIDATION_FAILED_PRE_DISPATCH` |
| `ACT-007` | `prepared → dispatching` | `runtime_dispatcher`／`automation | manual_user_confirmed | gate_probe` | provenance必須等於關聯OrderIntent owner mapping；nonce、fence、durable DispatchBlocker commit，且ephemeral shared lease當下有效；`DISPATCH_FENCE_COMMITTED` |
| `ACT-008` | `prepared → cancelled` | `interactive_user`或`lifecycle_service`／`none` | adapter從未取得authority；`INTENT_CANCELLED_PROVEN_UNSENT` |
| `ACT-009` | `dispatching → working` | `broker_event_consumer`或`reconciliation_service`／`none` | fixed-account broker working evidence；`BROKER_ORDER_WORKING_CONFIRMED` |
| `ACT-010A` | `dispatching → part_filled` | `broker_event_consumer`或`reconciliation_service`／`none` | confirmed cumulative partial fill；`BROKER_PART_FILL_CONFIRMED` |
| `ACT-010B` | `working → part_filled` | 同上／`none` | 同上 |
| `ACT-010C` | `part_filled → part_filled` | 同上／`none` | cumulative fill單調增加；`BROKER_ADDITIONAL_FILL_CONFIRMED` |
| `ACT-011A` | `dispatching → filled` | `reconciliation_service`／`none` | final full fill；`BROKER_FULL_FILL_CONFIRMED` |
| `ACT-011B` | `working → filled` | 同上／`none` | 同上 |
| `ACT-011C` | `part_filled → filled` | 同上／`none` | 同上 |
| `ACT-012A` | `dispatching → cancelled` | `reconciliation_service`／`none` | final cancel quantities；`BROKER_CANCELLED_CONFIRMED` |
| `ACT-012B` | `working → cancelled` | 同上／`none` | 同上 |
| `ACT-012C` | `part_filled → cancelled` | 同上／`none` | 同上 |
| `ACT-013A` | `dispatching → failed` | `reconciliation_service`／`none` | broker final reject/inactive/failed；`BROKER_REJECTED_CONFIRMED` |
| `ACT-013B` | `working → failed` | 同上／`none` | 同上 |
| `ACT-013C` | `part_filled → failed` | 同上／`none` | 同上 |
| `ACT-014A` | `dispatching → unknown` | `runtime_dispatcher`或`reconciliation_service`／`none` | crash/response loss/correlation conflict；`BROKER_OUTCOME_UNKNOWN` |
| `ACT-014B` | `working → unknown` | `reconciliation_service`／`none` | 同上 |
| `ACT-014C` | `part_filled → unknown` | `reconciliation_service`／`none` | 同上 |
| `ACT-015A` | `unknown → working` | `resolution_service`／`none` | 唯一current evidence；`MANUAL_FINAL_EVIDENCE_APPLIED` |
| `ACT-015B` | `unknown → part_filled` | 同上／`none` | 同上 |
| `ACT-015C` | `unknown → filled` | 同上／`none` | 唯一final evidence；`MANUAL_FINAL_EVIDENCE_APPLIED` |
| `ACT-015D` | `unknown → cancelled` | 同上／`none` | 唯一broker cancel evidence；`MANUAL_FINAL_EVIDENCE_APPLIED` |
| `ACT-015E` | `unknown → failed` | 同上／`none` | 唯一reject evidence，或break-glass且同transaction開`RelinquishedUnknownExposure` blocker；`MANUAL_FINAL_EVIDENCE_APPLIED`／`MANUAL_BREAK_GLASS_RELINQUISHED` |

fill量減少、trade date衝突或duplicate deal無法去重時，Activation轉`unknown`，關聯non-terminal Strategy才轉`manual_intervention`；terminal Strategy不回轉而由SafetyBlocker處理。

## 5. OrderIntent transition table

### 5.1 Operation、owner lineage與outcome

每筆OrderIntent MUST固定：

```ts
type IntentOperation = 'place' | 'update' | 'cancel';
type IntentOwner =
  | { kind: 'strategy_activation'; strategyId: string; activationId: string }
  | { kind: 'manual_confirmation'; routeId: string; confirmationId: string }
  | { kind: 'gate_probe_run'; probeRunId: string; operationNonce: string }
  | { kind: 'lifecycle_resolution'; strategyId: string; resolutionCaseId: string; confirmationId: string };
```

owner、唯一writer actor與dispatch provenance的mapping固定如下；不允許其他組合：

| `owner.kind` | INT-001唯一`actor_kind` | INT-002 `broker_write_provenance` | 額外授權 |
|---|---|---|---|
| `strategy_activation` | `runtime_evaluator` | `automation` | current strategy arm |
| `manual_confirmation` | `interactive_user` | `manual_user_confirmed` | canonical confirmation hash |
| `gate_probe_run` | `gate_runner` | `gate_probe` | current Gate probe manifest |
| `lifecycle_resolution` | `resolution_service` | `manual_user_confirmed` | typed ResolutionCase＋fresh user authorization |

`update`／`cancel`另 MUST綁`targetBrokerOrderId`、fixed account reference、trade date、contract、side、immutable broker IDs、`targetRevision`與expected remaining quantity。`place`在ack後只能建立一個`createdBrokerOrderId`。owner lineage、operation、payload hash與intended provenance在prepared後不可變。

Operation-specific `terminal_outcome` allowlist：

| Operation | Broker-confirmed outcomes | Local/no-effect outcomes | Unknown relinquishment |
|---|---|---|---|
| `place` | `place_filled`、`place_cancelled`、`place_inactive`、`place_rejected`、`place_zero_fill` | `place_cancelled_proven_unsent` | `place_relinquished_unknown` |
| `update` | `update_applied`、`update_rejected`、`target_already_terminal` | `update_cancelled_proven_unsent`、`update_stale_target_prebyte` | `update_relinquished_unknown` |
| `cancel` | `cancel_applied`、`cancel_rejected`、`target_already_terminal` | `cancel_cancelled_proven_unsent`、`cancel_stale_target_prebyte` | `cancel_relinquished_unknown` |

OrderIntent outcome不能取代BrokerOrder state；例如`cancel_applied`表示取消operation完成，BrokerOrder仍須由final reconciliation轉`cancelled`或依cancel-fill race得到其他final狀態。

### 5.2 Typed edges

| Edge ID | From → To | Actor／write provenance | 必要條件／reason code | Retry |
|---|---|---|---|---|
| `INT-001` | `__create__ → prepared` | `runtime_evaluator | interactive_user | gate_runner | resolution_service`／`none` | actor必須符合typed owner mapping；operation＋owner＋payload＋companions durable；`INTENT_PREPARED_DURABLE` | adapter尚無authority |
| `INT-002` | `prepared → dispatching` | `runtime_dispatcher`／必須等於owner對應的`automation | manual_user_confirmed | gate_probe` | ephemeral shared lease有效；nonce/fence/DispatchBlocker原子fsync；`DISPATCH_FENCE_COMMITTED` | nonce一次 |
| `INT-003A` | `prepared → terminal` | `interactive_user | lifecycle_service`／`none` | proven-unsent；使用operation-specific `*_cancelled_proven_unsent` outcome；`INTENT_CANCELLED_PROVEN_UNSENT` | 無broker call |
| `INT-003B` | `prepared → terminal` | `runtime_dispatcher`／`none` | 僅`update | cancel`；adapter取得authority前CAS發現target `controlRevision`已變；使用`update_stale_target_prebyte | cancel_stale_target_prebyte`；`BROKER_TARGET_REVISION_CHANGED` | 不得送byte；place不適用 |
| `INT-004` | `dispatching → acknowledged` | `broker_event_consumer`或`reconciliation_service`／`none` | identifiers＋account correlation durable，DispatchBlocker同transaction clear；`BROKER_ACK_DURABLE` | 否 |
| `INT-005A` | `dispatching → reconciling` | `runtime_dispatcher | reconciliation_service`／`none` | possibly-sent／response loss；durable後才clearDispatchBlocker；`BROKER_RESPONSE_LOST_RECONCILE` | 否 |
| `INT-005B` | `dispatching → reconciling` | `runtime_dispatcher | reconciliation_service`／`none` | authority取得後發現target revision／broker working set變更，無法證明零byte；`BROKER_TARGET_REVISION_CHANGED` | 否；不得用stale-target terminal outcome |
| `INT-006` | `dispatching → unknown` | `reconciliation_service`／`none` | bounded reconcile不唯一；`BROKER_OUTCOME_UNKNOWN` | 否 |
| `INT-007` | `dispatching → terminal` | `reconciliation_service`／`none` | operation-specific final evidence；`BROKER_FINAL_EVIDENCE_APPLIED` | 否 |
| `INT-008A` | `acknowledged → reconciling` | `reconciliation_service`／`none` | gap／generation conflict；`ACKNOWLEDGED_RECONCILIATION_REQUIRED` | 否 |
| `INT-008B` | `acknowledged → reconciling` | `reconciliation_service`／`none` | target revision或working set在operation final前改變；`BROKER_TARGET_REVISION_CHANGED` | 否 |
| `INT-009` | `acknowledged → terminal` | `reconciliation_service`／`none` | operation-specific final evidence；`BROKER_FINAL_EVIDENCE_APPLIED` | 否 |
| `INT-010` | `reconciling → acknowledged` | `reconciliation_service`／`none` | unique working/current evidence；`BROKER_WORKING_EVIDENCE_APPLIED` | 否 |
| `INT-011` | `reconciling → terminal` | `resolution_service`／`none` | unique final evidence，或break-glass＋durable blocker；`MANUAL_FINAL_EVIDENCE_APPLIED`／`MANUAL_BREAK_GLASS_RELINQUISHED` | 原nonceburned |
| `INT-012` | `reconciling → unknown` | `reconciliation_service`／`none` | bounded evidence仍不唯一；`BROKER_CORRELATION_AMBIGUOUS` | 否 |
| `INT-013` | `unknown → reconciling` | `resolution_service`／`none` | 新固定帳號evidence；`MANUAL_RECONCILIATION_STARTED` | 否 |
| `INT-014` | `unknown → terminal` | `resolution_service`／`none` | unique final evidence，或operation-specific`*_relinquished_unknown`＋SafetyBlocker；`MANUAL_FINAL_EVIDENCE_APPLIED`／`MANUAL_BREAK_GLASS_RELINQUISHED` | 否 |

OrderIntent一旦曾到 `dispatching`，永遠不能回 `prepared`，也不能取得第二個 `dispatch_attempt_nonce`。

## 6. BrokerOrder transition table

每筆BrokerOrder另有單調遞增`controlRevision`。建立`update`／`cancel` OrderIntent時，必須先以相同CAS確認預期revision、以same-state edge將`controlRevision + 1`並建立target reservation；這是本機控制權版本，不表示broker order status已改變。只有一個實際owner actor寫入，使用者確認另存authorization evidence。

每筆BrokerOrder也 MUST durable保存base `Share`的`quantityShares`、`filledShares`與`remainingShares`，永遠滿足`quantityShares > 0`及`quantityShares = filledShares + remainingShares`。`pending_submit`／`pre_submitted`／`submitted`的`filledShares`固定為0；`part_filled`必須同時有正的filled與remaining；`filled`必須`filledShares = quantityShares`且`remainingShares = 0`。`BRO-004*`／`BRO-005*`每次都要帶canonical quantity projection，且唯一一筆`BrokerDealOrderPositionEvidence`必須以`broker-order-quantity-evidence/2026-08-12.1`綁定相同broker order ID、固定帳號、交易日、商品、side、correlation及三個數量。`BRO-005*`另須`outcome=filled`與`finality=unique_final`；只有accepted／submitted、零deal、單一event、偽造reason或只有evidence class而沒有這份一致binding，全部不得轉`filled`。

| Edge ID | From → To | Actor／write provenance | 必要條件／reason code |
|---|---|---|---|
| `BRO-001A` | `__create__ → pending_submit` | `broker_event_consumer`或`reconciliation_service`／`none` | fixed-account unique correlation；`BROKER_PENDING_SUBMIT_OBSERVED` |
| `BRO-001B` | `unknown → pending_submit` | `resolution_service`／`none` | 同上 |
| `BRO-002A` | `__create__ → pre_submitted` | `broker_event_consumer`或`reconciliation_service`／`none` | `BROKER_PRE_SUBMITTED_OBSERVED` |
| `BRO-002B` | `pending_submit → pre_submitted` | 同上／`none` | 同上 |
| `BRO-002C` | `unknown → pre_submitted` | `resolution_service`／`none` | 同上 |
| `BRO-003A` | `__create__ → submitted` | `broker_event_consumer`或`reconciliation_service`／`none` | `BROKER_SUBMITTED_OBSERVED` |
| `BRO-003B` | `pending_submit → submitted` | 同上／`none` | 同上 |
| `BRO-003C` | `pre_submitted → submitted` | 同上／`none` | 同上 |
| `BRO-003D` | `unknown → submitted` | `resolution_service`／`none` | 同上 |
| `BRO-004A` | `pending_submit → part_filled` | `broker_event_consumer`或`reconciliation_service`／`none` | deal去重＋unit/account通過；canonical current quantity projection與evidence binding一致；`BROKER_PART_FILL_CONFIRMED` |
| `BRO-004B` | `pre_submitted → part_filled` | 同上／`none` | 同上 |
| `BRO-004C` | `submitted → part_filled` | 同上／`none` | 同上 |
| `BRO-004D` | `part_filled → part_filled` | 同上／`none` | cumulative單調增加；`BROKER_ADDITIONAL_FILL_CONFIRMED` |
| `BRO-004E` | `unknown → part_filled` | `resolution_service`／`none` | unique current evidence及一致quantity projection；`BROKER_RECONCILIATION_EVIDENCE_APPLIED` |
| `BRO-005A` | `pending_submit → filled` | `reconciliation_service`／`none` | unique-final full-fill quantity evidence與projection一致；`BROKER_FULL_FILL_CONFIRMED` |
| `BRO-005B` | `pre_submitted → filled` | 同上／`none` | 同上 |
| `BRO-005C` | `submitted → filled` | 同上／`none` | 同上 |
| `BRO-005D` | `part_filled → filled` | 同上／`none` | 同上 |
| `BRO-005E` | `unknown → filled` | `resolution_service`／`none` | unique final evidence及full-fill quantity projection一致；`BROKER_RECONCILIATION_EVIDENCE_APPLIED` |
| `BRO-006A-D` | `pending_submit | pre_submitted | submitted | part_filled → cancelled` | `reconciliation_service`／`none` | final cancel quantities；`BROKER_CANCELLED_CONFIRMED`；machine registry展開4 edges |
| `BRO-006E` | `unknown → cancelled` | `resolution_service`／`none` | unique final evidence；`BROKER_RECONCILIATION_EVIDENCE_APPLIED` |
| `BRO-007A-D` | `pending_submit | pre_submitted | submitted | part_filled → inactive` | `reconciliation_service`／`none` | final quantities；`BROKER_INACTIVE_CONFIRMED`；machine registry展開4 edges |
| `BRO-007E` | `unknown → inactive` | `resolution_service`／`none` | unique final evidence；`BROKER_RECONCILIATION_EVIDENCE_APPLIED` |
| `BRO-008A-D` | `pending_submit | pre_submitted | submitted | part_filled → failed` | `reconciliation_service`／`none` | final reject/failure；`BROKER_FAILED_CONFIRMED`；machine registry展開4 edges |
| `BRO-008E` | `unknown → failed` | `resolution_service`／`none` | unique final evidence；`BROKER_RECONCILIATION_EVIDENCE_APPLIED` |
| `BRO-009A` | `pending_submit → unknown` | `reconciliation_service`／`none` | gap/account/revision conflict；`BROKER_STATE_UNKNOWN` |
| `BRO-009B` | `pre_submitted → unknown` | 同上／`none` | 同上 |
| `BRO-009C` | `submitted → unknown` | 同上／`none` | 同上 |
| `BRO-009D` | `part_filled → unknown` | 同上／`none` | 同上 |
| `BRO-010A` | `pending_submit → pending_submit` | `runtime_evaluator | interactive_user | gate_runner | resolution_service | lifecycle_service`／`none` | target revision CAS＋owner-matched control intent prepared；operation為update時`BROKER_UPDATE_TARGET_RESERVED`，cancel時`BROKER_CANCEL_TARGET_RESERVED` |
| `BRO-010B` | `pre_submitted → pre_submitted` | 同上／`none` | 同上 |
| `BRO-010C` | `submitted → submitted` | 同上／`none` | 同上 |
| `BRO-010D` | `part_filled → part_filled` | 同上／`none` | 同上；cumulative fill quantity不得因control reservation改變 |

BrokerOrder terminal 只能在 account-scoped final reconciliation後commit。cancel event與fill event競態期間保持non-terminal／`unknown`，不得先宣告terminal再倒退。terminal record收到矛盾的新證據時依1.2第3點進人工處理。

## 7. PendingProtectionCommitment 與 ProtectionObligation

### 7.1 兩者責任邊界

- `PendingProtectionCommitment` 證明「Runtime已在entry前保存怎麼保護」；它從prepare存在到entry最終量全部被materialize、確認zero-fill，或在未dispatch／break-glass條件下release。
- `ProtectionObligation` 證明「Runtime對已送entry及其實際成交承擔的本機追蹤責任」；它與commitment在同一prepare transaction建立，不能等entry成交後才補建。
- commitment terminal不代表obligation terminal。entry有任何confirmed fill時，commitment可在全部fill materialize後terminal，但obligation必須持續到confirmed exit／position zero或明確人工relinquish。

每個entry lineage MUST保存以下base-Share數量，且每次reconciliation原子更新：

```text
requestedShares
= cumulativeFilledShares + openPotentialShares + terminalUnfilledShares

cumulativeFilledShares
= materializedFilledShares + unmaterializedConfirmedFillShares
```

- `openPotentialShares`：broker order仍working或unknown時，保守估計仍可能成交的最大餘量；unknown不得填0。
- `terminalUnfilledShares`：只有唯一final evidence後才可大於0。
- `materializedFilledShares`：已在ProtectionObligation／ExitClaim／confirmed exit中原子反映的shares。
- partial-entry terminal是`cumulativeFilledShares > 0 && terminalUnfilledShares > 0 && openPotentialShares = 0`，commitment可`materialized`但obligation仍non-terminal。
- true zero-fill必須是`cumulativeFilledShares = 0 && openPotentialShares = 0 && terminalUnfilledShares = requestedShares`；broker accepted、IOC timeout或只看不到deal都不算zero-fill。

### 7.2 PendingProtectionCommitment typed edges

| Edge ID | From → To | Actor／write provenance | 必要條件／reason code |
|---|---|---|---|
| `PPC-001` | `__create__ → prepared` | `runtime_evaluator | interactive_user | gate_runner | resolution_service`／`none` | actor必須與entry OrderIntent typed owner一致；entry intent、obligation、適用reservation原子durable；全部fill/protection量=0；`PROTECTION_PLAN_PREPARED_DURABLE` |
| `PPC-002` | `prepared → entry_dispatching` | `runtime_dispatcher`／`none` | entry intent已durable dispatching；`ENTRY_DISPATCH_FENCE_COMMITTED` |
| `PPC-003` | `prepared → released_pre_dispatch` | `interactive_user`或`lifecycle_service`／`none` | proven-unsent；`PROTECTION_PLAN_CANCELLED_PROVEN_UNSENT` |
| `PPC-004` | `entry_dispatching → waiting_entry_result` | `broker_event_consumer`或`reconciliation_service`／`none` | acknowledged/working、尚無confirmed fill；`ENTRY_ACKNOWLEDGED_WAITING_FILL` |
| `PPC-005A` | `entry_dispatching → materializing` | `reconciliation_service`／`none` | confirmed fill＋position一致；`ENTRY_FILL_CONFIRMED_MATERIALIZING` |
| `PPC-005B` | `waiting_entry_result → materializing` | 同上／`none` | 同上 |
| `PPC-006` | `materializing → materializing` | `reconciliation_service`／`none` | 只materialize新增confirmed shares；`ENTRY_ADDITIONAL_FILL_MATERIALIZED` |
| `PPC-007A` | `materializing → materialized` | `reconciliation_service`／`none` | entry terminal、unmaterialized=0、openPotential=0、partial/complete fill全部處理；`ENTRY_FINAL_QUANTITY_MATERIALIZED` |
| `PPC-007B` | `waiting_entry_result → materialized` | `reconciliation_service`／`none` | 僅適用final evidence同transaction含fill並全部materialize；同reason |
| `PPC-008A` | `waiting_entry_result → zero_fill_terminal` | `reconciliation_service`／`none` | true zero-fill等式、claim=0、reservation釋放；`ENTRY_ZERO_FILL_TERMINAL` |
| `PPC-008B` | `materializing → zero_fill_terminal` | `resolution_service`／`none` | 只允許先前錯置的uncommitted projection未生效且unique evidence證明true zero-fill；`ENTRY_ZERO_FILL_TERMINAL` |
| `PPC-008C` | `entry_dispatching → zero_fill_terminal` | `reconciliation_service`／`none` | broker在ack／working顯示前即回final reject／cancel／IOC zero-fill，且unique final evidence滿足true zero-fill等式、claim=0、reservation同transaction釋放；`ENTRY_ZERO_FILL_TERMINAL` |
| `PPC-009A` | `entry_dispatching → unknown` | `reconciliation_service`／`none` | outcome/fill/position不唯一；`ENTRY_RESULT_UNKNOWN` |
| `PPC-009B` | `waiting_entry_result → unknown` | 同上／`none` | 同上 |
| `PPC-009C` | `materializing → unknown` | 同上／`none` | 同上 |
| `PPC-010A` | `unknown → materializing` | `resolution_service`／`none` | unique current/final evidence；`MANUAL_FINAL_EVIDENCE_APPLIED` |
| `PPC-010B` | `unknown → materialized` | 同上／`none` | unique final evidence且所有fill materialized；同reason |
| `PPC-010C` | `unknown → zero_fill_terminal` | 同上／`none` | unique true zero-fill evidence；同reason |
| `PPC-011` | `unknown → released_manual` | `resolution_service`／`none` | valid `BreakGlassAuthorization`、二次確認snapshot；同transaction建立`RelinquishedUnknownExposure` blocker；`MANUAL_BREAK_GLASS_RELINQUISHED` |

### 7.3 ProtectionObligation typed edges

`POB-011A-F`的`reasonCodes`精確allowlist為：`ENTRY_RESULT_UNKNOWN`、`EXIT_CLAIM_UNKNOWN`、`TRAILING_GAP_EXTREME_UNKNOWN`、`EXTERNAL_POSITION_DRIFT`、`PROTECTION_UNPROTECTED_REMAINDER`、`POSITION_OR_UNIT_UNKNOWN`、`EXTERNAL_WORKING_SET_INCOMPLETE`、`DB_INTEGRITY_FAILED`。每個edge必須同transaction建立對應kind／scope的ResolutionCase與SafetyBlocker。

| Edge ID | From → To | Actor／write provenance | 必要條件／reason code |
|---|---|---|---|
| `POB-001` | `__create__ → pending_entry` | `runtime_evaluator | interactive_user | gate_runner | resolution_service`／`none` | actor必須與entry OrderIntent typed owner一致；與entry intent／commitment原子保存；所有量=0；`PROTECTION_OBLIGATION_CREATED` |
| `POB-002` | `pending_entry → monitoring` | `reconciliation_service`／`none` | fill＋position一致；claim/reservation同transaction；`PROTECTION_CLAIM_CREATED_FROM_FILL` |
| `POB-003A` | `pending_entry → reconciling` | `reconciliation_service`／`none` | fill/position/working-set需對帳；`PROTECTION_RECONCILIATION_REQUIRED` |
| `POB-003B` | `monitoring → reconciling` | 同上／`none` | 同上 |
| `POB-003C` | `exit_dispatching → reconciling` | 同上／`none` | 同上 |
| `POB-003D` | `exit_working → reconciling` | 同上／`none` | 同上 |
| `POB-003E` | `partially_exited → reconciling` | 同上／`none` | 同上 |
| `POB-004` | `pending_entry → zero_fill_terminal` | `reconciliation_service`／`none` | true zero-fill等式、reservation/claim=0；`ENTRY_ZERO_FILL_TERMINAL` |
| `POB-005` | `monitoring → monitoring` | `reconciliation_service`或`runtime_evaluator`／`none` | partial fill materialized或eligible extreme更新，quantity invariant成立；`PROTECTION_MONITORING_REVISION_UPDATED` |
| `POB-006` | `monitoring → exit_dispatching` | `runtime_evaluator`／`none` | entry OrderIntent／BrokerOrder／PendingProtectionCommitment皆terminal、`openPotentialShares = 0`、`unmaterializedConfirmedFillShares = 0`；再將單一Activation winner＋exit OrderIntent＋claim intent_reserved原子commit；`OCO_WINNER_SELECTED` |
| `POB-007` | `exit_dispatching → exit_working` | `broker_event_consumer`或`reconciliation_service`／`none` | unique working evidence；`EXIT_BROKER_WORKING_CONFIRMED` |
| `POB-008A` | `exit_dispatching → partially_exited` | `reconciliation_service`／`none` | confirmed partial exit；`EXIT_PART_FILL_CONFIRMED` |
| `POB-008B` | `exit_working → partially_exited` | 同上／`none` | 同上 |
| `POB-008C` | `partially_exited → partially_exited` | `reconciliation_service`／`none` | cumulative confirmed exit單調增加、仍有remainder；`EXIT_ADDITIONAL_FILL_CONFIRMED` |
| `POB-009` | `partially_exited → monitoring` | `reconciliation_service`／`none` | valid `UserRearmAuthorization`、原order terminal、新remainder generation、明確re-arm；`PROTECTION_REMAINDER_REARM_REQUIRED` |
| `POB-010A` | `exit_dispatching → fulfilled` | `reconciliation_service`／`none` | exited=filled或position=0，無active/unknown claims；`PROTECTION_FULLY_EXITED_CONFIRMED` |
| `POB-010B` | `exit_working → fulfilled` | 同上／`none` | 同上 |
| `POB-010C` | `partially_exited → fulfilled` | 同上／`none` | 同上 |
| `POB-011A` | `pending_entry → safety_blocked` | `resolution_service`／`none` | 建立open ResolutionCase＋SafetyBlocker；使用本節明列的`POB-011A-F` reason allowlist |
| `POB-011B` | `monitoring → safety_blocked` | 同上／`none` | 同上 |
| `POB-011C` | `exit_dispatching → safety_blocked` | 同上／`none` | 同上 |
| `POB-011D` | `exit_working → safety_blocked` | 同上／`none` | 同上 |
| `POB-011E` | `partially_exited → safety_blocked` | 同上／`none` | 同上 |
| `POB-011F` | `reconciling → safety_blocked` | 同上／`none` | bounded evidence不足；使用本節明列的`POB-011A-F` reason allowlist |
| `POB-012A-F` | `reconciling → pending_entry | monitoring | exit_working | partially_exited | fulfilled | zero_fill_terminal` | `resolution_service`／`none` | unique evidence；`PROTECTION_RECONCILIATION_EVIDENCE_APPLIED`；machine registry展開6 edges |
| `POB-013A-F` | `safety_blocked → pending_entry | monitoring | exit_working | partially_exited | fulfilled | zero_fill_terminal` | `resolution_service`／`none` | ResolutionCase由final evidence解決；`MANUAL_FINAL_EVIDENCE_APPLIED`；machine registry展開6 edges |
| `POB-014` | `safety_blocked → released_manual` | `resolution_service`／`none` | valid `BreakGlassAuthorization`、二次確認、snapshot、claims/reservation處理；建立durable unknown-exposure blocker；`MANUAL_BREAK_GLASS_RELINQUISHED` |

### 7.4 `protectedShares` 與未受保護投影

`protectedShares`不是可由UI寫入或沿用last-known的欄位；它等於規格中的`activelyCoveredShares`：

```text
protectedShares = SUM(DISTINCT exit_claim_id + remainder_generation 的 activeShares)

filledShares
= confirmedExitedShares + protectedShares + RuntimeTrackedUnprotectedRemainder
```

只可計入：

- fresh Runtime readiness下的`monitoring_reserved`；
- 已durable prepared且仍valid的`intent_reserved`；
- account-scoped reconciliation唯一確認仍working的`broker_working`。

不得計入：設定草稿、stale/offline monitoring、`unknown`、`released`、`consumed`、重複representation、external claim中不屬於此obligation的shares。若任何component不可信，`protectedShares`本身標`unknown`、obligation進`reconciling`／`safety_blocked`，不能把unknown當0後聲稱fulfilled。`RuntimeTrackedUnprotectedRemainder > 0`時一般stop／rollback／uninstall仍阻擋。

## 8. EntryExposureReservation transition table

| Edge ID | From → To | Actor／write provenance | 必要條件／reason code |
|---|---|---|---|
| `EER-001` | `__create__ → reserved` | `runtime_evaluator | interactive_user | gate_runner | resolution_service`／`none` | actor必須與關聯entry OrderIntent typed owner一致；worst-case policy CAS；`ENTRY_EXPOSURE_RESERVED` |
| `EER-002` | `reserved → partially_consumed` | `reconciliation_service`／`none` | confirmed partial fill，consume不超原量；`ENTRY_RESERVATION_PARTIALLY_CONSUMED` |
| `EER-003A` | `reserved → consumed` | `reconciliation_service`／`none` | reservation全轉actual risk；`ENTRY_RESERVATION_FULLY_CONSUMED` |
| `EER-003B` | `partially_consumed → consumed` | 同上／`none` | 同上 |
| `EER-004A` | `reserved → released` | `reconciliation_service`或`lifecycle_service`／`none` | proven-unsent／true zero-fill／final unfilled；`ENTRY_RESERVATION_RELEASED` |
| `EER-004B` | `partially_consumed → released` | 同上／`none` | 只release明確terminal remainder；同reason |
| `EER-005A` | `reserved → unknown` | `reconciliation_service`／`none` | outcome/position/unit/policy不明；`ENTRY_RESERVATION_UNKNOWN` |
| `EER-005B` | `partially_consumed → unknown` | 同上／`none` | 同上 |
| `EER-006A` | `unknown → partially_consumed` | `resolution_service`／`none` | unique evidence；`MANUAL_FINAL_EVIDENCE_APPLIED` |
| `EER-006B` | `unknown → consumed` | 同上／`none` | 同上 |
| `EER-006C` | `unknown → released` | 同上／`none` | unique evidence，或break-glass＋unknown-exposure blocker；`MANUAL_FINAL_EVIDENCE_APPLIED`／`MANUAL_BREAK_GLASS_RELINQUISHED` |

同一 reservation ID 的上限不得增加。quantity、price、policy或confirmation改變必須讓舊draft confirmation失效並建立新 intent／reservation，不得原地擴張。

## 9. ExitClaim／ExternalSellClaim transition table

### 9.1 Lineage 與 generation

- `exit_claim_id` 表示固定account＋contract＋long-position的唯一shares lineage；`remainder_generation`表示一次可競爭的剩餘量。
- Runtime protection由`monitoring_reserved`開始；外部working sell經完整account-scoped reconciliation後，直接以`origin=external`、`broker_working`建立。
- 同一generation的`reservedShares = consumedShares + releasedShares + activeShares`永遠成立；不同representation不能重複計數。
- partial fill後，舊generation在broker order terminal且證據完整時settle；剩餘量要繼續保護時建立同一lineage的新generation，不得把舊winner重新送出。
- 同一generation只建立**一個Activation**。所有leg先寫`ProtectionLegEvaluation(candidate)`；同一CAS把一筆改`winner`、其他改`suppressed`並把`winnerLegId`寫入該Activation。leg evaluation沒有broker authority，不是Activation，也不建立自己的OrderIntent。

### 9.2 Transition table

| Edge ID | From → To | Actor／write provenance | 必要條件／reason code |
|---|---|---|---|
| `EXC-001` | `__create__ → monitoring_reserved` | `reconciliation_service`／`none` | confirmed fill＋position一致；`EXIT_CLAIM_MONITORING_RESERVED` |
| `EXC-002` | `__create__ → broker_working` | `reconciliation_service`／`none` | `origin=external`、complete working-set、unique IDs；`EXTERNAL_SELL_CLAIM_DISCOVERED` |
| `EXC-003` | `monitoring_reserved → intent_reserved` | `runtime_evaluator`／`none` | single Activation＋leg winner＋intent同CAS；`OCO_WINNER_SELECTED` |
| `EXC-004` | `monitoring_reserved → released` | `reconciliation_service`或`lifecycle_service`／`none` | 未dispatch且position確定減少、無競態；`EXIT_CLAIM_RELEASED_UNUSED` |
| `EXC-005` | `intent_reserved → broker_working` | `broker_event_consumer`或`reconciliation_service`／`none` | unique working evidence；`EXIT_CLAIM_BROKER_WORKING` |
| `EXC-006` | `intent_reserved → released` | `interactive_user`或`lifecycle_service`／`none` | proven-unsent；`EXIT_INTENT_CANCELLED_PROVEN_UNSENT` |
| `EXC-007A` | `intent_reserved → unknown` | `reconciliation_service`／`none` | possibly-sent/correlation不明；`EXIT_CLAIM_UNKNOWN` |
| `EXC-007B` | `broker_working → unknown` | 同上／`none` | cancel-fill/position不明；同reason |
| `EXC-008` | `broker_working → consumed` | `reconciliation_service`／`none` | final consumed/released partition；`EXIT_CLAIM_CONSUMED_CONFIRMED` |
| `EXC-009` | `broker_working → released` | `reconciliation_service`／`none` | final zero-fill/terminal；`EXIT_CLAIM_RELEASED_AFTER_TERMINAL` |
| `EXC-010A` | `unknown → broker_working` | `resolution_service`／`none` | unique current evidence；`MANUAL_FINAL_EVIDENCE_APPLIED` |
| `EXC-010B` | `unknown → consumed` | 同上／`none` | unique final evidence；同reason |
| `EXC-010C` | `unknown → released` | 同上／`none` | unique final evidence，或break-glass＋unknown-exposure blocker；`MANUAL_FINAL_EVIDENCE_APPLIED`／`MANUAL_BREAK_GLASS_RELINQUISHED` |

任何 `unknown` claim 都不算`protectedShares`，並阻擋同account／contract的新exit。break-glass release必須標示broker outcome unknown且留下durable blocker，不得顯示為cancelled／zero-fill或自動恢復可寫。

## 10. Deterministic Activation ID

### 10.1 Canonical format

Runtime MUST使用domain-separated、versioned stable serialization產生ID：

```text
activation_id = base32lower(
  SHA-256(
    UTF8("realtimestock.smart-order.activation/v1\n") ||
    canonical_json(key_material)
  )
)
```

`canonical_json` MUST固定UTF-8、object key排序、無額外空白、integer與decimal string格式、`Asia/Taipei`日期格式；不得包含完整帳號、姓名、capability、identity key、CA、token或browser提供的隨機值。ID只能由Runtime產生，client傳入值只能作request correlation，不能成為authority。

共同key material：

```json
{
  "schema": "activation/v1",
  "strategyId": "opaque-local-id",
  "strategyDefinitionHash": "sha256-of-immutable-non-draft-definition",
  "activationKind": "edge|daily_edge|schedule_slot|parent_child|protection_remainder",
  "logicalKey": {}
}
```

`strategyDefinitionHash`來自第2.1節`draft → observing`時封存的immutable definition；一般state revision、observation cursor、RuntimeEpoch、broker event、pause／resume與reconciliation都不得改變它，也不得進Activation ID。需要改設定時只能copy-to-draft取得新`strategyId`與新definition hash，因此不會因mutable Strategy revision使同一logical activation在restart前後換ID。

### 10.2 各類型 logical key

| 類型 | `logicalKey` | 去重規則 |
|---|---|---|
| 快速單／一般edge | `armGeneration + tradeDate + edgeGeneration` | `edgeGeneration`只可由單一writer transaction在durable false／rearmed→true時增加一次；duplicate／reordered observation重用既有ID |
| 多條件 OR／AND | `armGeneration + tradeDate + edgeGeneration` | 同一evaluation cycle同時命中的OR legs共用一個generation；命中observation IDs只作audit，不影響由callback先後決定ID |
| 長效單每日唯一activation | `tradeDate + dailyOrdinal=0` | 同一strategy、同一交易日最多一個ID；ROD到期、IOC零成交或failed仍消耗該ID |
| 定時定量slot | `tradeDate + scheduleRuleRevision + slotIndex + nominalSlotTime` | missed／skipped／triggered都使用同一ID；實際收到callback時間不進ID，故不得補送產生新ID |
| 母子單子單 | `parentActivationId + childGeneration=0` | 母單全部實際成交只可建立一次；duplicate deal event重用相同ID |
| 停損／停利／移動出場 OCO | `protectionGroupId + remainderGeneration` | 每generation只建立一個Activation；CAS把`winnerLegId`寫入Activation，candidate child records分別成為`winner`／`suppressed`，suppressed child沒有broker authority |

建立Activation與其unique key MUST在同一transaction。hash collision、相同ID但canonical key不同、counter回退或`strategyDefinitionHash`矛盾時，以`ACTIVATION_ID_CONFLICT` fail closed；若關聯Strategy仍為non-terminal，依`STR-009A-F`進`manual_intervention`，若已terminal則建立`terminal_evidence_conflict` ResolutionCase與SafetyBlocker且原Strategy不回轉。不得產生帶隨機suffix的新ID繞過去重。

## 11. RuntimeEpoch transition table

RuntimeEpoch綁定process instance、OS lock、DB fencing token、API generation、mode marker revision、manifest revision與啟動時間；每個OrderIntent dispatch都必須引用當時epoch。

| Edge ID | From → To | Actor／write provenance | 必要條件／reason code |
|---|---|---|---|
| `RTE-001` | `__create__ → starting` | `lifecycle_service`／`none` | 新process、尚無sender authority；`RUNTIME_EPOCH_CREATED` |
| `RTE-002` | `starting → fenced` | `lifecycle_service`／`none` | OS single-writer lock、DB fence、private repository、simulation plan有效；`RUNTIME_SINGLE_WRITER_FENCE_ACQUIRED` |
| `RTE-003A` | `starting → failed_stop` | `lifecycle_service`／`none` | startup gate失敗；`RUNTIME_STARTUP_FAIL_CLOSED` |
| `RTE-003B` | `fenced → failed_stop` | 同上／`none` | 同上 |
| `RTE-004` | `fenced → reconciling` | `reconciliation_service`／`none` | full account/domain reconciliation開始；`RUNTIME_RECONCILIATION_STARTED` |
| `RTE-005` | `reconciling → observe_only` | `reconciliation_service`／`none` | reconciliation有界完成，open blockers精確列出，並原子寫`fullReconciliationCompletedInEpoch = true`與evidence hash；`RUNTIME_RECONCILED_OBSERVE_ONLY` |
| `RTE-006` | `observe_only → ready_unarmed` | `runtime_evaluator`／`none` | 全部gate/readiness完整、無open Dispatch/Safety blocker；`RUNTIME_READY_REARM_REQUIRED` |
| `RTE-007` | `ready_unarmed → write_armed` | `interactive_user`／`none` | 明確arm write master；`USER_WRITE_MASTER_ARMED` |
| `RTE-008` | `write_armed → ready_unarmed` | `interactive_user`或`runtime_evaluator`／`none` | disarm或pause automation；`USER_WRITE_MASTER_DISARMED`／`POLICY_PAUSE_AUTOMATION` |
| `RTE-009A` | `ready_unarmed → observe_only` | `runtime_evaluator`／`none` | readiness/gate失效；`RUNTIME_READINESS_REVOKED` |
| `RTE-009B` | `write_armed → observe_only` | 同上／`none` | 同上 |
| `RTE-010A` | `observe_only → reconciling` | `reconciliation_service`／`none` | gap/wake/watchdog/drift；`RUNTIME_RECONCILIATION_REQUIRED` |
| `RTE-010B` | `ready_unarmed → reconciling` | 同上／`none` | 同上 |
| `RTE-010C` | `write_armed → reconciling` | 同上／`none` | 同上 |
| `RTE-011A-F` | `starting | fenced | reconciling | observe_only | ready_unarmed | write_armed → quiescing` | `lifecycle_service`／`none` | lifecycle request先禁止新ephemeral lease；`RUNTIME_QUIESCE_REQUESTED`；machine registry展開6 edges |
| `RTE-012` | `quiescing → stopped` | `lifecycle_service`／`none` | process lease歸零、無open durable DispatchBlocker、required drain通過、snapshot durable，且本epoch已full reconcile；唯一例外是sender authority從未取得且durable repository可證明完全沒有歷史side effect／obligation；`RUNTIME_GRACEFUL_STOP_COMPLETE` |
| `RTE-013A` | `quiescing → observe_only` | `lifecycle_service`／`none` | drain被working/unknown/obligation/SafetyBlocker阻擋，且`fullReconciliationCompletedInEpoch = true`；`RUNTIME_QUIESCE_BLOCKED_OBLIGATION` |
| `RTE-013B` | `quiescing → reconciling` | `lifecycle_service`／`none` | stop被阻擋且本epoch尚未完成full reconciliation；`RUNTIME_RECONCILIATION_REQUIRED` |
| `RTE-014A-F` | `fenced | reconciling | observe_only | ready_unarmed | write_armed | quiescing → superseded` | `lifecycle_service`／`none` | API generation改變；`RUNTIME_API_GENERATION_SUPERSEDED`；machine registry展開6 edges |
| `RTE-015A-G` | `starting | fenced | reconciling | observe_only | ready_unarmed | write_armed | quiescing → failed_stop` | `lifecycle_service`／`none` | **只限DB仍可可靠commit此transition**且sender fence／policy失效；`RUNTIME_SENDER_FAIL_STOP`；machine registry展開7 edges。DB/fsync失敗時不得宣稱此durable state |
| `RTE-016` | `quiescing → failed_stop` | `lifecycle_service`／`none` | valid `BreakGlassAuthorization`；此epoch transition、所有被relinquish的entity transition、ResolutionCase、`RelinquishedUnknownExposure.open`、burned nonces與audit snapshot必須在**同一SQLite transaction** commit，該commit是forced-stop唯一linearization point；`RUNTIME_BREAK_GLASS_FORCED_STOP` |

terminal epoch不可重新arm；watchdog／LaunchAgent只能建立新epoch，且新epoch一定從`starting → ... → observe_only`走完reconciliation，不繼承舊`write_armed`。任何進入`observe_only`的edge都必須驗證同epoch的`fullReconciliationCompletedInEpoch = true`；`starting／fenced → quiescing → observe_only`的捷徑不存在。若SQLite transaction／fsync失敗，process只能撤銷socket authority並在記憶體fail-stop／退出；權威RuntimeEpoch仍是最後成功commit的state，新epoch須從open blocker與broker reconciliation恢復，UI不得聲稱舊epoch已durable `failed_stop`。

### 11.2 Ephemeral mode lease 與 DurableDispatchBlocker

OS／process shared execution lease與exclusive mode-switch lease是**ephemeral synchronization**：process crash後由OS釋放，不能被DB宣稱仍持有。durable safety靠獨立DB record：

```ts
type DurableDispatchBlocker = {
  intentId: string;
  dispatchAttemptNonce: string;
  runtimeEpochId: string;
  senderFence: string;
  apiGeneration: string;
  modeMarkerRevision: string;
  accountOpaqueRef: string;
  state: 'open' | 'cleared_acknowledged' | 'cleared_terminal' |
         'cleared_unknown_durable' | 'cleared_reconciling_durable';
};
```

流程固定如下：

1. dispatcher先取得ephemeral shared lease並重驗simulation；
2. 在同一fsync transaction把OrderIntent轉dispatching並建立`DurableDispatchBlocker.open`，之後adapter才可取得socket authority；
3. 正常程序持有shared lease，直到同一transaction把intent結果durable成acknowledged／terminal／unknown／reconciling並把blocker轉相應cleared state；
4. 若process crash，shared lease會消失，但`open` blocker保留。新Runtime啟動、exclusive mode switch、任何新dispatch都必須先掃描並拒絕open blocker；不得以「OS lock已可取得」推論先前request未送；
5. 新Runtime只能由bounded fixed-account reconciliation將intent與blocker一起轉成明確durable state。即使blocker已`cleared_unknown_durable`，non-terminal intent與SafetyBlocker仍會依生命週期規則阻擋production-readonly／stop或衝突write。

DurableDispatchBlocker typed edges：

| Edge ID | From → To | Actor／write provenance | 必要條件／reason code |
|---|---|---|---|
| `DDB-001` | `__create__ → open` | `runtime_dispatcher`／與intent dispatch相同 | 與`INT-002`同transaction；`DURABLE_DISPATCH_BLOCKER_OPENED` |
| `DDB-002` | `open → cleared_acknowledged` | `broker_event_consumer`或`reconciliation_service`／`none` | 與`INT-004`同transaction；`DURABLE_DISPATCH_BLOCKER_CLEARED_ACK` |
| `DDB-003` | `open → cleared_terminal` | `reconciliation_service`／`none` | 與`INT-007`同transaction；`DURABLE_DISPATCH_BLOCKER_CLEARED_TERMINAL` |
| `DDB-004` | `open → cleared_unknown_durable` | `reconciliation_service`／`none` | 與`INT-006`同transaction；`DURABLE_DISPATCH_BLOCKER_CLEARED_UNKNOWN` |
| `DDB-005` | `open → cleared_reconciling_durable` | `reconciliation_service`／`none` | 與`INT-005A`或`INT-005B`同transaction；`DURABLE_DISPATCH_BLOCKER_CLEARED_RECONCILING` |

## 12. Reason、SafetyBlocker 與 resolution boundary

### 12.1 Complete reason registry v3

每個reason definition固定：`code`、`category`、`defaultSeverity`、`blockingScope`、`requiredEvidenceClass`、`resolutionPolicyId`。下表是`2026-08-11.4`的**完整allowlist與完整metadata**，不是範例；同列每一個code各自取得完全相同且明確的metadata，且每個code恰好只能出現一次。registry build必須拒絕missing／duplicate code、missing metadata、edge引用未列code或edge的`evidenceClassesByReason`與本表不一致。人類可讀訊息只能作顯示，安全決策不得parse文字。

| 完整 reason codes | `category` | `defaultSeverity` | `blockingScope` | `requiredEvidenceClass` | `resolutionPolicyId` |
|---|---|---|---|---|---|
| `USER_CONFIRMATION_ACCEPTED`、`USER_PAUSE_REQUESTED`、`USER_RESUME_AND_ARM_CONFIRMED`、`USER_CANCEL_STRATEGY_REQUESTED`、`USER_DRAFT_DISCARDED`、`RECOVERY_RECONCILED_REARM_REQUIRED`、`STRATEGY_CANCEL_DRAIN_COMPLETE`、`STRATEGY_TARGET_COMPLETED`、`EXPIRY_DRAIN_COMPLETE` | `strategy_control` | `info` | `strategy` | `UserAuthorizationEvidence` | `strategy_state_policy` |
| `USER_WRITE_MASTER_ARMED`、`USER_WRITE_MASTER_DISARMED`、`POLICY_PAUSE_AUTOMATION` | `runtime_control` | `warning` | `global` | `RuntimeControlAuthorizationEvidence` | `runtime_rearm_policy` |
| `ACTIVATION_ARMED`、`ACTIVATION_CANCELLED_BEFORE_TRIGGER`、`ACTIVATION_VALIDATION_FAILED_PRE_DISPATCH` | `activation_lifecycle` | `info` | `strategy` | `StrategyDefinitionEvidence` | `activation_lifecycle_policy` |
| `ACTIVATION_ID_CONFLICT` | `activation_conflict` | `critical` | `strategy` | `RepositoryConflictEvidence` | `terminal_conflict_resolution` |
| `CONDITION_EDGE_FALSE_TO_TRUE`、`CONDITION_IMMEDIATE_CONFIRMED` | `activation_observation` | `info` | `strategy` | `CanonicalObservationEvidence` | `activation_edge_policy` |
| `SCHEDULE_SLOT_MISSED_NOT_READY`、`SCHEDULE_SLOT_BLOCKED_BY_PRIOR`、`VALIDITY_ENDED_NO_OBLIGATION`、`VALIDITY_ENDED_WITH_OBLIGATION` | `trusted_time` | `warning` | `strategy` | `TrustedTimeCalendarEvidence` | `schedule_validity_policy` |
| `INTENT_PREPARED_DURABLE`、`INTENT_CANCELLED_PROVEN_UNSENT` | `intent_lifecycle` | `info` | `account_contract` | `IntentSnapshotEvidence` | `intent_lifecycle_policy` |
| `BROKER_UPDATE_TARGET_RESERVED`、`BROKER_CANCEL_TARGET_RESERVED`、`BROKER_TARGET_REVISION_CHANGED` | `control_target_revision` | `warning` | `account_contract` | `ControlTargetRevisionEvidence` | `control_target_reconcile` |
| `DISPATCH_FENCE_COMMITTED` | `dispatch_authority` | `critical` | `account_contract` | `DispatchFenceEvidence` | `no_automatic_retry` |
| `BROKER_ACK_DURABLE`、`BROKER_WORKING_EVIDENCE_APPLIED`、`BROKER_FINAL_EVIDENCE_APPLIED` | `intent_broker_evidence` | `info` | `account_contract` | `BrokerAccountSnapshotEvidence` | `broker_account_reconcile` |
| `BROKER_RESPONSE_LOST_RECONCILE`、`ACKNOWLEDGED_RECONCILIATION_REQUIRED`、`BROKER_OUTCOME_UNKNOWN`、`BROKER_CORRELATION_AMBIGUOUS`、`BROKER_ACCOUNT_MISMATCH` | `intent_uncertainty` | `critical` | `account_contract` | `BrokerAccountSnapshotEvidence` | `manual_or_broker_reconcile` |
| `BROKER_PENDING_SUBMIT_OBSERVED`、`BROKER_PRE_SUBMITTED_OBSERVED`、`BROKER_SUBMITTED_OBSERVED`、`BROKER_ORDER_WORKING_CONFIRMED` | `broker_working_state` | `info` | `account_contract` | `BrokerAccountSnapshotEvidence` | `broker_account_reconcile` |
| `BROKER_PART_FILL_CONFIRMED`、`BROKER_ADDITIONAL_FILL_CONFIRMED`、`BROKER_FULL_FILL_CONFIRMED`、`BROKER_CANCELLED_CONFIRMED`、`BROKER_INACTIVE_CONFIRMED`、`BROKER_FAILED_CONFIRMED`、`BROKER_REJECTED_CONFIRMED`、`BROKER_RECONCILIATION_EVIDENCE_APPLIED` | `broker_quantity_finality` | `warning` | `account_contract` | `BrokerDealOrderPositionEvidence` | `broker_account_reconcile` |
| `BROKER_STATE_UNKNOWN` | `broker_state_uncertainty` | `critical` | `account_contract` | `BrokerDealOrderPositionEvidence` | `manual_or_broker_reconcile` |
| `BROKER_FINAL_EVIDENCE_CONFLICT` | `terminal_evidence_conflict` | `critical` | `account_contract` | `ConflictingTerminalEvidence` | `terminal_conflict_resolution` |
| `PROTECTION_PLAN_PREPARED_DURABLE`、`PROTECTION_PLAN_CANCELLED_PROVEN_UNSENT`、`PROTECTION_OBLIGATION_CREATED`、`ENTRY_DISPATCH_FENCE_COMMITTED`、`ENTRY_ACKNOWLEDGED_WAITING_FILL` | `protection_lifecycle` | `warning` | `account_contract` | `ProtectionPlanLedgerEvidence` | `protection_lifecycle_policy` |
| `ENTRY_FILL_CONFIRMED_MATERIALIZING`、`ENTRY_ADDITIONAL_FILL_MATERIALIZED`、`ENTRY_FINAL_QUANTITY_MATERIALIZED`、`ENTRY_ZERO_FILL_TERMINAL`、`PROTECTION_CLAIM_CREATED_FROM_FILL` | `entry_quantity_projection` | `critical` | `account_contract` | `BrokerDealOrderPositionEvidence` | `entry_quantity_reconcile` |
| `ENTRY_RESULT_UNKNOWN`、`PROTECTION_RECONCILIATION_REQUIRED`、`PROTECTION_UNPROTECTED_REMAINDER` | `protection_uncertainty` | `critical` | `account_contract` | `ProtectionQuantityInvariantEvidence` | `manual_or_protection_reconcile` |
| `PROTECTION_MONITORING_REVISION_UPDATED`、`PROTECTION_RECONCILIATION_EVIDENCE_APPLIED`、`PROTECTION_REMAINDER_REARM_REQUIRED`、`PROTECTION_FULLY_EXITED_CONFIRMED` | `protection_projection` | `warning` | `account_contract` | `ProtectionQuantityInvariantEvidence` | `protection_reconcile` |
| `ENTRY_EXPOSURE_RESERVED`、`ENTRY_RESERVATION_PARTIALLY_CONSUMED`、`ENTRY_RESERVATION_FULLY_CONSUMED`、`ENTRY_RESERVATION_RELEASED` | `entry_reservation` | `warning` | `account_contract` | `ReservationLedgerEvidence` | `entry_reservation_policy` |
| `ENTRY_RESERVATION_UNKNOWN` | `entry_reservation_uncertainty` | `critical` | `account_contract` | `ReservationLedgerEvidence` | `manual_or_protection_reconcile` |
| `EXIT_CLAIM_MONITORING_RESERVED`、`EXTERNAL_SELL_CLAIM_DISCOVERED`、`EXIT_CLAIM_RELEASED_UNUSED`、`EXIT_CLAIM_BROKER_WORKING`、`EXIT_INTENT_CANCELLED_PROVEN_UNSENT`、`EXIT_CLAIM_CONSUMED_CONFIRMED`、`EXIT_CLAIM_RELEASED_AFTER_TERMINAL` | `exit_claim` | `warning` | `account_contract` | `ExitClaimLedgerEvidence` | `exit_claim_reconcile` |
| `EXIT_CLAIM_UNKNOWN` | `exit_claim_uncertainty` | `critical` | `account_contract` | `ExitClaimLedgerEvidence` | `manual_or_protection_reconcile` |
| `OCO_WINNER_SELECTED` | `oco_selection` | `critical` | `account_contract` | `OcoWinnerCasEvidence` | `single_activation_oco_policy` |
| `EXIT_BROKER_WORKING_CONFIRMED`、`EXIT_PART_FILL_CONFIRMED`、`EXIT_ADDITIONAL_FILL_CONFIRMED` | `exit_quantity_projection` | `critical` | `account_contract` | `BrokerDealOrderPositionEvidence` | `exit_quantity_reconcile` |
| `RUNTIME_EPOCH_CREATED`、`RUNTIME_SINGLE_WRITER_FENCE_ACQUIRED`、`RUNTIME_STARTUP_FAIL_CLOSED`、`RUNTIME_API_GENERATION_SUPERSEDED`、`RUNTIME_SENDER_FAIL_STOP` | `runtime_epoch` | `critical` | `global` | `RuntimeEpochFenceEvidence` | `runtime_epoch_policy` |
| `RUNTIME_RECONCILIATION_STARTED`、`RUNTIME_RECONCILED_OBSERVE_ONLY`、`RUNTIME_READY_REARM_REQUIRED`、`RUNTIME_READINESS_REVOKED`、`RUNTIME_RECONCILIATION_REQUIRED` | `runtime_reconciliation` | `critical` | `global` | `FullAccountReconciliationEvidence` | `runtime_reconcile_before_arm` |
| `RUNTIME_QUIESCE_REQUESTED`、`RUNTIME_GRACEFUL_STOP_COMPLETE`、`RUNTIME_QUIESCE_BLOCKED_OBLIGATION` | `runtime_lifecycle` | `warning` | `global` | `LifecycleDrainEvidence` | `runtime_drain_policy` |
| `RUNTIME_BREAK_GLASS_FORCED_STOP` | `runtime_break_glass` | `critical` | `global` | `BreakGlassRelinquishmentEvidence` | `forced_stop_with_durable_blocker` |
| `DURABLE_DISPATCH_BLOCKER_OPENED`、`DURABLE_DISPATCH_BLOCKER_CLEARED_ACK`、`DURABLE_DISPATCH_BLOCKER_CLEARED_TERMINAL`、`DURABLE_DISPATCH_BLOCKER_CLEARED_UNKNOWN`、`DURABLE_DISPATCH_BLOCKER_CLEARED_RECONCILING` | `durable_dispatch_blocker` | `critical` | `account` | `DurableDispatchTransactionEvidence` | `dispatch_blocker_policy` |
| `READINESS_LOST_RECONCILIATION_REQUIRED`、`SENDER_FENCE_LOST`、`RISK_POLICY_BLOCKED` | `runtime_readiness` | `critical` | `global` | `RuntimeReadinessEvidence` | `runtime_reconcile_before_arm` |
| `SIMULATION_ATTESTATION_FAILED`、`MODE_GENERATION_CHANGED`、`GATE_MANIFEST_INVALID` | `mode_gate` | `critical` | `global` | `ModeGenerationGateEvidence` | `gate_revalidation` |
| `IDENTITY_MAPPING_CONFLICT` | `identity_conflict` | `critical` | `identity_group` | `IdentityMappingEvidence` | `identity_gate_revalidation` |
| `EXTERNAL_WORKING_SET_INCOMPLETE`、`WORKING_SELL_SET_CHANGED` | `external_working_set` | `critical` | `account` | `FullWorkingOrderSetEvidence` | `broker_account_reconcile` |
| `CALENDAR_OR_TRUSTED_TIME_UNKNOWN` | `time_trust` | `critical` | `global` | `TrustedTimeCalendarEvidence` | `trusted_time_revalidation` |
| `DB_COMMIT_FAILED`、`DB_INTEGRITY_FAILED` | `database_durability` | `critical` | `global` | `DatabaseIntegrityEvidence` | `restore_then_full_reconcile` |
| `QUOTE_GAP_CROSSING_UNKNOWN`、`TRAILING_GAP_EXTREME_UNKNOWN` | `quote_gap` | `critical` | `strategy` | `CanonicalObservationGapEvidence` | `manual_quote_gap_resolution` |
| `EXTERNAL_POSITION_DRIFT`、`POSITION_OR_UNIT_UNKNOWN` | `position_uncertainty` | `critical` | `account_contract` | `BrokerPositionUnitEvidence` | `manual_or_broker_reconcile` |
| `RESOLUTION_CASE_OPENED`、`RESOLUTION_CASE_EVIDENCE_ACCEPTED`、`RESOLUTION_CASE_DECISION_REQUIRED`、`RESOLUTION_CASE_RESOLVED_FINAL_EVIDENCE`、`RESOLUTION_CASE_RESOLVED_RECONFIRMED`、`TERMINAL_EVIDENCE_CORRECTION_RECORDED` | `resolution_case` | `critical` | `resolution_case_scope` | `ResolutionCaseEvidence` | `typed_resolution_matrix` |
| `SAFETY_BLOCKER_OPENED`、`SAFETY_BLOCKER_RESOLVED`、`RELINQUISHED_UNKNOWN_EXPOSURE_OPENED`、`RELINQUISHED_UNKNOWN_EXPOSURE_RESOLVED` | `safety_blocker` | `critical` | `resolution_case_scope` | `SafetyBlockerEvidence` | `typed_resolution_matrix` |
| `MANUAL_RECONCILIATION_STARTED`、`MANUAL_FINAL_EVIDENCE_APPLIED`、`MANUAL_RESOLUTION_RECONFIRMED`、`MANUAL_BREAK_GLASS_RELINQUISHED` | `manual_resolution` | `critical` | `resolution_case_scope` | `ManualResolutionAuthorizationEvidence` | `typed_resolution_matrix` |
| `STATE_TRANSITION_NOT_ALLOWLISTED`、`STATE_REVISION_CONFLICT`、`REQUEST_REPLAY_PAYLOAD_MISMATCH` | `request_rejection` | `error` | `request` | `RequestJournalEvidence` | `reject_and_journal` |

### 12.2 Manual resolution 原則

1. `manual_intervention`只存在Strategy。其他entity連到ResolutionCase並維持`unknown`／`reconciling`／`safety_blocked`；一般resume、toggle、重開頁面、重啟、DB編輯或flag都不能解除。
2. resolution先由typed reason code選matrix；matrix固定必要證據、允許edge、confirmation／re-arm、reservation／claim／obligation與SafetyBlocker處理。缺任一欄位即拒絕。
3. 唯一final broker evidence必須固定account、trade date、contract、side與核准identifiers一致；通知、單一SSE event、UI快取、`custom_field`單獨匹配或口述不算。
4. break-glass只轉交本機責任，不製造broker final evidence、不重送原intent。必須二次確認、snapshot、actor、時間與永久burned nonce，並原子建立`RelinquishedUnknownExposure` blocker。
5. release claim／obligation後顯示`unmonitored`，不得顯示cancelled／filled／protected；新相衝突write仍由durable blocker拒絕。

### 12.3 Minimum resolution matrix

| Reason family | 必要證據 | 允許動作／轉移 | Re-arm | Reservation／claim／obligation |
|---|---|---|---|---|
| `BROKER_OUTCOME_UNKNOWN`／response loss | fixed-account full trades/orders/deals、trade date、identifiers、position與working set的唯一current/final evidence | entity依typed edge解決；Strategy可由manual回paused。若永遠不足，只可break-glass | 原intent永不re-arm；新交易須先滿足blocker policy | final quantities原子consume/release；break-glass開unknown-exposure blocker |
| `BROKER_CORRELATION_AMBIGUOUS`／跨日短ID衝突 | 同上，且需排除其他candidate | 只可套用唯一candidate；否則ResolutionCase保持open或break-glass | 否 | unknown claim保持阻擋；不得猜cancel/update target |
| `BROKER_FINAL_EVIDENCE_CONFLICT`／`ACTIVATION_ID_CONFLICT` | 新舊immutable evidence hashes、canonical activation key／broker account-order-deal-position全量、repository unique-index與revision audit | 原terminal entity永不回轉；建立ResolutionCase＋SafetyBlocker。唯一證據後只能新增TerminalEvidenceCorrection；non-terminal Strategy可依`STR-009A-F`進manual | 原Activation／intent永不re-arm；設定變更只能copy-to-draft | correction與derived ledger同transaction；衝突未解前scope內write持續blocked |
| `BROKER_ACCOUNT_MISMATCH` | 固定帳號subscription、account-scoped refresh與correlation audit | 若證明event屬他帳號，拒絕該event並重新對帳；無法排除則manual | 否，直到identity/account gate重過 | 不跨帳號搬移reservation／claim |
| `BROKER_TARGET_REVISION_CHANGED`且可證明未送bytes | queue-head前後target revision、adapter authority證據 | 舊intent依operation轉`terminal(update_stale_target_prebyte | cancel_stale_target_prebyte)`；重新確認後建立新intent | 只可新intent，不可重送舊intent | 舊reservation依final target釋放／重算；claim需新generation |
| `EXTERNAL_POSITION_DRIFT`／`WORKING_SELL_SET_CHANGED` | full position、external working orders、deals、unit與as-of；無working/unknown競態 | 可縮減尚未觸發reservation；新confirmation後回`paused` | MAY，只限matrix核准、full reconciliation後的新arm generation | 有競態時不得release後自動sell；轉manual |
| `QUOTE_GAP_CROSSING_UNKNOWN` | 無法重建gap本身就是事實；只接受完整eligible observation證明是否有gap | 取消策略、複製新draft，或明確放棄舊edge後以fresh false重新arm | 只可新arm generation；不得補造舊crossing | 不影響已存在broker義務；working／unknown照常drain |
| `TRAILING_GAP_EXTREME_UNKNOWN` | historical ticks只能稽核，不能當重新解鎖證據；另需position／working set | 取消／人工接手／copy-to-draft；保留最後confirmed high供audit | 不可resume原trailing generation | 未受保護量高可見；break-glass才release obligation |
| `ENTRY_RESULT_UNKNOWN`／OCO `EXIT_CLAIM_UNKNOWN`／cancel-fill race | order、deal、position、working set與cumulative quantities的唯一final evidence | 重算commitment、obligation、remainder與claim；或break-glass | 原entry／winner intent不可重送；remainder須新generation＋re-arm | 同transaction維持`filled = exited + protected + unprotected`投影；break-glass開blocker |
| `IDENTITY_MAPPING_CONFLICT`／`POSITION_OR_UNIT_UNKNOWN`／`EXTERNAL_WORKING_SET_INCOMPLETE` | 相應Gate 0 capability與完整性證據、mapping revision、full reconciliation | 只能修復gate後進新RuntimeEpoch observe-only | 不得以逐strategy override；gate重過後仍需user arm | 既有義務保留，不能藉新identity group／假unit release |
| `DB_INTEGRITY_FAILED`／`DB_COMMIT_FAILED`／`SENDER_FENCE_LOST` | 經驗證backup/restore、integrity、row count、schema/hash、single-writer fence與broker reconciliation | 若DB仍可可靠commit，舊epoch可走`RTE-015* → failed_stop`；若commit/fsync本身失敗，只能process fail-stop，權威state停在最後durable revision。建立新epoch並full reconcile後才到observe-only | 新epoch全部gate＋user arm；舊intent不重送 | 無法證明的side effect轉unknown/manual；不得用未durable的failed_stop宣稱風險已結束 |
| `SIMULATION_ATTESTATION_FAILED`／`MODE_GENERATION_CHANGED`／`GATE_MANIFEST_INVALID` | marker＋`/info`＋generation＋manifest verifier的current evidence | 新epochreconcile後只到observe-only／ready_unarmed | 需重新manifest／confirmation／user arm | 不得用break-glass把模式失配變成可寫；義務仍須人工或對帳 |
| `PROTECTION_UNPROTECTED_REMAINDER` | filled、confirmed exited、distinct actively-covered claims及position的current snapshot | 建立新保護只可走新confirmation／新claim generation；或人工接手 | 原unknown intent不可重送 | 一般stop／rollback／uninstall持續阻擋到0或manual release |

### 12.4 Terminal evidence conflict 不回轉

terminal entity收到矛盾證據時，必須在一個transaction：

1. 保留原terminal state與revision不變；
2. 建立`ResolutionCase(kind=terminal_evidence_conflict, state=open)`；
3. 建立相應scope的`SafetyBlocker.open`；
4. 保存新舊evidence hashes，不以接收順序決定真偽；
5. 若關聯Strategy仍non-terminal，依`STR-009*`轉manual；若Strategy已terminal，不回轉，只在terminal history顯示open case並阻擋相衝突write。

取得唯一final evidence後，resolution service新增immutable`TerminalEvidenceCorrection`，以它重算position／PnL／claim／obligation投影並解決blocker；原entity歷史仍顯示先前terminal assertion與correction。若correction揭露terminal Strategy之後仍有實際曝險，建立account-level corrective exposure record與SafetyBlocker，要求人工處置；不得重開Strategy或自動補送保護。

### 12.5 SafetyBlocker 與 ResolutionCase typed edges

SafetyBlocker kinds與最低scope：

| Kind | Scope | 正常解除證據 |
|---|---|---|
| `unknown_broker_side_effect` | account＋contract＋intent | unique final evidence＋current position/working set |
| `terminal_evidence_conflict` | account＋contract＋entity lineage | TerminalEvidenceCorrection＋derived ledgers重算 |
| `relinquished_unknown_exposure` | account＋contract；必要時identity group | unique final evidence，或Gate核准的complete current-state＋full-day deal evidence證明unknown effect bounds為0 |
| `position_or_unit_conflict` | account＋contract | canonical unit gate＋full reconciliation |
| `external_working_set_incomplete` | account | Gate 0完整性證據 |
| `identity_mapping_conflict` | identity group | canonical principal mapping修復＋key audit |
| `db_integrity_unverified` | global | verified restore/integrity＋broker full reconciliation |
| `mode_generation_conflict` | global | new epoch＋mode/generation/manifest reconciliation |

| Edge ID | Entity From → To | Actor／write provenance | 必要條件／reason code |
|---|---|---|---|
| `RC-001` | `ResolutionCase.__create__ → open` | `resolution_service`／`none` | typed reason＋scope＋evidence hashes；`RESOLUTION_CASE_OPENED` |
| `RC-002` | `open → evidence_collecting` | `resolution_service`／`none` | bounded evidence request；`MANUAL_RECONCILIATION_STARTED` |
| `RC-003` | `evidence_collecting → decision_required` | `resolution_service`／`none` | evidence仍不足或需二次確認；`RESOLUTION_CASE_DECISION_REQUIRED` |
| `RC-004A` | `open → resolved_by_final_evidence` | `resolution_service`／`none` | unique final evidence；`RESOLUTION_CASE_RESOLVED_FINAL_EVIDENCE` |
| `RC-004B` | `evidence_collecting → resolved_by_final_evidence` | 同上／`none` | 同上 |
| `RC-004C` | `decision_required → resolved_by_final_evidence` | 同上／`none` | 同上 |
| `RC-005` | `decision_required → resolved_by_reconfirmation` | `resolution_service`／`none` | valid `UserRearmAuthorization`、matrix允許、new confirmation；`RESOLUTION_CASE_RESOLVED_RECONFIRMED` |
| `RC-006` | `decision_required → relinquished_unknown` | `resolution_service`／`none` | valid `BreakGlassAuthorization`、二次確認＋blocker原子建立；`MANUAL_BREAK_GLASS_RELINQUISHED` |
| `SB-001` | `SafetyBlocker.__create__ → open` | `resolution_service`／`none` | kind/scope/effect bounds；`SAFETY_BLOCKER_OPENED`或`RELINQUISHED_UNKNOWN_EXPOSURE_OPENED` |
| `SB-002` | `open → resolved` | `resolution_service`／`none` | kind-specific解除證據；`SAFETY_BLOCKER_RESOLVED`或`RELINQUISHED_UNKNOWN_EXPOSURE_RESOLVED` |
| `SB-003` | `open → superseded_by_stricter_blocker` | `resolution_service`／`none` | 新blocker scope為舊scope超集且兩者lineage相連；`SAFETY_BLOCKER_OPENED` |

#### 12.5.1 `SB-002`／`SB-003` verifier binding

`SB-002`的解除請求 MUST 同時綁定目前durable `SafetyBlocker`的`blockerId`、kind、ResolutionCase、lineage、generation、canonical scope與unknown-effect bounds，並由opaque verifier依blocker kind選擇固定的reason allowlist及必要evidence classes。verifier另 MUST把`SafetyBlockerResolutionBinding.blockerId`／lineage／generation與同一decision的state-transition entity ID／lineage／generation逐項比對，禁止使用blocker A的證據核發blocker B的transition；state machine只能消耗一次verifier核發的decision，不得自行重建、補欄位或只憑transition reason解除。

- `unknown_broker_side_effect`及`relinquished_unknown_exposure`在`SB-001`建立時 MUST同時durable保存`worstCasePositionDeltaShares`與`possiblyWorkingShares`；兩者皆不得缺省。後續`SB-002`解除或`SB-003`supersede時，verifier binding MUST同時帶回兩個bounds並與目前durable值精確相等；缺少任一欄位即fail closed。
- `unknown_broker_side_effect`及`relinquished_unknown_exposure`的一般解除路徑固定為`canonical_unique_final_current_exposure`：MUST有唯一canonical broker terminal evidence、fixed-account current position／working set與完整external working set。只有all-not-final evidence時 MUST fail closed。
- `relinquished_unknown_exposure`另可使用明確分型的`gate_approved_zero_exposure_bounds`路徑；此路徑只在durable `worstCasePositionDeltaShares = 0`且`possiblyWorkingShares = 0`時成立，並 MUST綁定Gate核發的opaque zero-bounds evidence hash及上述current exposure evidence。此例外不等同一般acknowledge、resume、re-arm或重送原intent。
- 其他blocker kind只能使用各自reason／evidence policy的`blocker_kind_policy_evidence`路徑；kind與reason family不相容、缺少kind-specific evidence或把另一種blocker的證據搬用時 MUST拒絕。
- `db_integrity_unverified`至少需要verified restore／integrity、single-writer fence、broker full orders／trades／deals、current position／working set與完整external working set；`mode_generation_conflict`只接受`SIMULATION_ATTESTATION_FAILED`、`MODE_GENERATION_CHANGED`或`GATE_MANIFEST_INVALID`，並至少需要new RuntimeEpoch reconciliation、mode／generation／manifest reconciliation、single-writer fence、fixed-account subscription及current position／working set。

`SB-003`的舊`SafetyBlocker` MUST durable保存排序且不重複的canonical scope member hashes，state machine MUST把verifier decision中的舊scope vector與durable vector逐項比對；只提供相同`scopeId`但縮小member set時不得進行轉移。successor MUST與舊blocker同kind及同ResolutionCase、明列`predecessorBlockerId`與`predecessorLineageId`、使用不同successor ID及lineage，且`lineageGeneration = predecessor + 1`。新scope MUST包含舊scope的每一個member並至少多一個member；只有scope ID不同、equal set或disjoint set都不構成strict superset。

successor projection只能由opaque verifier核發；其`bindingSha256` MUST由policy version、successor blocker ID／kind／ResolutionCase、predecessor ID／lineage、successor lineage／generation、canonical scope及unknown-effect bounds完整序列化後計算，不接受caller自行複製或指定hash。對`unknown_broker_side_effect`及`relinquished_unknown_exposure`，successor兩個bounds皆為必填，且各自 MUST大於或等於predecessor的durable bound，不得藉supersede把unknown exposure降級成較小值或0。`canonical_safety_blocker_successor_binding` evidence hash、`SafetyBlocker.open` companion record hash及該companion的successor record ID／lineage／generation／scope／bounds MUST全部相符，才能在同一transaction完成舊blocker supersede與新blocker open；使用舊blocker的companion metadata也 MUST拒絕。

下列hash用途 MUST分離，不得互換：ResolutionCase evidence snapshot、Gate zero-bounds evidence、canonical successor binding、state transition effect projection。`SB-003`的effect projection仍綁定predecessor state transition，successor atomic companion則以獨立canonical successor binding hash驗證；不得為了方便把兩種hash強制視為相同值。任一hash缺失、錯置或不符合目前durable entity時，decision不得消耗，轉移維持fail closed。

### 12.6 Durable `RelinquishedUnknownExposure`

break-glass transaction MUST保存：operation、intent/target lineage、account/contract opaque refs、trade date、side、`worstCasePositionDeltaShares`、`possiblyWorkingShares`、PnL/claim uncertainty、evidence snapshot hash、actor與second-confirmation hash。它讓本機obligation可標released並允許使用者明確停止服務，但**不代表風險消失**：DB與backup保留blocker；未來安裝／啟動時相同scope的automation及可能增加衝突曝險的manual write保持disabled。刪DB、換strategy ID、換identity group或acknowledge UI都不能解除。

## 13. Crash windows 與復原結果

下表把等價的硬體／程序故障時間點分組。任何未列出的實際時間點 MUST保守歸入「最後一個已durable commit之後、下一個durable commit之前」的較嚴格列。

| Window | 最後已durable事實 | Crash後權威狀態 | 必要復原 | 可否自動retry |
|---|---|---|---|---|
| C0：create transaction commit前 | 無新entity，或舊revision不變 | 不存在新strategy／activation | client以相同request ID重送，server回既有結果或重新執行整個transaction | 可重送create request；不可broker write |
| C1：strategy＋activation＋intent＋reservation／claim transaction已commit，尚未dispatching | `OrderIntent.prepared`，adapter未取得authority | prepared、對應activation prepared | 新epochobserve-only、reconcile、顯示「已準備、尚未送出」、user re-arm | MAY執行原intent一次，但只能在證明未授權adapter且重新arm後；不是自動retry |
| C2：dispatching transaction開始但commit前 | 舊prepared transaction仍是最後durable事實 | prepared | SQLite rollback；依C1處理 | 同C1 |
| C3：dispatching＋nonce＋fence＋DurableDispatchBlocker已commit，adapter第一byte前 | `OrderIntent.dispatching`＋`DispatchBlocker.open` | OS shared lease隨crash釋放；durable blocker仍open，intent須unknown／reconciling | 新Runtime拒絕mode switch/new dispatch，固定帳號bounded reconciliation後原子更新intent＋blocker | **否**，即使猜沒有byte也不得重送 |
| C4：第一byte／HTTP write後，response前 | dispatching | unknown／reconciling | 同C3；取得唯一broker evidence | 否 |
| C5：broker response／ack已在記憶體，ack commit前 | dispatching＋open blocker仍是最後durable事實 | OS lease釋放；舊epoch fail-stop，intent unknown／reconciling | 新epoch依open blocker固定帳號reconcile；不能相信記憶體ack | 否 |
| C6：broker event早於HTTP response | 若event＋correlation transaction已commit則acknowledged／broker current；否則dispatching | 依最後commit，不依到達順序 | duplicate-safe event replay＋account reconciliation | 否 |
| C7：acknowledged已commit，broker order仍non-terminal | intent acknowledged、BrokerOrder pending/pre/submitted | acknowledged＋broker current state | 重訂閱、account-scoped refresh；繼續監控原order | 否 |
| C8：entry/exit partial fill收到但domain transaction commit前 | 舊broker cumulative fill、entry remainder、obligation/protectedShares revision | 依舊revision；unmaterialized fill與protectedShares標unknown，不使用記憶體量 | 從deal ledger、position、order重算；filled/openPotential/terminalUnfilled、reservation、claim、protectedShares、obligation原子commit | 否 |
| C9：partial fill domain transaction已commit | 新cumulative fill、reservation／claim／obligation一致 | part_filled／monitoring或partially_exited | 重啟驗證invariant後繼續；不得以原order quantity當全成 | 否 |
| C10：單一OCO Activation winner CAS＋intent_reserved commit後、dispatch前 | 一個Activation含winnerLegId；child leg evaluations為winner/suppressed；claim intent_reserved | 原Activation/winner保留；suppressed child無authority | 若proven-unsent，reconcile＋user re-arm後只可送原winner；否則unknown | 不可自動；不可改送sibling |
| C11：OCO winner dispatching後 | dispatching nonce durable | winner／claim unknown，siblings blocked | 固定帳號order/deal/position reconciliation | 否 |
| C12：exit partial fill後、claim remainder transaction前 | broker可能已有更多成交，DB仍舊claim | claim／obligation進reconciling或unknown | final cumulative quantity原子重算；新remainder generation只在原order terminal後建立 | 否 |
| C13：cancel與fill競態 | 僅收到cancel或僅收到fill其中一側event皆不足以final | BrokerOrder保持non-terminal／unknown | account-scoped update_status＋trades＋deals＋position確認final quantities | 否 |
| C14：broker outcome已知但DB fsync／commit失敗 | dispatching／acknowledged舊revision與可能open blocker | process撤銷socket authority並fail-stop，但權威epoch仍是最後durable state；不得宣稱`failed_stop`已保存。OS lease於process死後釋放，durable blocker保留 | restore/integrity後新epoch full reconcile並原子清blocker；若之後DB可寫，另建新epoch，不回填虛構舊transition | 否 |
| C15：mode switch與dispatch競爭 | shared lease可能仍由活process持有；DB可能已有open blocker | 活process先完成durable result；crashed process只留下durable blocker | exclusive lease先等待活lease，再掃描DB open blocker與non-terminal side effects；任何一筆存在即拒絕switch | 否 |
| C16：API generation突然改變 | 舊epoch fence失效 | 舊epoch superseded；所有相關strategy recovery/paused | 新epochstarting→reconciling→observe_only，user重新arm | 否 |
| C17：純monitoring期間Runtime crash，尚無新broker intent | 最後quote extreme／condition state durable | 新epochobserve_only；strategy recovery/paused | orders／positions／subscriptions／quote gap／calendar全對帳；trailing gap依matrix進manual | 不得因重啟後第一筆quote自動dispatch |
| C18：break-glass snapshot／release／blocker transaction中途失敗 | 舊Strategy manual＋entity unknown/safety_blocked | transaction rollback，未release且未遺失unknown risk | 重做二次確認與完整原子transaction；不得只補release或只補blocker | 否 |
| C19：break-glass／forced-stop linearization transaction前後crash | commit前：全部舊revision；commit後：released／failed entities＋ResolutionCase relinquished＋`RelinquishedUnknownExposure.open`；forced-stop variant同一commit另含`RTE-016 → failed_stop` | transaction全成或全敗；不得出現entity已release但forced-stop epoch未commit的中間權威狀態。本機義務可顯示unmonitored，相衝突write仍blocked | 新Runtime依最後完整commit載入blocker並reconcile；只有kind-specific evidence可resolve | 否 |
| C20：terminal commit後收到矛盾broker evidence，建立case前crash | 原terminal entity＋新evidence至多只在memory | terminal不回轉 | restart account reconciliation再次發現conflict，原子建立ResolutionCase＋SafetyBlocker；不可覆寫terminal | 否 |
| C21：TerminalEvidenceCorrection與derived ledgers transaction中途失敗 | 原terminal＋open conflict blocker | rollback，blocker持續open | 重做完整correction/reprojection transaction | 否 |

## 14. 跨實體原子 invariant

以下 invariant必須在 repository transaction／property tests中機械驗證：

1. 每個 `Activation` 最多一個primary `place` OrderIntent可取得dispatch authority；`update`／`cancel`是綁定該owner lineage與target revision的control intents，不能被當成第二個activation／place。任何曾到dispatching的intent nonce都不可重用。
2. Strategy進terminal的commit ⇒ 所有關聯side-effect intent與BrokerOrder terminal、所有commitment／obligation terminal或released、reservation與active claim為0、`RuntimeTrackedUnprotectedRemainder=0`。之後若出現矛盾證據，只能建立ResolutionCase／SafetyBlocker與correction，不得回轉Strategy或清除原terminal history。
3. `OrderIntent.dispatching`的commit ⇒ 當時RuntimeEpoch持有有效sender fence與ephemeral shared mode lease，且同transaction已有`DurableDispatchBlocker.open`；缺任何一項不得讓adapter取得socket authority。crash後lease可消失，但open blocker必須保留。
4. `BrokerOrder` 不得在沒有fixed account、trade date與canonical correlation的情況下連到intent。
5. protection entry prepare transaction同時建立entry intent、PendingProtectionCommitment、ProtectionObligation與policy要求的EntryExposureReservation；不可只出現其中一部分。
6. `ProtectionObligation.filledShares = confirmedExitedShares + protectedShares + RuntimeTrackedUnprotectedRemainder`，各量皆為non-negative base `Share`且同account／contract；`protectedShares`只接受distinct、fresh、non-unknown ExitClaim投影。
7. 未有broker-confirmed fill與position reconciliation前，ExitClaim總量必須為0。
8. 同一`protection_group_id + remainder_generation`只有一個Activation，且最多一個winner intent；candidate sibling只可存在於無broker authority的ProtectionLegEvaluation，winner terminal且新generation建立前不可dispatch。
9. distinct ExitClaim lineage投影不得把monitoring、intent與broker-working representation重複加總。
10. EntryExposureReservation的reserved量不得被同ID擴張；consume＋release不得超過原worst-case reservation。
11. 任何unknown intent/order/claim或open `RelinquishedUnknownExposure`都依SafetyBlocker scope阻擋同account／contract可能衝突的新write，且阻擋一般graceful mode switch／stop／rollback／uninstall；只有明確break-glass流程可把本機監控責任轉交，不能解除broker風險blocker。
12. terminal outcome、break-glass release與broker result是三個不同欄位；UI成功文案只能來自broker-confirmed final evidence。
13. 每個entry lineage永遠滿足`requestedShares = cumulativeFilledShares + openPotentialShares + terminalUnfilledShares`與`cumulativeFilledShares = materializedFilledShares + unmaterializedConfirmedFillShares`；true zero-fill與partial-entry terminal必須符合第7.1節互斥條件。
14. terminal evidence conflict只能新增ResolutionCase、SafetyBlocker與immutable TerminalEvidenceCorrection；原terminal entity的state／revision不變，derived ledger correction必須原子重投影。
15. protection exit Activation只能在entry OrderIntent、BrokerOrder與PendingProtectionCommitment皆terminal，且`openPotentialShares = 0`、`unmaterializedConfirmedFillShares = 0`時建立；entry與exit不得同時具有broker write authority。
16. 每筆transition journal恰有一個`actor_kind`；所有user／second-person核准只存在`authorization_evidence_ids`。registry中的每個展開後edge恰有一組完整reason metadata、`evidenceClassesByReason`與明確`atomicCompanions`陣列。
17. `RuntimeEpoch.observe_only`必須有同epoch durable `fullReconciliationCompletedInEpoch = true`；quiescing不得繞過第一次full reconciliation進ready。DB/fsync失敗時只可process fail-stop，不可製造未commit的durable `failed_stop`。
18. non-draft Strategy的第2.1節definition與`strategy_definition_hash`不可變；Activation ID不得包含mutable state revision。
19. 時間敏感transition必須保存`observed_wall_time`與`wall_time_trust_status = trusted`；degraded／untrusted／unknown只可進blocking／missed等明列安全edge，不得觸發broker dispatch。

## 15. 書面 review 與 Gate 證據要求

本文建立後 task 0.11 **仍不得勾選完成**，直到至少完成下列書面review並保存不含秘密的證據：

1. domain／state-machine reviewer：逐表確認allowlist、terminal分類、deterministic ID與non-draft不可變性；
2. repository／outbox reviewer：確認每個transaction、CAS、revision、dispatch nonce、fsync與C0–C21 crash結果可實作；
3. broker adapter／reconciliation reviewer：確認account-scoped evidence、event reorder、terminal finality、update/cancel target與no-retry邊界；
4. risk／protection reviewer：確認EntryExposureReservation、ExitClaim generation、OCO與obligation quantity invariant；
5. Runtime／mode reviewer：確認RuntimeEpoch、shared/exclusive lease、generation、fail-stop與生命週期drain。

review record MUST綁定本文版本與內容hash，列出reviewer角色、日期、finding ID、severity、處置與再審結果。任何P0／P1 finding未關閉、reason code沒有resolution matrix、crash window無唯一復原結果、或表格與spec矛盾時，task 0.11保持未完成，策略write master保持不可開啟。

後續Gate 1實作至少要有table-driven／property／fault-injection證據，覆蓋：

- 每個allowlisted edge與每個非法edge；
- terminal不可回轉、stale revision與request replay；
- deterministic ID在duplicate／reorder／restart／OR同時命中／schedule missed／OCO sibling下不重複；
- C0–C21每個crash window；
- 每個manual reason family的唯一final evidence、generic resume拒絕與break-glass audit；
- reservation／claim／obligation跨實體invariant與account-wide並發CAS；
- RuntimeEpoch generation、shared/exclusive mode lease及ack後DB commit失敗。

在上述review與證據完成前，本文只能作為實作輸入，不能被gate manifest當作`passed` conjunct。
