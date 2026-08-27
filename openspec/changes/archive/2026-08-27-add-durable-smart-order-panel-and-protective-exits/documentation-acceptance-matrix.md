# 智慧下單文件驗收矩陣

版本：`smart-order-documentation/2026-08-12.1`

本文件把 tasks 14.2–14.5 的操作、安全與產品說明，對應到可交付文件的固定章節。它只證明「文件足以讓實作者與操作人員辨識邊界」，不證明 Gate 0、simulation write、production、CA、broker adapter 或任何策略 feature 已解鎖。

## 文件權威順序

1. OpenSpec `specs/**/spec.md` 的 MUST／Scenario 是規範性要求。
2. [smart-order-state-transition-tables.md](./smart-order-state-transition-tables.md) 是狀態、reason、atomic companion 與人工處理的 reviewed baseline。
3. [official-smart-order-decision-tables.md](./official-smart-order-decision-tables.md) 是七種類型的官方可確認核心、來源衝突、本地安全縮限與 disabled 分支。
4. [local-control-plane-threat-model.md](./local-control-plane-threat-model.md) 是本機控制面威脅、殘餘風險與 hostile-test 要求。
5. [scripts/smart-order-runtime/README.md](../../../scripts/smart-order-runtime/README.md) 是實作者／操作人員的整合說明；若與前四項衝突，必須先修正 README，不得以 README 放寬規格。

## 14.2 七種類型、來源衝突與產品限制

| 驗收主題 | 規範與來源 | 操作文件 | 必須看見的安全結論 |
| --- | --- | --- | --- |
| 七種類型 | decision tables 第 4–10 節 | Runtime README「產品邊界與七種類型」 | 每一類分開寫「官方可確認核心」與「RealTimeStock 本地安全縮限」；所有類型目前 `disabled`。 |
| 快速／多條件欄位 | decision tables 第 4、6 節 | 同上 | 九個行情欄位、最多七條、AND／OR 不可用猜測 mapping 解鎖。 |
| 長效／母子／定時定量有效期 | decision tables 第 5、7、10 節 | 同上 | 長效 1–30 日且每日最多一次；母全成才啟子、子只限當日；定時／定量未證實算法保持 disabled。 |
| 官方來源衝突 | [evidence.md](./evidence.md)「官方與一方資料」 | Runtime README「產品邊界與七種類型」 | 零股與「可否修改」有官方版本衝突；本專案不冒充完整 feature parity。 |
| 兩套 20 筆 | proposal／design「本機上限」 | Runtime README「產品邊界與七種類型」 | 本機股票 20 筆與大戶投同一 ID 跨帳號台股＋期權雲端 20 筆是不同資源，不讀取、不占用、不同步。 |
| non-draft immutable | durable runtime spec／state tables | Runtime README「產品邊界與七種類型」 | paused、recovery、manual、cancel-pending、expired-with-obligation 都不可原地改交易 payload；只可 allowlisted 操作或複製新草稿。 |
| 一年歷程 | history spec／retention policy | Runtime README「狀態、數量與保護義務」「SQLite、backup 與 retention」 | 只在 broker side effect 與義務全 terminal 後進歷程；依 Asia/Taipei calendar-year 保存。 |

## 14.3 狀態、保護、公式與人工處理

| 驗收主題 | 操作文件固定說明 | 不得誤解為 |
| --- | --- | --- |
| 四層交易狀態 | Runtime README「狀態、數量與保護義務」分開 `Strategy`、`Activation`、`OrderIntent`、`BrokerOrder` | 「條件成立」「HTTP 受理」或「accepted」就是成交。 |
| 進場前保護 | 同章分開 `PendingProtectionCommitment`、`EntryExposureReservation` | 尚未成交就已建立可用的 ExitClaim，或先送 entry 再補保護。 |
| 出場權利 | 同章分開 `ExitClaim` 與 `ExternalSellClaim`，distinct lineage 不重複計量 | 外部 App 委託可被本機原子鎖住，或三種 representation 可以相加重複扣量。 |
| OCO | 同章明定單一 winner、單一 active dispatch slot、sibling pre-byte suppression | cancel request 已送就代表 sibling 不會成交。 |
| 百分比／ATR／trailing | 同章明定 integer bps、固定 Wilder ATR snapshot、normal-lot last trade、方向性 tick rounding | 用浮點近似、重啟後換 ATR、BidAsk 單獨跨線，或歷史 ticks 在 gap 後自動解鎖。 |
| pause／resume／cancel | 同章明定 pause 只停新 activation；resume 重驗；取消策略與取消 broker order 分開 | pause 會取消 working order，或 resume 只是把資料列改回 monitoring。 |
| 未受保護量 | 同章定義 `RuntimeTrackedUnprotectedRemainder` 與 unknown propagation | stale／offline／unknown claim 可當成 0。 |
| 人工處理 | 同章明定 reason-specific matrix、唯一 final evidence、雙確認 break-glass、原 intent 不重送 | generic resume、通知或 UI 按鈕可以解除 unknown。 |
| 通知 | 同章明定通知僅提醒、不是 broker evidence | macOS 通知成功可推進 broker／strategy state。 |

## 14.4 Node、SQLite、backup、migration 與生命週期

Runtime README「啟動與 Node 契約」「SQLite、backup 與 retention」「Status 與 uninstall」必須共同涵蓋：

- Node.js LTS `>=24.15.0 <25` 的 persisted absolute realpath；LaunchAgent 不從 `PATH` 猜執行檔。
- RealTimeStock一般前端／桌面主程式平台支援維持原狀；本change智慧下單交易Runtime只支援原生、非VM的Apple Silicon `arm64` macOS。Intel／`x64`、Rosetta、VM、Windows與Linux在installer、sidecar entry與Gate verifier都須fail closed，未來Intel另立change。
- current-user owner、private directory `0700`、資料／secret `0600`，拒絕 symlink、錯誤 owner 或群組可讀。
- `node:sqlite` dedicated worker、single writer、WAL、`synchronous=FULL`、foreign key、defensive mode、busy timeout與 OS lease。
- 一致性 backup；restore 必須檢查 schema、hash、row count、`integrity_check` 與 `foreign_key_check`。
- installation expectation marker：已初始化後 DB 遺失不得靜默建立空庫。
- migration 必須 transactionally forward-only；partial／unknown schema、corruption、read-only、permission、disk-full或 downgrade 一律 fail closed。
- retention 不刪 non-terminal／working／unknown／obligation／reservation／claim；一般 uninstall 保留 DB、WAL、backup、identity key與 audit。
- stop／rollback／uninstall 的 drain 必須涵蓋所有本機 side effect 與義務；一般持股本身不算本機義務。

Task 0.9只接受current schema／source fingerprint下單一原生Apple Silicon arm64實機的正式簽章報告，並由單host trust manifest綁定`runId + resultHash`；舊雙架構／Intel report、fixture、偽造或重放證據不得取代Gate 0.9。Intel交易Runtime不屬於本change待辦，未來另案。

## 14.5 Gateway、provenance、Gate、probe、mode 與 kill switch

Runtime README「Same-origin gateway 與 write provenance」和 threat model 必須共同固定下列契約：

1. Browser 只走 5173 same-origin route；packaged desktop 沒有等價 gateway 時 fail closed。
2. Gateway 驗 exact loopback socket、Host、Origin／same-origin Referer、Fetch Metadata、route／method／schema、body／query bounds、CSRF、capability、replay與 sidecar response proof；Cloudflare、tunnel、forwarded headers、DNS rebinding與 direct 8080 都拒絕。
3. `manual_user_confirmed`、`automation`、`gate_probe` 只能由 server route與可信 lineage衍生；browser payload、環境變數、UI toggle與 `custom_field` 都不是 provenance authority。
4. Capability 與 identity HMAC key 分離，使用 repo 外 `0600` 私有路徑；遺失、rotation中斷、owner／mode錯誤或 mapping conflict 立即 fail closed。
5. Machine-readable manifest 綁 build、schema／adapter、Shioaji、Node／SQLite／OS、route coverage、PnL／risk、產品邊界與 evidence digest；verifier 重算，不信任 report 自稱布林值。
6. Probe 只走獨立 CLI、逐 operation 一次性 nonce、同 run target、最大 1 CommonLot simulation envelope；禁止策略呼叫、跨 run target、盲目 cleanup與開啟一般 write master。
7. 每次 broker mutation 的順序固定為 shared mode lease、private marker＋`/api/v1/info.simulation=true`、API generation／sender fence、durable `dispatching`，最後才可送第一個 byte；lease 保持到 durable result／unknown。
8. Identity／account／emergency kill switch 是 deny-union，並與 dispatch 共用 arbiter revision；已越過 write 線性化點的 side effect 只能 confirmed／unknown＋reconcile，不能宣稱已撤回。
9. Break-glass 只處理特定 unresolved obligation／unknown exposure，留下 blocker 與 audit；它不是 write gate override。

## 完成層級與操作檢查

任何狀態頁、文件或 release note 都必須分開三個層級：

- `artifact apply-ready`：可以繼續實作與執行 Gate 0，不能送出任何broker bytes。
- `write-unlock-ready`：Gate 0/1、current manifest、simulation attestation、固定帳號、risk／PnL／resources／reconciliation、current confirmation／arm／readiness與使用者 write master同時成立；只適用manifest明列且已核准的simulation route。
- `feature release-ready`：單一類型的Gate 2或Gate 3，以及正常、失敗、重啟、斷線、時間、partial／unknown與UI驗收全部通過，且使用者再次確認本機產品邊界；不得以其他類型的結果代替。

三個層級都不授權production、CA或真實委託。未經使用者明確授權，也不得據此archive OpenSpec change、commit或push。

操作人員在任何 simulation write 前，至少必須能回答：目前是哪一個 Runtime generation、哪一個固定帳號、哪一個 provenance、哪一個 current manifest、哪一個 current arm、哪一個 canonical payload hash，以及失去回應時要進哪個 unknown／reconcile path。任一答案不明即不得送出 broker bytes。

## 文件驗證

文件變更後至少執行：

```sh
npx openspec validate add-durable-smart-order-panel-and-protective-exits --strict
git diff --check
```

驗收時另以 SHA-256 固定 Runtime README、decision tables、threat model與本矩陣；任何後續內容漂移都要重新審查 tasks 14.2–14.5，不能沿用舊 hash。
