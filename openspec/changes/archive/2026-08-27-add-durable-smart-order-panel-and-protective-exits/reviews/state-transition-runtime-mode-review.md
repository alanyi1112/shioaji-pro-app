# 狀態轉移 Runtime／mode 正式審查紀錄

## 審查識別

- 審查紀錄版本：`smart-order-state-transition-runtime-mode-review/2026-08-12.1`
- 審查日期：2026-08-12（Asia/Taipei）
- 審查角色：Runtime／mode reviewer
- 審查者：Codex 獨立審查角色
- 對應 change：`add-durable-smart-order-panel-and-protective-exits`
- 對應 task：0.11 的 Runtime／mode 正式書面 review
- 綁定 artifact 版本：`smart-order-state-transitions/2026-08-11.4`
- 綁定 artifact SHA-256：`e788bb3981e4784ee797277a73257b1fb8e68899b0b2bacc93c76016b4926d0d`
- 審查結果：本角色的**書面模型範圍**予以 `sign-off`；沒有未關閉的 artifact P0／P1 finding

本紀錄只代表 Runtime／mode 角色完成綁定 artifact 的正式書面審查。它不表示shared／exclusive mode execution lease、每次write的simulation雙重attestation、完整continuity authority、mode switch、relogin／upgrade recovery、forced-stop UI／CLI、Gate 0／1、production、CA 或任何 broker write 已完成或可使用；目前所有寫入仍 MUST fail closed。本次審查沒有連線8080、沒有讀取帳號、沒有建立broker／行情subscription，也沒有啟動、停止、重啟或切換任何既有服務。

## 審查輸入與內容雜湊

| 輸入 | 版本／SHA-256 | 用途 |
|---|---|---|
| `smart-order-state-transition-tables.md` | `smart-order-state-transitions/2026-08-11.4`／`e788bb3981e4784ee797277a73257b1fb8e68899b0b2bacc93c76016b4926d0d` | 本次正式審查的唯一書面狀態模型基線 |
| `specs/safe-local-runtime-mode-switch/spec.md` | `667cae555f3544dbf4617c1ce12745f0566b1dedbb2a6a6bfa8f16b89dfc1b33` | sidecar lifecycle、mode attestation、quiesce／drain、generation recovery與uninstall語意對照 |
| `scripts/smart-order-runtime/exclusive-runtime-lease.mjs` | `c7efeee41ff6357d5f96c73e54d736ea78f5701da01b6afdbad16659d5dff166` | 單一Runtime process-scoped OS lease及secondary-readonly可實作性對照 |
| `scripts/smart-order-runtime/exclusive-runtime-lease.test.mjs` | `d9441a6c1d6e25b8770701cfce93b3415317f5f222b66d08b295b8e0f69d6ea9` | primary／secondary、stale socket與私有權限離線回歸 |
| `scripts/smart-order-runtime/runtime-controller.mjs` | `smart-order-runtime-controller/2026-08-12.5`／`a209416d85925779cc35c798ba2f0077b683d28409fb5f3557445d07d647e8fd` | sender fence、generation／continuity同步封鎖、quiesce與disabled adapter整合對照 |
| `scripts/smart-order-runtime/runtime-controller.test.mjs` | `1a50ce864c642f040d6b11be55d52df3ffc9b1e97c6113ac2b2f28787f3c72be` | 雙Runtime、restart、kill switch、generation及continuity失效離線回歸 |
| `scripts/smart-order-runtime/runtime-gap-detector.mjs` | `smart-order-runtime-gap-detector/2026-08-12.1`／`a906415c22ceeedddfd012351755114f2a0e4c42030a7740e8136db95b360367` | event-loop／clock／sleep-wake／SSE／API generation gap reducer對照 |
| `scripts/smart-order-runtime/runtime-gap-detector.test.mjs` | `fdd1c8975bdfce9dd50cb625fff34e10d471a99fdb385b9db4a25849af5232a7` | immutable latch、sequence／cursor／epoch與invalid input離線回歸 |
| `scripts/smart-order-runtime/runtime-gap-coordinator.mjs` | `smart-order-runtime-gap-coordinator/2026-08-12.1`／`c1f78f51eac7a91ee6e9440c595969380367748f91ae61dcb92c80cd5c43a117` | 單一RuntimeEpoch private baseline、同步closure及durable invalidation boundary對照 |
| `scripts/smart-order-runtime/runtime-gap-coordinator.test.mjs` | `d308c1d0c053e0cd9cb986fe0a9ee3f4066f3d867fea3563fbc3bf3392f7d7a7` | one-shot baseline、reentrant gap、stop-final與SSE authority absent離線回歸 |
| `scripts/smart-order-runtime/repository-worker.mjs` | `3fce4871fa0563c6b9433776cf4c19a541186723634aa47d42c6108add8189dc` | durable epoch、blocker、restart recovery、lifecycle audit與stop CAS對照 |
| `scripts/smart-order-runtime/repository.test.mjs` | `75a6fd33c3db5bdab3481056d3a9c050297140fefc9d59baf138975089fe5340` | dispatch recovery、generation／continuity invalidation、quiesce／stop及migration fault離線回歸 |

若綁定 artifact 的版本或 SHA-256 改變，本 sign-off 立即失效，必須重新審查；不得只更新程式常數、review 或 evidence 文字沿用本紀錄。其他輸入只用於判斷書面模型可實作性與辨識目前 integration gap，不把現有離線測試冒充 Gate、真實mode attestation、完整SSE continuity或broker evidence。

## 審查範圍

本角色逐項審查：

1. RuntimeEpoch 的starting／fenced／reconciling／observe-only／ready-unarmed／write-armed／quiescing與terminal分類、唯一sender、full reconciliation及user re-arm路徑。
2. process-scoped ephemeral shared／exclusive mode lease與DB durable DispatchBlocker的責任分離、dispatch與mode switch linearization、crash後權威來源及TOCTOU邊界。
3. API generation、watchdog、SSE／event-loop／clock／sleep-wake continuity gap，舊fence失效、新epoch recovery及同epoch不可重新ready／arm的規則。
4. Runtime crash、macOS relogin、LaunchAgent restart、回simulation、migration、upgrade、feature啟用與rollback時，observe-only／paused及重新對帳／明確re-arm契約。
5. graceful stop、production-readonly、rollback、uninstall的quiesce／drain邊界；一般持股與Runtime obligation的區分。
6. C0–C21，尤其C3–C5、C14–C21的dispatch blocker、DB fail-stop、mode race、generation、break-glass、terminal correction及唯一保守復原。
7. `RTE-015*` process／durable fail-stop與`RTE-016` forced stop的區分，以及break-glass atomic relinquishment是否不偽造broker結果或清除未知風險。
8. 上述artifact是否能由OS lease、SQLite fence、Runtime controller與lifecycle service實作；並把現行integration／Gate缺口與artifact自身P0／P1分開記錄。

本角色不簽核真實Shioaji mode marker／`/api/v1/info`、受管8080 generation、account-scoped reconciliation、LaunchAgent／relogin實機、production-readonly實際切換、shared／exclusive mode execution lease、forced-stop操作介面或任何broker write。這些必須依各自task與Gate另行取得受管證據。

## 審查結果

### RuntimeEpoch、single sender 與 re-arm

- 新process只能由`RTE-001 starting`開始，取得OS single-writer lock、DB fence、private repository及simulation plan後才到fenced；第二個process沒有sender authority，只能readonly或退出。
- fenced必須先進reconciling，再以同epoch durable full reconciliation evidence到observe-only；observe-only只能在全部readiness及無open blocker時到ready-unarmed，最後還需使用者明確arm才到write-armed。
- readiness失效、gap或mode／generation變動使epoch退回observe-only／reconciling；沒有從starting／fenced／quiescing繞過full reconciliation到write-armed的捷徑。
- terminal epoch不能重新arm。restart、relogin、LaunchAgent recovery、migration、upgrade、回simulation或feature首次啟用都必須建立新epoch、保留既有義務、先reconcile且預設observe-only／paused；舊write master、strategy arm與prepared intent不自動繼承。

### Ephemeral mode lease 與 DurableDispatchBlocker

- artifact明確把OS／process shared execution lease與exclusive mode-switch lease定義為ephemeral synchronization；process crash由OS釋放，DB不得宣稱lease仍存在。
- adapter取得socket authority前，Runtime在持有shared lease時以同一fsync transaction把Activation／OrderIntent轉dispatching、burn一次性nonce、保存sender fence並建立`DurableDispatchBlocker.open`；缺任一項不得交付authority。
- 正常程序持有shared lease到acknowledged／terminal／unknown／reconciling與blocker clearance同transaction durable；只有HTTP response或memory ack不足以釋放。DB commit失敗時sender撤銷authority並process fail-stop，最後durable intent／open blocker繼續阻擋。
- mode switch先阻止新shared lease、等待live leases歸零，再掃描durable blocker與non-terminal side effects；crash使lease消失時，open blocker仍迫使fixed-account reconciliation，故不能用「exclusive lock已可取得」猜測舊write未送。
- C15的shared／exclusive競態與C3／C5／C14的crash分工一致：ephemeral lock解決活程序linearization，durable blocker解決crash與重啟後不確定性，兩者沒有互相冒充durability。

### API generation 與 continuity gap

- API generation是RuntimeEpoch、dispatch fence、mode marker與evidence的一部分；generation一旦改變，舊epoch只能superseded／reconciling並失去sender authority，新epoch從starting重新取得fence與full reconciliation。
- event-loop pause、wall-clock jump、sleep／wake、SSE disconnect／cursor／sequence／epoch及invalid continuity input均屬fail-closed gap；先同步關閉本process dispatch，再durable轉Runtime／active strategy／intent／reservation到recovery、reconciling或unknown。
- 同epoch的continuity latch不可reset、restore或靠後續healthy sample解除；重新對帳後仍需新epoch及user re-arm。SSE若沒有Gate驗證的continuity producer，模型允許以authority absent維持disabled fail closed，不能虛構精確event gap。
- generation watcher／watchdog／reconnect只可觸發reconciliation，不能授權broker write或自動恢復trailing extreme、crossing、missed schedule與舊prepared intent。

### Crash、relogin、upgrade 與 lifecycle drain

- C0–C2只處理尚未取得adapter authority的create／prepared事實；C3起即使第一byte前crash也只可unknown／reconciling，舊nonce永不重送。C4／C5／C6／C7依最後durable broker evidence恢復，不信memory response或arrival order。
- C14在broker結果已知但DB/fsync失敗時只允許process fail-stop；若DB無法commit，不得虛構`failed_stop`。新epoch先restore／integrity及full broker reconciliation，再處理open blocker。
- C16 generation change、C17純monitoring crash及formal spec中的relogin／upgrade／migration都維持observe-only／recovery；策略、prepared intent及行情極值不自動resume。這為macOS登出登入與LaunchAgent restart提供同一保守模型，不把程序自啟描述為保護已恢復。
- quiescing先禁止新lease，lifecycle audit逐項列strategy、side-effect intent、BrokerOrder、reservation、claim、obligation及RuntimeTrackedUnprotectedRemainder。一般持股若無Runtime obligation不誤擋；paused／quiesced且零side effect可留唯讀資料，但graceful stop／rollback／uninstall仍依各自更嚴格drain policy。
- graceful stopped要求lease歸零、無open durable blocker、required drain通過、snapshot durable且同epochfull reconciliation；唯一例外只在sender authority從未取得且repository可證明完全沒有歷史side effect／obligation。

### Forced stop、break-glass 與 terminal recovery

- `RTE-015*`只在DB仍能可靠commit且sender fence／policy失效時保存durable failed-stop；DB／fsync本身失敗時只可process fail-stop，權威epoch停在最後成功commit的state。
- `RTE-016`只從quiescing進forced failed-stop，且epoch transition、每個released／failed local entity、ResolutionCase、`RelinquishedUnknownExposure.open`、burned nonces、二次確認及audit snapshot必須同一SQLite transaction；該commit是唯一linearization point。
- C18／C19讓break-glass transaction全成或全敗；commit前義務仍受監控／阻擋，commit後只能顯示unmonitored且相衝突write仍由durable unknown-exposure blocker拒絕。break-glass不製造cancelled、filled、zero-fill或broker風險已消失的敘述。
- C20／C21保留terminal entity不可回轉，晚到矛盾證據新增ResolutionCase／SafetyBlocker及immutable correction；correction transaction失敗時blocker保持open，不會因forced stop或terminal history繞過風險處理。

## Finding closure、integration gap 與再審

| Finding ID | Severity | 處置 | 本次再審結果 |
|---|---|---|---|
| `RM-P0-01 OS lease treated as durable` | P0 | 分離ephemeral shared／exclusive lease與DurableDispatchBlocker；crash只釋放OS lease，不清除blocker | `closed`；C3／C5／C14／C15以最後durable事實復原 |
| `RM-P0-02 generation preserves sender authority` | P0 | generation改變使舊fence失效、舊epochsuperseded／reconciling，新epochstarting且需full reconcile＋user arm | `closed`；terminal／superseded epoch無re-arm edge |
| `RM-P0-03 DB failure fabricates failed_stop` | P0 | `RTE-015*`只在DB可可靠commit時使用；commit／fsync失敗僅process fail-stop | `closed`；C14明定權威state停在最後durable revision |
| `RM-P0-04 forced stop loses unknown exposure` | P0 | `RTE-016`與全部release、ResolutionCase、unknown-exposure blocker、nonce及snapshot同transaction | `closed`；C18／C19全成或全敗且write仍blocked |
| `RM-P1-01 quiesce bypasses reconciliation` | P1 | quiescing→stopped／observe-only要求同epochfull reconciliation；無reconcile只能回reconciling，極窄無歷史例外需repository proof | `closed`；沒有starting／fenced捷徑到ready或graceful terminal |
| `RM-P1-02 restart automatically resumes writes` | P1 | restart／relogin／upgrade／migration／simulation return一律新epochobserve-only／paused，prepared也需fresh re-arm | `closed`；LaunchAgent自啟不等於保護自動恢復 |
| `RM-P1-03 continuity healthy sample clears gap` | P1 | gap先同步latch，後續healthy sample、UI、restore或同epochreconcile皆不能reset；只能新epoch | `closed`；SSE authority缺失時維持disabled fail closed |
| `RM-P1-04 lifecycle omits blocking entity` | P1 | drain涵蓋non-terminal strategy／intent／BrokerOrder／reservation／claim／obligation／tracked remainder，並排除無obligation一般持股 | `closed`；一般、production-readonly與break-glass語意分離 |
| `RM-IMPL-01 shared/exclusive mode execution lease` | Gate 1 blocker（非artifact P0／P1） | task 4.1仍須完成per-write shared lease、write-adjacent marker＋`/info`雙重attestation與exclusive mode switch；目前OS lease只證明單一Runtime process | `open_current_integration`；disabled adapter維持零broker authority |
| `RM-IMPL-02 lifecycle switch/drain` | Gate 1 blocker（非artifact P0／P1） | task 4.3／4.4／4.8／4.9仍須完成production-readonly、逐項drain UI／CLI、rollback／uninstall及mid-flight／relogin實機測試 | `open_current_integration`；不得以repository子集合宣稱完整lifecycle |
| `RM-IMPL-03 generation/relogin/upgrade recovery` | Gate 1 blocker（非artifact P0／P1） | task 4.5／4.6仍須串接受管watchdog、trade resubscribe、account reconciliation、relogin／upgrade／migration readiness；目前generation closure只完成fail-closed子路徑 | `open_current_integration`；新epoch不得解鎖write |
| `RM-IMPL-04 continuity authorities` | Gate 1 blocker（非artifact P0／P1） | task 5.8仍缺可信SSE continuity producer與完整platform sleep／wake authority；現有clock／event-loop／generation coordinator明確回報`disabled_fail_closed` | `open_current_integration`；不得把detector能力冒充完整SSE coverage |
| `RM-IMPL-05 forced-stop operation` | Gate 1 blocker（非artifact P0／P1） | task 6.10及lifecycle tasks仍須完成opaque break-glass resolution service、二次確認UI／CLI、atomic repository operation與end-to-end fault injection | `open_current_integration`；無一般force flag可替代 |
| `RM-20260812-01 independent re-review` | 無新artifact finding | 重新比對artifact、formal mode spec、OS lease、Runtime controller、gap reducer／coordinator、repository lifecycle及C0–C21 | `closed_no_finding`；artifact範圍無open P0／P1 |

## 機械證據

| 指令／檢查 | 結果 |
|---|---|
| `shasum -a 256` 綁定artifact、formal spec與十個Runtime對照檔 | 所有值與本紀錄「審查輸入與內容雜湊」一致 |
| `pnpm exec vitest run scripts/smart-order-runtime/exclusive-runtime-lease.test.mjs scripts/smart-order-runtime/runtime-controller.test.mjs scripts/smart-order-runtime/runtime-gap-detector.test.mjs scripts/smart-order-runtime/runtime-gap-coordinator.test.mjs scripts/smart-order-runtime/repository.test.mjs` | 5 files／124 tests通過；因測試需要建立repo外暫時Unix socket，於允許Unix socket的本機離線環境執行 |
| `openspec validate add-durable-smart-order-panel-and-protective-exits --strict` | 通過 |
| `git diff --check` | 通過 |

上述測試只建立暫時Unix socket與SQLite fixture；沒有連線8080、沒有讀取或保存帳號、沒有建立行情／trade subscription，也沒有啟動、停止、重啟或切換任何既有服務，並未發出place／update／cancel。

## Sign-off conclusion

對綁定的`smart-order-state-transitions/2026-08-11.4`／SHA-256 `e788bb3981e4784ee797277a73257b1fb8e68899b0b2bacc93c76016b4926d0d`，本Runtime／mode reviewer確認：RuntimeEpoch、single sender、ephemeral shared／exclusive lease與durable blocker分工、API generation／continuity gap、crash／relogin／upgrade、quiesce／drain、C0–C21及forced-stop／break-glass在artifact內自洽、可實作，且與正式spec沒有發現矛盾；本角色範圍沒有未關閉的artifact P0／P1 finding，予以正式sign-off。

此sign-off只是task 0.11要求的五個角色之一。其他角色finding closure與task 4.1／4.3–4.6／4.8–4.9／5.8／6.10的受管證據未完成前，task 0.11不得因本紀錄單獨宣稱完成，artifact也不得成為gate manifest的`passed` conjunct；Gate 0／1、一般write master、simulation broker write、production與CA全部維持fail closed。
