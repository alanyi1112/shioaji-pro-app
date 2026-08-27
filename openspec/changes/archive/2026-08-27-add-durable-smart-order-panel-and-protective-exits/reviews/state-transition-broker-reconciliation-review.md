# 狀態轉移 broker adapter／reconciliation 正式審查紀錄

## 審查識別

- 審查紀錄版本：`smart-order-state-transition-broker-reconciliation-review/2026-08-12.1`
- 審查日期：2026-08-12（Asia/Taipei）
- 審查角色：broker adapter／reconciliation reviewer
- 審查者：Codex 獨立審查角色
- 對應 change：`add-durable-smart-order-panel-and-protective-exits`
- 對應 task：0.11 的 broker adapter／reconciliation 正式書面 review
- 綁定 artifact 版本：`smart-order-state-transitions/2026-08-11.4`
- 綁定 artifact SHA-256：`e788bb3981e4784ee797277a73257b1fb8e68899b0b2bacc93c76016b4926d0d`
- 審查結果：本角色的**書面模型範圍**予以 `sign-off`；沒有未關閉的模型 P0／P1 finding

本紀錄只代表 broker adapter／reconciliation 角色完成綁定 artifact 的正式書面審查。它不表示真實 adapter、account-scoped broker capability、simulation probe、Gate 0／1、production、CA 或任何 broker write 已可使用；目前所有寫入仍 MUST fail closed，且本次審查沒有連線 8080、沒有讀取帳號、沒有建立 broker subscription，也沒有執行 place／update／cancel。

## 審查輸入與內容雜湊

| 輸入 | 版本／SHA-256 | 用途 |
|---|---|---|
| `smart-order-state-transition-tables.md` | `smart-order-state-transitions/2026-08-11.4`／`e788bb3981e4784ee797277a73257b1fb8e68899b0b2bacc93c76016b4926d0d` | 本次正式審查的唯一書面狀態模型基線 |
| `src/lib/smart-order-state-machine.ts` | `smart-order-state-machine-implementation/2026-08-12.9`／`e2f5d393d735619cf454b1ba69e70c74da162cf1e42b60c55160426c3e03f089` | broker／intent typed edge、terminal、quantity 與 control target 的機械對照 |
| `src/lib/smart-order-state-machine.test.ts` | `542e18d2a08065aa2e3f1dd9dd91d47c02d5a737e98b70ecb792a24af8aae2ba` | artifact hash、非法 edge、quantity evidence 與 terminal invariant 回歸 |
| `scripts/smart-order-runtime/broker-event-normalizer.mjs` | `smart-order-broker-event/2026-08-12.1`／`dfdc25752ef5c031d62908847dccf7e7f634dcb97ae7121009b92a7be5178aa4` | account／trade-date／identifier／quantity event envelope 可實作性對照 |
| `scripts/smart-order-runtime/broker-event-normalizer.test.mjs` | `d21a2ca78a2eb65ccb6d19f38338ab75f3dd0ea894b8c98d8e1c9ff8186ee352` | duplicate、同交易日短 ID collision 與跨日分離的離線回歸 |
| `scripts/smart-order-runtime/broker-dispatch-coordinator.mjs` | `smart-order-broker-dispatch-coordinator/2026-08-12.2`／`2ff9c27abe9f885af79a25f0b8b060663e39120f3c6382ae14a5f0ed1753b058` | fenced authority、unknown durable 化、no-retry 與 fail-stop 對照 |
| `scripts/smart-order-runtime/broker-dispatch-coordinator.test.mjs` | `546d6b09c56cf5c0a0ef12da78023d2ea8c5ac7e63bb17eac8122f4834e09bee` | 第一 byte 前後與 adapter result／DB commit failure 的離線回歸 |

若綁定 artifact 的版本或 SHA-256 改變，本 sign-off 立即失效，必須重新審查；不得只更新程式常數、review 或 evidence 文字沿用本紀錄。其他輸入只用於判斷模型可實作性與辨識目前 integration gap，不把現有測試結果冒充 Gate 或真實 broker 證據。

## 審查範圍

本角色逐項審查：

1. fixed account tuple、`Asia/Taipei trade_date`、contract、side、immutable broker identifiers、position／working set 與 evidence class 是否能形成 account-scoped correlation／reconciliation 邊界。
2. order／deal／HTTP response 的 duplicate、out-of-order、event-before-ack、partial fill、cancel-fill race、跨日短 ID collision 及 SSE／generation gap 是否不依到達順序推進錯誤結果。
3. BrokerOrder terminal finality、terminal evidence conflict 不回轉，以及 OrderIntent operation outcome 不冒充 BrokerOrder final state。
4. `quantityShares = filledShares + remainingShares`、累計成交單調性、full-fill unique-final binding、zero-fill／partial／open potential 與 reservation／claim settlement 所需的 canonical quantity evidence。
5. update／cancel 的 fixed account target、trade date、contract、side、immutable IDs、`controlRevision`、`targetRevision`、expected remaining quantity、per-order serialization及 write-adjacent pre-byte／possibly-sent 分界。
6. durable dispatch fence 後的 single nonce、`unknown`／`reconciling`、no automatic retry、prepared proven-unsent re-arm，以及 C0–C21 每個 crash window 的唯一保守復原。
7. 上述書面模型是否能由 typed edge、CAS、account-scoped reconciler及 broker adapter 實作；並把尚未完成的 runtime／Gate integration 與 artifact 自身的 P0／P1 缺陷分開記錄。

本角色不簽核 Gate 0 真實 capability、正式固定帳號欄位、Shioaji live-readonly／simulation contract、外部 working-order 集合完整性、production route coverage、CA、風控／PnL authority或 broker write。這些必須依各自 task 與 Gate 另行取得受管證據。

## 審查結果

### Account-scoped evidence 與 correlation

- BrokerOrder 與 control intent 的書面 identity 同時固定 account、trade date、contract、side、broker identifiers／correlation hash及revision；UI current account、server default與單獨 `custom_field` 均沒有 authority。
- broker working、ack、final、manual resolution與 terminal correction 各自要求 `BrokerAccountSnapshotEvidence`、`BrokerDealOrderPositionEvidence`或更嚴格的 conflicting evidence；通知、單一 SSE event、口述或只有 accepted status 不能成為 finality。
- 同交易日短 ID collision、缺 trade date、account mismatch或多 candidate 一律進 `unknown`／ResolutionCase／SafetyBlocker；跨日相同 seqno／ordno 不得關聯到舊單。
- account-scoped evidence 的內容可由 canonical event envelope承載，但目前 in-memory event ledger不是 durable correlation repository，也不是 full account reconciler；此差異列為 integration gate blocker，不是書面模型finding。

### Event reorder 與 terminal finality

- C6 明定 event 早於 HTTP response 時依最後 durable commit而非到達順序決定權威狀態；duplicate-safe replay與account reconciliation負責補齊，不會建立第二個 BrokerOrder／intent。
- partial fill採累計量單調前進；C8／C9把記憶體 event與domain transaction分開；C13要求cancel與fill兩側未完成account-scoped orders／trades／deals／position final reconciliation前保持non-terminal／`unknown`。
- BrokerOrder terminal 沒有 outgoing edge。terminal後矛盾證據只新增ResolutionCase、SafetyBlocker及immutable TerminalEvidenceCorrection，原terminal state／revision不回轉，避免以晚到事件覆寫既有歷史。
- OrderIntent 的`place | update | cancel` outcome只結束該operation；例如`cancel_applied`不能直接代表BrokerOrder `cancelled`，broker final state仍由獨立final reconciliation推進。

### Quantity evidence 與 update／cancel target

- BrokerOrder保存positive base `Share`三量並永遠平衡；accepted狀態不能含confirmed fill，partial必須同時有正filled／remaining，filled必須full quantity且remaining為0。
- `BRO-004*`／`BRO-005*`要求唯一、schema-versioned `BrokerDealOrderPositionEvidence`精確綁定broker order、fixed account、trade date、contract、side、correlation及三量；full fill另要求`outcome=filled`、`finality=unique_final`。cancel／inactive／failed也明定final quantities與相同evidence family，C13再要求以account-scoped orders／trades／deals／position確認競態後的最終量。
- update／cancel先以same-state BrokerOrder edge原子增加`controlRevision`、建立owner-matched intent與target reservation；intent固定target account、trade date、contract、side、IDs、revision與expected remaining quantity。
- queue／lock等待後若target在adapter authority前改變，只能得到operation-specific`*_stale_target_prebyte`且不得送byte；若已取得authority或無法證明零byte，必須進`reconciling`／`unknown`，不得用stale outcome或舊Trade重送。

### No-retry、unknown 與 C0–C21

- C0只允許重送create request；C1／C2僅在仍為prepared、證明adapter從未取得authority、完成新epoch reconciliation與使用者re-arm後，才可執行原intent一次，且不是automatic retry。
- C3一旦dispatching＋nonce＋fence＋DurableDispatchBlocker commit，即使crash發生在第一個byte前也永久失去proven-unsent資格；同nonce不能回prepared、不能排回write queue、不能取得第二次authority。
- C4–C21對response loss、記憶體ack、event reorder、partial fill、OCO、cancel-fill、DB fsync、mode race、generation、break-glass及terminal correction均固定為account-scoped reconcile、blocking unknown或transaction全成／全敗；沒有依「可能沒送」猜測自動重送的分支。
- 未列出的實際故障點歸入最後durable commit後、下一個durable commit前的較嚴格window，使adapter與reconciler可以用最後durable revision唯一決定fail-closed復原。

## Finding closure、integration gap 與再審

| Finding ID | Severity | 處置 | 本次再審結果 |
|---|---|---|---|
| `BRA-P0-01 cross-account correlation` | P0 | correlation與evidence固定account tuple、trade date、contract、side及verified identifiers；account mismatch／collision進blocking resolution | `closed`；無跨帳號fallback或UI current-account authority |
| `BRA-P0-02 arrival-order finality` | P0 | event-before-ack、duplicate、partial、cancel-fill及terminal conflict都依durable revision與account full reconciliation，不依接收先後 | `closed`；C6／C8／C13／C20有唯一保守結果 |
| `BRA-P0-03 post-dispatch duplicate write` | P0 | dispatching前durable nonce／fence／blocker；C3起unknown／reconcile且原nonce永久不可retry | `closed`；只有C1／C2 proven-unsent可在reconcile＋user re-arm後執行一次 |
| `BRA-P1-01 operation/finality conflation` | P1 | OrderIntent operation-specific outcome與BrokerOrder state分離；cancel/update結果不能冒充target finality | `closed`；terminal outcome allowlist與broker terminal edge獨立 |
| `BRA-P1-02 stale update/cancel target` | P1 | controlRevision CAS、immutable target及pre-byte／possibly-sent分界；target改變時作廢或unknown，不重用舊Trade | `closed`；模型可由per-account／per-order arbiter實作 |
| `BRA-P1-03 quantity evidence ambiguity` | P1 | base-Share平衡、累計單調、unique-final full fill、final cancel quantities、entry／exit等式與evidence family明文化 | `closed`；accepted／單一event／零deal不能偽造filled或zero-fill |
| `BRA-P1-04 non-unique crash recovery` | P1 | C0–C21明列最後durable事實、權威狀態、必要復原與retry判定，未列點採較嚴格相鄰window | `closed`；沒有模型未定或自動重送分支 |
| `BRA-IMPL-01 live account capability` | Gate 0 blocker（非模型P0／P1） | task 0.3／0.3b／0.4／2.7尚須受管fixed-account、trade-date、ID與update/cancel contract證據 | `open_current_integration`；不得用fixture或本review解鎖 |
| `BRA-IMPL-02 adapter/reconciler wiring` | Gate 1 blocker（非模型P0／P1） | current Runtime使用disabled broker adapter；task 5.1／5.2／5.5尚未完成production-path account-scoped adapter、write-adjacent target重驗與durable event reconciler | `open_current_integration`；broker write維持fail closed |
| `BRA-IMPL-03 fault-injection coverage` | Gate 1 blocker（非模型P0／P1） | task 5.12／12.1／12.4仍須補event reorder、C0–C21、stale target與cancel-fill fault injection | `open_current_integration`；現有離線測試只證明已實作子集合 |
| `BRA-20260812-01 independent re-review` | 無新模型finding | 重新比對artifact、formal specs、typed state machine、event normalizer、dispatch coordinator及C0–C21 | `closed_no_finding`；書面模型範圍無open P0／P1 |

## 機械證據

| 指令／檢查 | 結果 |
|---|---|
| `shasum -a 256` 綁定artifact與六個對照檔 | 所有值與本紀錄「審查輸入與內容雜湊」一致 |
| `pnpm exec vitest run src/lib/smart-order-state-machine.test.ts scripts/smart-order-runtime/broker-event-normalizer.test.mjs scripts/smart-order-runtime/broker-dispatch-coordinator.test.mjs` | 3 files／57 tests通過 |
| `openspec validate add-durable-smart-order-panel-and-protective-exits --strict` | 通過 |
| `git diff --check` | 通過 |

上述測試與檢查皆為本機離線驗證；沒有連線8080、沒有讀取或保存帳號、沒有建立行情／trade subscription，也沒有發出place／update／cancel。

## Sign-off conclusion

對綁定的`smart-order-state-transitions/2026-08-11.4`／SHA-256 `e788bb3981e4784ee797277a73257b1fb8e68899b0b2bacc93c76016b4926d0d`，本broker adapter／reconciliation reviewer確認：account-scoped evidence、event reorder、terminal finality、canonical quantity evidence、update／cancel target revision、no-retry／unknown邊界及C0–C21 crash recovery在書面模型內自洽、可實作，且與正式spec沒有發現矛盾；本角色範圍沒有未關閉的模型P0／P1 finding，予以正式sign-off。

此sign-off只是task 0.11要求的五個角色之一。其他角色sign-off與task 0.3／0.3b／0.4／2.7／5.1／5.2／5.5／5.12／12.1／12.4的受管證據未完成前，task 0.11不得因本紀錄單獨宣稱完成，artifact也不得成為gate manifest的`passed` conjunct；Gate 0／1、一般write master、simulation broker write、production與CA全部維持fail closed。
