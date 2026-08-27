# 狀態轉移 repository／outbox 正式審查紀錄

## 審查識別

- 審查紀錄版本：`smart-order-state-transition-repository-outbox-review/2026-08-12.1`
- 審查日期：2026-08-12（Asia/Taipei）
- 審查角色：repository／outbox reviewer
- 審查者：Codex 獨立審查角色
- 對應 change：`add-durable-smart-order-panel-and-protective-exits`
- 對應 task：0.11 的 repository／outbox 正式書面 review
- 綁定 artifact 版本：`smart-order-state-transitions/2026-08-11.4`
- 綁定 artifact SHA-256：`e788bb3981e4784ee797277a73257b1fb8e68899b0b2bacc93c76016b4926d0d`
- 審查結果：本角色對綁定的**書面 transaction／CAS／crash model**予以 `sign-off`；沒有未關閉的 artifact P0／P1 finding

本紀錄只代表 repository／outbox 角色確認綁定 artifact 可實作。它不宣稱目前 SQLite v6 repository 已完整落地 artifact 的 259 個 typed edge／atomic companion，也不取代 domain／state-machine、broker adapter／reconciliation、risk／protection、Runtime／mode 其餘四個角色的 sign-off。現行實作差距與尚未執行的真實平台 durability／fault-injection 證據仍是 Gate 與任何 broker write 的硬阻擋條件。

本次沒有連線 8080、沒有呼叫 Shioaji／broker API、沒有建立行情或交易 subscription，也沒有發出 place／update／cancel。

## 審查輸入與內容雜湊

| 輸入 | 版本／SHA-256 | 用途 |
|---|---|---|
| `smart-order-state-transition-tables.md` | `smart-order-state-transitions/2026-08-11.4`／`e788bb3981e4784ee797277a73257b1fb8e68899b0b2bacc93c76016b4926d0d` | 本次正式審查的唯一書面狀態／crash model 基線 |
| `repository-schema.mjs` | `smart-order-sqlite/2026-08-11.6`／`33151963c3e9ce9d60c2ce6d40f61dc2e08dd66fe63800bf7b38779143a13ff2` | current schema、unique constraint、revision 與 state 差距對照 |
| `repository-worker.mjs` | `3fce4871fa0563c6b9433776cf4c19a541186723634aa47d42c6108add8189dc` | transaction、CAS、journal、dispatch fence、restart recovery、backup 實作對照 |
| `repository-client.mjs` | `d34e585d0f5bdbf3bf3fc44e7ff12111d3d261584d0126fe27c038d084c40d98` | dedicated worker／bounded queue 邊界對照 |
| `repository.test.mjs` | `75a6fd33c3db5bdab3481056d3a9c050297140fefc9d59baf138975089fe5340` | repository transaction／rollback／recovery／fault scaffold 證據 |
| `broker-dispatch-coordinator.mjs` | `smart-order-broker-dispatch-coordinator/2026-08-12.2`／`2ff9c27abe9f885af79a25f0b8b060663e39120f3c6382ae14a5f0ed1753b058` | durable grant 後才交付一次性 adapter authority、unknown／fail-stop 邊界 |
| `broker-dispatch-coordinator.test.mjs` | `546d6b09c56cf5c0a0ef12da78023d2ea8c5ac7e63bb17eac8122f4834e09bee` | first-byte／response failure、no retry、ack 後 commit failure 證據 |
| `repository-backup.mjs`／`repository-backup.test.mjs` | `565369178918cf49bb76dc11eab3fb4d3d78dc0a37d19eab93b4705d52432bf9`／`889efeefb070410a53b0abb0974d95508ed4920da1cb49b1bb737520c208463b` | snapshot、manifest、integrity、row count、restore 與 fsync publication 對照 |

若綁定 artifact 的版本或 SHA-256 改變，本 sign-off 立即失效，必須重新審查；current repository 檔案雜湊只用來精確標示本次 gap assessment 的快照，不把未來整合變更偷偷納入本紀錄。

## 審查範圍與判準

本角色逐項確認：

1. 每個 typed edge 的 entity row、journal、reason/evidence、`atomicCompanions` 是否可在單一 SQLite transaction 中全成或全敗。
2. 每個 mutable entity 是否可用 `from_revision` CAS、`to_revision = from_revision + 1`、unique lineage／request key與 affected-row count 實作 stale／duplicate／conflict fail closed。
3. `prepared → dispatching` 的 nonce、sender fence、RuntimeEpoch、mode／risk／account／target revision、durable blocker與 adapter authority 是否有唯一 durable linearization point。
4. SQLite WAL、`synchronous=FULL`、transaction commit、rollback、dedicated worker、backup／restore與 explicit file／directory fsync 是否足以承載書面 durability contract；平台實證是否仍被正確留在 Gate 0。
5. C0–C21 每個 crash window 是否都有唯一最後 durable 事實、權威狀態、復原操作與 retry 判定，且未把 broker call 誤稱為 SQLite transaction 的一部分。
6. 現行 SQLite v6 repository 與綁定 artifact 的差距，是 artifact 自身不可實作／矛盾的 P0／P1，或是後續 schema、integration、property／fault-injection 工作。

本角色不簽核 fixed-account broker evidence 是否完整、event reorder 的真實 upstream contract、position／PnL／reservation 的 production authority、shared／exclusive mode lease 的 OS 實證或真實 simulation write；那些分別屬其餘 reviewer、Gate 0／1 與後續 integration。

## Transaction、CAS、revision、nonce 與 fsync 審查結果

### Transaction 與 atomic companion

- Artifact 1.4 節為每個展開後 edge 明列完整 `atomicCompanions`，未列者明確為 `[]`；owner／reason variant 在進 transaction 前必須解析為唯一不可變 companion set，沒有執行期猜測或部分 fallback。
- Strategy definition seal、entry protection prepare、dispatch fence、ack／unknown／terminal settlement、OCO winner、break-glass／forced-stop、terminal correction與 SafetyBlocker successor 都可用一個 `BEGIN IMMEDIATE` transaction 寫入 owner row、所有 companions及 journal；任何 validation、CAS、unique constraint 或 journal 寫入失敗都 rollback。
- Broker HTTP／socket effect 刻意不在 SQLite transaction 內；模型只承諾 persist-before-effect、at-most-once local dispatch authority與 unknown reconciliation，沒有宣稱 broker exactly-once，因此沒有跨系統原子化矛盾。

### CAS、revision 與 request replay

- 每筆 transition 固定比對 entity ID、`from_state`與`from_revision`，成功後只允許 `revision + 1`；affected row 不等於 1 即使整個 transaction 失敗。相依 companion 同樣帶自己的 expected revision，避免 owner 成功但 obligation／claim／reservation 留在舊 revision。
- deterministic Activation ID、`strategy_id + logical_key + generation`、owner-scoped request ID、broker canonical correlation、claim generation與一次性 authorization／nonce均可用 unique index 加 CAS 實作。exact replay 回傳同一 durable result；payload drift固定拒絕，不能建立第二筆 entity。
- BrokerOrder 的 `controlRevision` 與 entity `revision`分離；update／cancel intent在同一 CAS 預留 target control revision，queue-head 或 adapter authority前再次驗證，符合 stale pre-byte terminal與 post-authority unknown／reconciling的分界。

### Dispatch nonce、sender fence 與 durable commit

- `ACT-007`、`INT-002`、`DDB-001`共用一個 linearization transaction：保存同一 `dispatch_attempt_nonce`、sender fence、RuntimeEpoch、mode／risk／account／target revision、Activation／OrderIntent dispatching與 `DurableDispatchBlocker.open`；只有 transaction 成功 commit 後才可交付 adapter socket authority。
- Nonce一旦跟隨 dispatching commit 即永久 burned，intent不能回 prepared、不能取得第二個 nonce；即使 crash 發生在第一個 broker byte前也只能進 unknown／reconciling，不能以「大概沒送出」自動重送。
- WAL＋`synchronous=FULL`下，書面 durable 邊界是 SQLite 回報成功的 transaction commit；不要求 application 對每筆 DB commit 額外直接呼叫 `fsync(2)`。backup／manifest／rename publication則需對檔案與父目錄 explicit fsync。若 commit／fsync回報失敗，process只能撤銷 authority並 fail-stop，不能宣稱未保存的 `RuntimeEpoch.failed_stop` 已 durable。
- 實際 Node／SQLite／macOS crash durability、checkpoint、filesystem與 backup latency仍必須由 task 0.9／Gate 0 probe證明；本書面 sign-off 不把 source-level設定冒充平台實證。

## C0–C21 可實作性逐窗審查

| Window | Repository／outbox 實作線性化點 | 判定 |
|---|---|---|
| C0 | create transaction commit前沒有新 durable row；request ID／payload hash可安全重做完整 transaction | 可實作；只可重送 create，不可 broker write |
| C1 | strategy／activation／intent／reservation或claim與journal已同 transaction commit，adapter authority仍為零 | 可實作；reconcile＋user re-arm後才可送原intent一次 |
| C2 | dispatch transaction尚未commit，SQLite rollback保留 C1 的 prepared revision | 可實作；復原精確等同 C1 |
| C3 | dispatching＋nonce＋fence＋Runtime revisions＋`DurableDispatchBlocker.open`先同 transaction commit，之後才交付authority | 可實作；nonce burned，禁止原intent retry |
| C4 | 第一個socket byte在 C3 durable commit之後；DB無法證明broker結果 | 可實作；保留open blocker並進unknown／reconciling |
| C5 | memory ack不能超越最後 durable dispatching revision；ack transaction未commit即不採信 | 可實作；新epoch依fixed-account evidence對帳，不用memory補寫成功 |
| C6 | broker event與HTTP response各自以 canonical correlation／dedupe key套同一revision CAS | 可實作；到達順序不決定權威結果，最後durable commit才決定 |
| C7 | acknowledged intent、current BrokerOrder與cleared-ack blocker同 transaction；BrokerOrder仍保留non-terminal監控 | 可實作；只重訂閱／refresh，不重送原intent |
| C8 | partial-fill domain transaction前仍以舊cumulative revision為權威；memory delta不得投影成已保護量 | 可實作；由deal/order/position重算後原子寫fill、reservation、claim、obligation與projection |
| C9 | cumulative fill及所有quantity companions已在同 transaction commit | 可實作；重啟先驗invariant，再延續同一BrokerOrder |
| C10 | 唯一Activation、winner／suppressed evaluations、claim `intent_reserved`與exit intent同CAS＋unique generation commit | 可實作；proven-unsent仍需reconcile／re-arm且只可送原winner |
| C11 | winner intent已走C3 dispatch transaction，siblings無authority且同generation slot仍占用 | 可實作；只做account-scoped reconciliation，不改送sibling |
| C12 | exit fill後到claim remainder transaction前，以舊claim為權威並把範圍標reconciling／unknown | 可實作；final cumulative quantity與新remainder generation在原order terminal後原子建立 |
| C13 | cancel／fill任一單邊event都不直接final；BrokerOrder control revision與canonical quantity CAS保留競態 | 可實作；以orders／trades／deals／position唯一final evidence結案 |
| C14 | broker結果已知但DB commit失敗時不產生假ack／假failed-stop；process撤銷authority並退出 | 可實作；最後成功commit仍是權威，新epochrestore／integrity／full reconcile |
| C15 | shared lease在dispatch transaction前取得，exclusive switch等待shared holder並在取得後掃描durable blocker與non-terminal side effect | 可實作；DB blocker承接OS lease消失後的durability，不宣稱撤回in-flight write |
| C16 | API generation改變以fenced RuntimeEpoch CAS一次性失效re-arm、dispatch grant、strategy與manifest | 可實作；舊epoch不可再arm，新epoch由starting完整reconcile |
| C17 | 純monitoring quote extreme／condition cursor各自durable；沒有新intent就不存在broker retry問題 | 可實作；重啟先reconcile並要求user arm，不用第一筆quote補觸發 |
| C18 | break-glass authorization、snapshot、released／failed entities、burned nonce與unknown-exposure blocker使用單一transaction | 可實作；中途失敗全rollback，不能只補release或blocker |
| C19 | break-glass／forced-stop的單一transaction是唯一linearization point；forced-stop variant把`RTE-016`放入同一companion set | 可實作；commit前後只有兩個完整權威結果，沒有半release中間態 |
| C20 | terminal row immutable；矛盾evidence若只在memory，restart reconciliation再次以unique conflict key建立ResolutionCase＋SafetyBlocker | 可實作；原terminal state／revision不回轉 |
| C21 | TerminalEvidenceCorrection、immutable evidence與derived ledger reprojection同一transaction，blocker最後才依verifier CAS解決 | 可實作；中途失敗rollback且open blocker保留 |

機械掃描確認 crash table 恰有 22 列、ID連續為 C0–C21；任何未列故障點另有明確規則，保守歸入最後 durable commit後、下一個 durable commit前的較嚴格列。沒有無權威狀態、無唯一復原或允許猜測 retry 的 window。

## Current repository 差距與 Gate 邊界

目前 repository scaffold 已具備下列可重用機械基礎：

- dedicated worker中的單一SQLite writer、`BEGIN IMMEDIATE`／commit／rollback、WAL、`synchronous=FULL`、foreign key、defensive mode與queue／latency fail closed；
- prepared intent＋Activation＋EntryExposureReservation／protection commitment／obligation／ExitClaim的局部原子寫入，以及request replay／unique lineage；
- dispatch nonce、sender fence、Runtime/API/mode/risk/account/target revision、kill-switch arbiter revision、re-arm consumption與一次性immutable adapter envelope；
- response loss轉unknown且不retry、outcome durable commit失敗使coordinator fail-stop、restart／generation／continuity gap把dispatching intent轉reconciling；
- bounded journal、migration rollback、disk-full／read-only／corruption fail-stop、一致性backup、manifest／row-count／integrity restore驗證與檔案／目錄fsync publication。

但 current SQLite v6 **不是**綁定 artifact 的完整 repository implementation，以下差距不得被本 sign-off 掩蓋：

1. `repository-worker.mjs`尚未以 artifact SHA-256與 machine registry 驅動每個 transition；現有局部mutation仍使用較早期state／reason字串。
2. schema尚無完整 `DurableDispatchBlocker`、`RelinquishedUnknownExposure`、`TerminalEvidenceCorrection`、`ProtectionLegEvaluation`及其canonical companion／unique binding；既有 generic ResolutionCase／SafetyBlocker也尚未達 artifact v4 typed state矩陣。
3. RuntimeEpoch仍使用`ready`／`forced_stopped`等較早期state，Activation／EntryExposureReservation／protection records亦與artifact的`armed`、`partially_consumed`、typed PPC／POB狀態不完全一致；必須透過versioned migration與fail-closed legacy mapping整合，不能直接把字串視為等價。
4. current dispatch scaffold雖保存nonce／fence／revisions並在commit後才交付adapter authority，但尚未把 `DDB-001` open與 `DDB-002`至`DDB-005`清理結果做成artifact要求的第一級durable entity／atomic companion。
5. 現有75個focused repository／dispatch／backup tests證明基礎transaction與fail-stop機制，尚未等於artifact要求的全259 edge、19項跨實體invariant及C0–C21逐窗property／fault-injection Gate 1證據；尤其 broker response／event reorder、mode lease、OCO／claim remainder與terminal correction仍需後續integration suite。

上述皆屬現行 implementation／Gate evidence 差距，不是綁定書面模型的矛盾或不可實作 P0／P1。它們仍是硬性 release blocker：在完整 schema migration、registry-bound repository executor、atomic companion transaction、C0–C21 fault suite與其餘 reviewer再審通過前，不得把 artifact列為gate manifest的`passed` conjunct，也不得開啟broker write。

## Finding、處置與再審

| Finding ID | Severity | 處置 | 本次再審結果 |
|---|---|---|---|
| `ST-P0-04 OCO activation impossible model` | P0 | 單一Activation＋winner/suppressed child＋claim generation unique CAS | `closed`；C10–C12有唯一transaction與復原 |
| `ST-P0-05 OrderIntent operation ambiguity` | P0 | operation、owner、target control revision、terminal outcome分離 | `closed`；place/update/cancel的CAS與settlement可獨立實作 |
| `ST-P0-06 entry remainder/zero-fill ambiguity` | P0 | cumulative quantity、reservation、claim與obligation同transaction投影 | `closed`；C8／C9／C12／C13可維持原子等式 |
| `ST-P0-07 break-glass erases unknown exposure` | P0 | release／failed entity、burned nonce、ResolutionCase與unknown-exposure blocker同transaction | `closed`；C18／C19全成或全敗 |
| `ST-P0-08 OS lease treated as durable` | P0 | ephemeral shared lease與durable DispatchBlocker分離 | `closed`；C3／C5／C14／C15均以DB blocker承接crash後權威狀態 |
| `ST-P1-02 wildcard/blocking gaps` | P1 | 每個edge／companion variant完整展開，沒有runtime wildcard或缺省transaction set | `closed`；repository executor可在交易前取得唯一immutable plan |
| `ST-P1-03 protectedShares ambiguity` | P1 | distinct claim lineage與同一quantity projection transaction | `closed`；C8／C9／C12不依memory增量猜測 |
| `RO-20260812-01 current repository parity` | P2（implementation integration；Gate blocker） | 建立artifact-bound executor與versioned migration，補齊DDB、typed Runtime／protection／correction／break-glass entities及完整atomic companions | `accepted_deferred`；不是artifact P0／P1，但在integration再審前硬性阻擋Gate／write |
| `RO-20260812-02 C0–C21 executable fault evidence` | P2（evidence integration；Gate blocker） | 依C0–C21逐窗補property／fault-injection，並覆蓋19項跨實體invariant與每個allowlisted／illegal edge | `accepted_deferred`；書面結果唯一，但尚不能宣稱Gate 1通過 |
| `RO-20260812-03 platform durability proof` | P2（Gate 0 evidence；Gate blocker） | 在核准Node／SQLite／macOS矩陣實測WAL／FULL、power/process crash、checkpoint、backup/restore與latency watchdog | `accepted_deferred`；source設定不能取代task 0.9平台證據 |
| `RO-20260812-04 independent re-review` | 無新artifact finding | 重新比對artifact、design/spec、current schema／worker／coordinator、C0–C21與focused tests | `closed_no_finding`；本角色範圍無open artifact P0／P1 |

`P2`在此只表示「不是 task 0.11 書面模型的 P0／P1」，不表示可延後安全交付。三筆 `accepted_deferred` finding 對 Gate／broker write 都是硬阻擋；未完成處置與再審前不得用本紀錄解鎖。

## 機械證據

| 指令／檢查 | 結果 |
|---|---|
| `shasum -a 256` 綁定artifact、repository／coordinator／backup實作與tests | 所有值與本紀錄「審查輸入與內容雜湊」一致 |
| Node唯讀掃描 crash table | 22列；ID精確且連續為C0–C21 |
| current schema唯讀掃描artifact-required tables | 確認DDB／TerminalEvidenceCorrection／RelinquishedUnknownExposure／ProtectionLegEvaluation尚未落地，已列為Gate blocker而未誤報完成 |
| `pnpm exec vitest run scripts/smart-order-runtime/repository.test.mjs scripts/smart-order-runtime/broker-dispatch-coordinator.test.mjs scripts/smart-order-runtime/repository-backup.test.mjs` | 3 files／75 tests通過 |
| `openspec validate add-durable-smart-order-panel-and-protective-exits --strict` | 通過 |
| `git diff --check` | 通過 |

focused tests只操作本機temporary SQLite／fixture adapter；沒有API／broker／service contact。75 tests是current scaffold證據，不是C0–C21完整Gate 1證據。

## Sign-off conclusion

對綁定的`smart-order-state-transitions/2026-08-11.4`／SHA-256 `e788bb3981e4784ee797277a73257b1fb8e68899b0b2bacc93c76016b4926d0d`，本repository／outbox reviewer確認：每個transaction、CAS、revision、dispatch nonce、durable commit／fsync邊界與C0–C21 crash recovery都有一致、可實作且fail-closed的書面線性化點；本角色範圍沒有未關閉的artifact P0／P1 finding，予以正式sign-off。

此sign-off只是task 0.11要求的五個角色之一。current repository parity、Gate 0平台durability、C0–C21 executable fault evidence、其餘角色與總體evidence未完成前，task 0.11不得僅憑本紀錄自動勾選；artifact不得成為gate manifest的`passed` conjunct。所有broker write、Gate解鎖、simulation策略write、production與CA持續維持fail closed。
