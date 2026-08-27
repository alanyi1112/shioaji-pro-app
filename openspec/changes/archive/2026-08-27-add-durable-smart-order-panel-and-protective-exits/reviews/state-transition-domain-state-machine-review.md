# 狀態轉移 domain／state-machine 正式審查紀錄

## 審查識別

- 審查紀錄版本：`smart-order-state-transition-domain-review/2026-08-12.1`
- 審查日期：2026-08-12（Asia/Taipei）
- 審查角色：domain／state-machine reviewer
- 審查者：Codex 獨立審查角色
- 對應 change：`add-durable-smart-order-panel-and-protective-exits`
- 對應 task：0.11 的 domain／state-machine 正式書面 review
- 綁定 artifact 版本：`smart-order-state-transitions/2026-08-11.4`
- 綁定 artifact SHA-256：`e788bb3981e4784ee797277a73257b1fb8e68899b0b2bacc93c76016b4926d0d`
- 審查結果：本角色範圍內 `sign-off`；沒有未關閉的 P0／P1 finding

本紀錄只代表 domain／state-machine 角色完成正式審查。它不取代 repository／outbox、broker adapter／reconciliation、risk／protection、Runtime／mode 四個角色的 sign-off，不會單獨完成 task 0.11，也不構成 Gate 0／1、broker adapter、simulation write、production、CA 或任何交易寫入的解鎖證據。

## 審查輸入與內容雜湊

| 輸入 | 版本／SHA-256 | 用途 |
|---|---|---|
| `smart-order-state-transition-tables.md` | `smart-order-state-transitions/2026-08-11.4`／`e788bb3981e4784ee797277a73257b1fb8e68899b0b2bacc93c76016b4926d0d` | 本次正式審查的唯一書面狀態模型基線 |
| `src/lib/smart-order-state-machine.ts` | `smart-order-state-machine-implementation/2026-08-12.9`／`e2f5d393d735619cf454b1ba69e70c74da162cf1e42b60c55160426c3e03f089` | typed state、edge、reason、terminal 與 companion registry 的機械對照 |
| `src/lib/smart-order-state-machine.test.ts` | `542e18d2a08065aa2e3f1dd9dd91d47c02d5a737e98b70ecb792a24af8aae2ba` | artifact hash binding、完整 edge 展開及狀態不變量回歸 |
| `src/lib/smart-order-activation-domain.ts` | `5abad8268d74a662cf3ed5836e496a9dfc41f8e78e66971d28359aa8e008f065` | domain-separated Activation ID、stable serialization 與 edge／slot identity 對照 |
| `src/lib/smart-order-activation-domain.test.ts` | `a72bc0dfc5e7a0f24fb368d9b10eea243424c068f25ff556620dd6fc98d96ad2` | duplicate／reorder／definition hash／schedule slot 的 deterministic 驗證 |

若綁定 artifact 的版本或 SHA-256 改變，本 sign-off 立即失效，必須重新審查；不得只更新程式常數或 evidence 文字沿用本紀錄。

## 審查範圍

本角色逐項審查：

1. Strategy、Activation、OrderIntent、BrokerOrder 及 PendingProtectionCommitment、ProtectionObligation、EntryExposureReservation、ExitClaim／ExternalSellClaim、RuntimeEpoch、DurableDispatchBlocker、SafetyBlocker、ResolutionCase 的狀態集合與 terminal／non-terminal／blocking 分類。
2. 每個 typed edge 的單一 from／to、actor allowlist、broker-write provenance、reason code、required evidence class、revision 與 atomic companion 契約。
3. terminal entity 不回轉、`manual_intervention` 僅屬 Strategy、operation-specific OrderIntent outcome、BrokerOrder canonical quantity finality與 non-draft Strategy definition 不可變性。
4. deterministic Activation ID 的 domain separation、canonical serialization、immutable `strategyDefinitionHash`、logical key 與 conflict fail-closed 契約。
5. C0–C21 crash windows 的最後 durable 事實、權威狀態、必要復原及 retry 判定，以及未列時間點套用較嚴格相鄰 window 的規則。
6. reason registry、manual resolution、SafetyBlocker／ResolutionCase boundary與十九項跨實體原子 invariant，在 domain model 內是否自洽且與正式 specs 無矛盾。

本角色不簽核 SQLite transaction／migration／fsync 的實際 durability、真實 broker account-scoped evidence、外部 working-order 集合完整性、risk／PnL／reservation 的 production authority、shared／exclusive mode lease 或生命週期實際整合；這些分別屬其餘四個正式審查角色與後續 Gate。

## 審查結果

### 狀態、edge 與 terminal 分類

- 書面表與 current machine registry 對齊；registry 完整展開為 259 個單一 from／to edge，涵蓋 13 個 entity kind。
- terminal state 沒有 outgoing edge；`unknown`維持 blocking non-terminal，terminal evidence conflict 只建立新 ResolutionCase／SafetyBlocker／correction，不回轉原 entity。
- `manual_intervention`只存在 Strategy；BrokerOrder、OrderIntent、claim、reservation與obligation保留各自的`unknown`／`reconciling`／`safety_blocked`。
- 非 `draft` Strategy 的 immutable definition 與 `strategy_definition_hash`不可原地改寫；修改只能 copy-to-draft 取得新 strategy lineage。
- broker socket authority只可能出現在 `ACT-007`、`INT-002`與同一 dispatch transaction 的`DDB-001`；browser／event／reconciliation不能偽造 write provenance。

### Reason、evidence 與 atomic companion

- reason registry 有 136 個完整 metadata definition；edge 引用的每個 reason 都綁定唯一 required evidence class。
- grouped edge、`同上`與 owner／reason variant 均在 machine registry 展開；執行期沒有 wildcard、文字 prefix 或 UI 指定 from／to／reason 的路徑。
- entry prepare、dispatch fence、ack／unknown／terminal、OCO winner、break-glass、terminal correction與 blocker supersede 的 atomic companion set 均有明確 fail-closed 契約。
- rejection／journal 或 blocker root-cause reason 可以不直接作 entity transition edge；這不等於缺少 registry definition，也不得拿來繞過 typed edge allowlist。

### Deterministic Activation ID

- Artifact 固定 `realtimestock.smart-order.activation/v1\n` domain、canonical JSON與 base32lower SHA-256；ID 不含帳號、秘密、mutable Strategy revision、callback時間或 browser 隨機值。
- edge、multi-condition、daily、schedule slot、parent-child與protection remainder 的 logical key 在書面模型中各自唯一；duplicate／reordered observation、OR 同時命中、missed slot、duplicate deal與 OCO sibling 不得產生第二個 logical activation。
- Current domain implementation已機械驗證 task 1.9 所需的 edge與schedule-slot identity；其餘策略型別仍是後續功能實作範圍，但書面 key model 已完整且不構成本次 domain 書面 sign-off 的未關閉 finding。
- hash collision、canonical key矛盾、counter回退或 immutable definition矛盾均固定為`ACTIVATION_ID_CONFLICT`並 fail closed，不得加隨機 suffix 規避去重。

### Crash windows 與復原唯一性

- C0–C21 共22個 window均明列最後 durable 事實、crash後權威狀態、必要復原與可否 retry。
- 只有 C0 可重送 create request；C1／C2 的 proven-unsent intent仍需 reconciliation及使用者 re-arm，不能自動 retry。
- C3 起已有 durable dispatch fence／nonce／blocker，無論第一個 socket byte是否實際送出都只能 unknown／reconciling，原 operation不得重送。
- partial fill、OCO winner、cancel-fill race、DB commit failure、mode race、generation change、break-glass與terminal evidence correction均有唯一 fail-closed 復原結果。
- 未列的實際故障點明確歸入最後 durable commit後、下一個 durable commit前的較嚴格 window，因此書面模型沒有「猜測未送」或「記憶體結果冒充 durable」的未定分支。

## Finding closure 與再審

| Finding ID | Severity | 處置 | 本次再審結果 |
|---|---|---|---|
| `ST-P0-01 manual_intervention scope` | P0 | `manual_intervention`限Strategy；其他entity使用typed blocking state並連ResolutionCase | `closed`；狀態分類與machine guard一致 |
| `ST-P0-02 terminal conflict rollback` | P0 | terminal永不回轉；矛盾證據另建ResolutionCase、SafetyBlocker與immutable correction | `closed`；terminal outgoing edge機械拒絕 |
| `ST-P0-03 incomplete reason/edge registry` | P0 | 建立完整typed edge、reason metadata、evidence及atomic companion registry | `closed`；259 edges／136 reasons完整且hash-bound |
| `ST-P0-04 OCO activation impossible model` | P0 | 每個remainder generation只建立一個Activation；legs為無broker authority的evaluation children | `closed`；winner／suppressed與單一claim lineage一致 |
| `ST-P0-05 OrderIntent operation ambiguity` | P0 | 固定`place | update | cancel`、typed owner、target revision與operation-specific outcome | `closed`；outcome不能取代BrokerOrder final state |
| `ST-P0-06 entry remainder/zero-fill ambiguity` | P0 | 固定requested／filled／openPotential／terminalUnfilled等式，分離partial terminal與true zero-fill | `closed`；書面quantity invariant互斥且完整 |
| `ST-P0-07 break-glass erases unknown exposure` | P0 | break-glass原子建立durable `RelinquishedUnknownExposure` blocker並burn nonce | `closed`；release不冒充broker finality且仍阻擋衝突write |
| `ST-P0-08 OS lease treated as durable` | P0 | 分離ephemeral OS lease與durable DispatchBlocker | `closed`；C3／C5／C14／C15復原均依durable blocker |
| `ST-P1-01 actor/provenance conflation` | P1 | 分離單一`actor_kind`、authorization evidence與broker-write provenance | `closed`；broker event／reconciliation固定provenance=`none` |
| `ST-P1-02 wildcard/blocking gaps` | P1 | grouped edge機械展開，blocking scope由typed SafetyBlocker決定 | `closed`；registry無runtime wildcard或prefix matching |
| `ST-P1-03 protectedShares ambiguity` | P1 | `protectedShares`只由distinct、fresh、non-unknown ExitClaim投影 | `closed`；與filled／exited／unprotected等式一致 |
| `DSM-20260812-01 independent re-review` | 無新finding | 重新比對artifact、spec、machine registry、Activation ID與C0–C21 | `closed_no_finding`；本角色範圍無open P0／P1 |

## 機械證據

| 指令／檢查 | 結果 |
|---|---|
| `shasum -a 256` 綁定artifact及四個domain檔 | 所有值與本紀錄「審查輸入與內容雜湊」一致 |
| `pnpm exec vitest run src/lib/smart-order-state-machine.test.ts` | 1 file／38 tests通過 |
| `pnpm exec vitest run src/lib/smart-order-activation-domain.test.ts` | 1 file／30 tests通過 |
| `pnpm exec tsc -b --pretty false` | 通過 |
| `openspec validate add-durable-smart-order-panel-and-protective-exits --strict` | 通過 |
| `git diff --check` | 通過 |

測試與檢查皆未連線8080、未讀取帳號、未建立行情subscription，也未發出place／update／cancel。

## Sign-off conclusion

對綁定的`smart-order-state-transitions/2026-08-11.4`／SHA-256 `e788bb3981e4784ee797277a73257b1fb8e68899b0b2bacc93c76016b4926d0d`，本domain／state-machine reviewer確認：allowlisted transition、terminal分類、reason/evidence/companion registry、deterministic Activation ID、non-draft不可變性與C0–C21 crash recovery書面模型，在本角色範圍內沒有未關閉P0／P1 finding，予以正式sign-off。

此sign-off只是task 0.11要求的五個角色之一。其餘四角色、finding closure及總體evidence尚未完成前，task 0.11 MUST維持未勾選，artifact不得成為gate manifest的`passed` conjunct；所有broker write、Gate解鎖、production與CA仍維持fail closed。
