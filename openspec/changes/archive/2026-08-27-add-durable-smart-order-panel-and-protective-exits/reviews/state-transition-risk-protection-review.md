# 狀態轉移 risk／protection 正式審查紀錄

## 審查識別

- 審查紀錄版本：`smart-order-state-transition-risk-protection-review/2026-08-12.1`
- 審查日期：2026-08-12（Asia/Taipei）
- 審查角色：risk／protection reviewer
- 審查者：Codex 獨立審查角色
- 對應 change：`add-durable-smart-order-panel-and-protective-exits`
- 對應 task：0.11 的 risk／protection 正式書面 review
- 綁定 artifact 版本：`smart-order-state-transitions/2026-08-11.4`
- 綁定 artifact SHA-256：`e788bb3981e4784ee797277a73257b1fb8e68899b0b2bacc93c76016b4926d0d`
- 審查結果：本角色的**書面模型範圍**予以 `sign-off`；沒有未關閉的模型 P0／P1 finding

本紀錄只代表 risk／protection 角色完成綁定 artifact 的正式書面審查。它不表示 canonical RiskPolicy／PnlPolicy、完整固定帳號部位、外部 working sell 可見性、EntryExposureReservation／ExitClaim production ledger、保護出場 simulation acceptance、Gate 0／1、production、CA 或任何 broker write 已可使用；目前所有寫入仍 MUST fail closed。本次審查沒有連線 8080、沒有讀取帳號、沒有建立 broker／行情 subscription，也沒有執行 place／update／cancel。

## 審查輸入與內容雜湊

| 輸入 | 版本／SHA-256 | 用途 |
|---|---|---|
| `smart-order-state-transition-tables.md` | `smart-order-state-transitions/2026-08-11.4`／`e788bb3981e4784ee797277a73257b1fb8e68899b0b2bacc93c76016b4926d0d` | 本次正式審查的唯一書面狀態模型基線 |
| `specs/protective-exit-order-ticket/spec.md` | `eb3d60f5f5316355b7b4fe36a71a6ecb755e1d54b6024e9221b1bdeb2230429b` | prepare-before-entry、實際成交量、OCO remainder、外部部位及UI語意對照 |
| `src/lib/smart-order-state-machine.ts` | `smart-order-state-machine-implementation/2026-08-12.9`／`e2f5d393d735619cf454b1ba69e70c74da162cf1e42b60c55160426c3e03f089` | reservation／claim／commitment／obligation typed edge與quantity invariant機械對照 |
| `src/lib/smart-order-state-machine.test.ts` | `542e18d2a08065aa2e3f1dd9dd91d47c02d5a737e98b70ecb792a24af8aae2ba` | artifact hash、zero-fill、break-glass、OCO lineage及quantity equation離線回歸 |
| `src/lib/smart-order-risk-domain.ts` | `smart-order-risk-domain/2026-08-11.3`／`68ffc0ee10a29e9de0b814e53c1c6662dbdd0ef06d97aa4aeb5d98b3f0709c8c` | worst-case exposure、account／identity CAS、distinct claim projection及unprotected remainder可實作性對照 |
| `src/lib/smart-order-risk-domain.test.ts` | `d92cb46b409f3d358a68b1d0520faedc3d3bec9a94c10298987fab42fe07eab4` | concurrent reservation、claim三representation、scope／overlap／stale／unknown evidence離線回歸 |

若綁定 artifact 的版本或 SHA-256 改變，本 sign-off 立即失效，必須重新審查；不得只更新程式常數、review 或 evidence 文字沿用本紀錄。其他輸入只用於判斷書面模型可實作性與辨識目前 integration gap；其中 risk domain 的證據 issuer 明確位於 test-only boundary，不能冒充 Runtime authority、Gate 或真實 broker evidence。

## 審查範圍

本角色逐項審查：

1. EntryExposureReservation 是否以base `Share`、worst-case policy、account＋identity group CAS保存，是否禁止同ID擴張、漏列並發曝險或提早釋放未知量。
2. ExitClaim／ExternalSellClaim 的account＋contract＋position lineage、`remainder_generation`、distinct projection、representation轉態、active／unknown／released／consumed分類及外部 working sell邊界。
3. OCO 是否每個protection group＋remainder generation只有一個Activation、單一winner、pre-broker sibling suppression、單一claim lineage與partial-fill後新generation契約。
4. PendingProtectionCommitment／ProtectionObligation 是否在entry前與intent／reservation原子保存，以及requested／filled／open potential／terminal unfilled／materialized／exited／protected／unprotected quantity invariant。
5. true zero-fill、partial-entry terminal、partial exit、entry仍working、unknown、manual resolution及break-glass relinquishment是否互斥且不製造假的broker finality或保護覆蓋。
6. C0–C21所有crash window，特別是C8–C13、C18–C21，是否讓reservation、claim、obligation、OCO winner、terminal correction與unknown exposure得到唯一保守復原。
7. 上述書面模型是否能由repository transaction／CAS、account arbiter、reconciliation及typed state machine實作；並把尚未完成的Gate／Runtime整合與artifact自身的P0／P1缺陷分開記錄。

本角色不簽核真實position／working-order集合完整性、Share↔CommonLot contract、fee／tax／PnL資料來源、broker-confirmed average cost、risk limit產品決策、simulation smoke、外部client TOCTOU消除或任何broker write。這些必須依各自task與Gate另行取得受管證據。

## 審查結果

### EntryExposureReservation 與 account-wide worst case

- entry prepare的同一transaction固定建立OrderIntent、PendingProtectionCommitment、ProtectionObligation及policy-required EntryExposureReservation；只要RiskPolicy／PnlPolicy存在quantity、notional、cash、position或order-count可預留維度，就不得省略reservation。
- reservation以account／identity group當前baseline、所有manual／automation prepared、dispatching、working buy、既有reservation與broker position共同計算worst case；同一arbiter revision／CAS序列化並發新增曝險，避免兩筆各自合法但合計超限。
- reservation ID上限不得增加；partial fill只能消耗已確認量，proven-unsent、true zero-fill或唯一terminal remainder才可釋放，`unknown`維持blocking。消耗成actual risk與釋放terminal remainder分開，不會以「尚未成交」提早歸零。
- 書面模型可由目前的trusted worst-case vector、dual account／identity aggregate及optimistic ledger revision實作；但該domain verifier尚屬test-only，production repository／arbiter整合仍是Gate blocker。

### ExitClaim generation、distinct projection 與 OCO

- ExitClaim固定account＋contract＋long-position lineage；`remainder_generation`只代表一次可競爭的剩餘量。同一generation滿足`reservedShares = consumedShares + releasedShares + activeShares`，舊generationterminal後才能建立新remainder generation。
- `protectedShares`只由distinct `exit_claim_id + remainder_generation`的fresh、non-unknown active claim投影；同一claim從`monitoring_reserved → intent_reserved → broker_working`只計一次。released／consumed／unknown、stale representation及不屬於obligation的external claim不會被誤算成受保護量。
- ExternalSellClaim只在完整account-scoped reconciliation後以獨立lineage建立，參與可用position／overlap治理但不偽裝Runtime保護；集合完整性未經Gate 0證實時整個帳號自動保護disabled。
- 每個protection group＋remainder generation只建立一個Activation；candidate legs只是無broker authority的ProtectionLegEvaluation。winner、suppressed siblings、claim `intent_reserved`及exit intent同一CAS保存，loser在任何broker call前停止。
- partial exit只消耗舊claim；working order未terminal或結果unknown時siblings全部阻擋。完成final reconciliation並settle舊claim後，仍需新generation與明確re-arm才能再次競爭，不能重送舊winner或改送sibling。

### Commitment／Obligation quantity invariant

- entry送出前就存在PendingProtectionCommitment與ProtectionObligation，避免成交後才補建保護計畫；commitment證明計畫已保存，obligation持續承擔已送entry與實際fill的本機追蹤責任，兩者terminal語意不混用。
- 每個entry lineage固定：`requestedShares = cumulativeFilledShares + openPotentialShares + terminalUnfilledShares`，以及`cumulativeFilledShares = materializedFilledShares + unmaterializedConfirmedFillShares`。working／unknown的`openPotentialShares`不能填0，memory-only fill不能冒充durable materialized quantity。
- 每個obligation固定：`filledShares = confirmedExitedShares + protectedShares + RuntimeTrackedUnprotectedRemainder`。所有量是同account／contract的non-negative base Share；任一claim projection不可信時`protectedShares`及current unprotected remainder為unknown並進blocking，不以last-known數字宣稱一致。
- protection exit Activation只能在entry OrderIntent、BrokerOrder、PendingProtectionCommitment皆terminal，且`openPotentialShares=0`、`unmaterializedConfirmedFillShares=0`後建立；entry與exit不會同時取得broker write authority。

### Zero-fill、partial、unknown 與 break-glass

- true zero-fill要求`cumulativeFilledShares=0`、`openPotentialShares=0`、`terminalUnfilledShares=requestedShares`及unique final broker evidence；accepted、IOC timeout、零deal event或「目前沒看到成交」均不足以終結。
- partial-entry terminal要求positive cumulative fill、positive terminal unfilled且open potential為0；commitment可在全部confirmed fill materialize後terminal，但obligation必須繼續到confirmed exit／position zero或明確人工relinquish。
- entry／exit partial fill只依累計confirmed quantity原子更新reservation、claim、obligation與position projection；cancel-fill race未取得final quantities時保持reconciling／unknown，不建立第二個exit或把remainder猜成0。
- break-glass只轉交本機責任。它需要二次確認、snapshot、burned nonces、ResolutionCase及同transaction建立`RelinquishedUnknownExposure.open`，保留worst-case position delta與possibly-working bounds；UI只能顯示unmonitored，不能顯示cancelled、filled、zero-fill或protected。
- unknown intent／claim／obligation或relinquished blocker依scope持續阻擋相衝突write與一般stop／rollback／uninstall；只有kind-specific unique evidence或Gate核准的strict zero-bounds路徑可解除，generic resume／acknowledge無權解除。

### C0–C21 risk／protection recovery

- C0–C3確保entry plan／reservation／claim在任何broker authority前durable；prepared可在證明未授權adapter後reconcile＋user re-arm，dispatching fence commit後則永久失去proven-unsent資格。
- C8把memory partial fill與最後durable quantity revision分開，復原時由deal、position、order重算並原子更新filled／open potential／terminal unfilled、reservation、claim、protectedShares與obligation；C9只接受跨實體invariant一致的已commit projection。
- C10／C11保留唯一OCO winner與suppressed siblings；proven-unsent時也只能在reconcile＋user re-arm後送原winner一次，possibly-sent則winner與claim unknown且不得送任何sibling。
- C12／C13要求exit partial fill及cancel-fill race以final cumulative order／deal／position量重新settle claim與remainder；舊order terminal前不能建立新generation。
- C18／C19讓break-glass與forced-stop的release、ResolutionCase、unknown-exposure blocker及epoch transition同transaction全成或全敗；C20／C21讓terminal conflict與derived ledger correction保留原terminal、blocker未解前不鬆綁。
- C4–C7、C14–C17同樣維持dispatch unknown、DB／mode／generation fail-closed及新epoch full reconciliation，故不會繞過reservation／claim／obligation；未列點一律採最後durable commit後的較嚴格window。

## Finding closure、integration gap 與再審

| Finding ID | Severity | 處置 | 本次再審結果 |
|---|---|---|---|
| `RP-P0-01 entry-before-protection window` | P0 | entry intent、完整protection plan、commitment、obligation與policy-required reservation在broker write前同transaction保存 | `closed`；任何companion缺失即拒絕，commit前broker authority為零 |
| `RP-P0-02 OCO sibling double dispatch` | P0 | 每remainder generation單一Activation／winner，candidate child無authority，winner＋suppression＋claim＋intent原子CAS | `closed`；winner unknown／working時所有siblings維持blocked |
| `RP-P0-03 claim representation double count` | P0 | 同一ExitClaim lineage在monitoring／intent／working representation間轉態，按distinct claim ID＋generation只計一次 | `closed`；overlap、scope drift、stale或conflicting representation皆fail closed |
| `RP-P0-04 break-glass erases exposure` | P0 | release與`RelinquishedUnknownExposure` blocker、effect bounds、burned nonce及audit同transaction | `closed`；本機責任可轉交但相衝突write仍blocked |
| `RP-P1-01 protectedShares ambiguity` | P1 | protectedShares限定fresh、distinct、non-unknown Runtime claim投影，與filled／exited／unprotected建立等式 | `closed`；unknown projection不轉成數值0或consistent coverage |
| `RP-P1-02 zero-fill/partial ambiguity` | P1 | requested／filled／open potential／terminal unfilled及materialized等式，明確互斥true zero-fill與partial terminal | `closed`；accepted、零deal或timeout不能冒充zero-fill |
| `RP-P1-03 reservation release ambiguity` | P1 | reservation不得擴張，只consume confirmed fill並只release proven-unsent／unique terminal remainder；unknown為blocking | `closed`；不以尚未成交或memory event釋放worst-case risk |
| `RP-P1-04 non-unique crash recovery` | P1 | C0–C21固定最後durable事實、跨實體重算、OCO generation、break-glass與correction復原 | `closed`；沒有以猜測quantity或重送舊intent的未定分支 |
| `RP-IMPL-01 canonical risk/PnL authority` | Gate 0／1 blocker（非模型P0／P1） | task 0.7／0.14及6.1／6.3／6.9仍須取得Share unit、full-day deal／fee／tax、position與account／identity雙層受管證據 | `open_current_integration`；test-only risk issuer不能解鎖 |
| `RP-IMPL-02 reservation/claim/OCO repository` | Gate 1 blocker（非模型P0／P1） | task 6.4–6.8仍須完成production repository、account arbiter、ExternalSellClaim集合、queue-head重驗、OCO CAS及fault injection | `open_current_integration`；domain helper不是durable runtime ledger |
| `RP-IMPL-03 protective entry/exit lifecycle` | Gate 1／feature blocker（非模型P0／P1） | task 7.2–7.10及13.3仍須完成prepare-before-entry、cumulative fill、zero-fill、partial/OCO remainder、UI與simulation acceptance | `open_current_integration`；保護出場不得啟用broker write |
| `RP-IMPL-04 adversarial coverage` | Gate 1 blocker（非模型P0／P1） | task 12.4／12.10仍須補並發超限、外部sell、TOCTOU、三representation、winner crash、cancel-fill、unit與PnL fault injection | `open_current_integration`；現有離線測試只證明已實作子集合 |
| `RP-20260812-01 independent re-review` | 無新模型finding | 重新比對artifact、formal specs、typed state machine、risk projection與C0–C21 | `closed_no_finding`；書面模型範圍無open P0／P1 |

## 機械證據

| 指令／檢查 | 結果 |
|---|---|
| `shasum -a 256` 綁定artifact、formal spec與四個domain對照檔 | 所有值與本紀錄「審查輸入與內容雜湊」一致 |
| `pnpm exec vitest run src/lib/smart-order-state-machine.test.ts src/lib/smart-order-risk-domain.test.ts` | 2 files／55 tests通過 |
| `openspec validate add-durable-smart-order-panel-and-protective-exits --strict` | 通過 |
| `git diff --check` | 通過 |

上述測試與檢查皆為本機離線驗證；沒有連線8080、沒有讀取或保存帳號、沒有建立行情／trade subscription，也沒有發出place／update／cancel。

## Sign-off conclusion

對綁定的`smart-order-state-transitions/2026-08-11.4`／SHA-256 `e788bb3981e4784ee797277a73257b1fb8e68899b0b2bacc93c76016b4926d0d`，本risk／protection reviewer確認：EntryExposureReservation、ExitClaim／ExternalSellClaim generation與distinct projection、OCO winner／remainder、PendingProtectionCommitment／ProtectionObligation quantity invariant、true zero-fill／partial、unknown／break-glass及C0–C21 crash recovery在書面模型內自洽、可實作，且與正式spec沒有發現矛盾；本角色範圍沒有未關閉的模型P0／P1 finding，予以正式sign-off。

此sign-off只是task 0.11要求的五個角色之一。其他角色sign-off與task 0.7／0.14／6.1–6.10／7.2–7.10／12.4／12.10／13.3的受管證據未完成前，task 0.11不得因本紀錄單獨宣稱完成，artifact也不得成為gate manifest的`passed` conjunct；Gate 0／1、一般write master、simulation broker write、production與CA全部維持fail closed。
