## 1. 證據邊界與前置 Gate

- [x] 1.1 實作 prerequisite verifier，核對 `add-configurable-intraday-relative-volume-monitor` 的可信前日 baseline＋一個三件式完整盤中日功能 bundle（保留舊兩日相容）、canonical hash、已授權 reviewer GO 與核准 active limit 20；缺任一項時只允許離線 plane
- [x] 1.2 定義互不相容的 `synthetic_load_only` 與 live provider evidence schema、canonical hash 及 reason codes，正式 validator 必須拒絕跨 plane 冒用
- [x] 1.3 建立 stage state machine，主路徑改為 20 → 160，50／100 為非必要診斷；測試缺 20 GO、錯誤前級、重複執行與 evidence hash 漂移皆 fail closed
- [x] 1.4 將 provider physical usage、global ownership、release 與 headroom 固定為 nullable unknown 欄位，測試任何 request／SSE／receipt 推算值都被拒絕

## 2. 收盤後直接 160 檔離線壓測

- [x] 2.1 實作離線 fixture builder，只接受通過 schema／hash 的封存 capture，保存 source hash、target count、expansion mapping 與保留命名空間 synthetic symbol
- [x] 2.2 實作 50、100、160 檔 deterministic replay runner，至少重跑兩次並保存 input／output hash、trigger count 與逐階段耗時
- [x] 2.3 實作離線 CPU、RSS、DB growth、磁碟與 event-to-seal latency 量測，禁止網路、provider subscription、通知、broker write、production 與 service lifecycle authority
- [x] 2.4 建立 160 檔監控列表、搜尋、排序、選取與 K 線連動的離線 UI 負載 fixture，保存 frame／interaction latency 與 memory evidence
- [x] 2.5 實作離線 evidence validator，驗證零網路與零禁止 operation，並明確輸出「不可作為正式行情或 provider 容量證據」
- [x] 2.6 使用封存的兩日資料完成 160 檔完整離線路徑壓測（解析、分鐘處理、跨日重播、DB／WAL、UI、雜湊及落檔），保存成功／失敗 evidence；2026-09-14 完成兩日 86,400 rows、DB／WAL、100 次 UI 互動、雙次 43,200 steps replay、hash 讀回與超限拒絕，成功 v4 與先前三版量測／修正紀錄均保留

## 3. 分級 cohort、plan 與盤前 preflight

- [x] 3.1 從最多 200 檔 configured 清單產生 50、100、160 檔候選 receipts，排除 ETF、重複、非台股整股 STK 與已知不支援的 KBar contract
- [x] 3.2 建立 exact-count immutable cohort manifests，保存順序、contract identity、eligibility reason、source version 與 SHA-256，且同一 stage 不輪替或補位
- [x] 3.3 建立各 stage plan，盤前鎖定 CPU、RSS、DB growth、磁碟、event latency、chart freshness、reconnect 與既有功能 budgets
- [x] 3.4 實作 simulation-only preflight，核對 loopback、production false、feature-off、通知關閉、broker authority false、唯一 stage process、合法交易日與 08:50–09:00:30 啟動窗
- [x] 3.5 實作一次性 execution authority；只有前級有效 bundle 與人工 GO 才可產生，validator 本身不得啟動 stage

## 4. 有界盤中 transport 與完整日 recorder

- [x] 4.1 將 bounded KBar transport 泛化為 exact 160 檔 stage（50／100 僅為可選診斷），仍維持單一 batch subscribe、單一專用 SSE、逐事件白名單與相同 cohort 單次 unsubscribe
- [x] 4.2 強制每個 stage 使用新的 simulation process／session 與 connection generation；同一 session 的 target count 變更、第二 stage 或推定容量重用全部拒絕
- [x] 4.3 擴充 recorder 保存 exact cohort 的 09:01–13:30 共 270 個 minute slots、來源版本、接收／seal 時間、累積量、完整性與 reason
- [x] 4.4 區分來源可證明的零成交分鐘與 unknown；沒有權威資料時不得補零、插值、沿用其他商品或把 partial 標為完整
- [x] 4.5 保存 subscribe／unsubscribe receipts、provider unknown、資源、重連、chart freshness 與 notification／broker／production／service lifecycle operation ledger
- [x] 4.6 測試 interrupted、cohort 漂移、缺 KBar、異序、跨日、重連、重複事件、late frame 與 unsubscribe unknown 均保留 evidence 並 fail closed

## 5. Stage bundle、驗證與人工決策

- [x] 5.1 實作 per-stage canonical bundle builder，驗證 plan／manifest／session hash、exact count、完整分鐘、資源、回歸與零禁止 operation
- [x] 5.2 實作 deterministic replay validator，抽樣重算累積成交量、同分鐘 ratio、trigger id／hash、unknown reason 與重複通知
- [x] 5.3 Stage 160 以可信前日 1 分 K baseline＋一個完整盤中日驗收，exact cohort／規則一致；第二日穩定性追蹤非阻擋，50／100 非必要測試
- [x] 5.4 validator 只輸出 `readyForHumanReview`；實作 review template，要求 reviewer 對資料、資源、既有功能、provider unknown 與 rollback 明確簽署 GO／NO-GO
- [x] 5.5 實作 rollback decision，失敗或未簽核時維持最近人工核准的 active limit，禁止自動晉級、自動重試與自動改寫產品設定

## 6. 容量狀態 UI 與可觀測性

- [x] 6.1 在盤中監控 UI 分開顯示 configured、目前人工核准 active limit、當次 stage target、data-active、waiting、unknown 與 degraded
- [x] 6.2 顯示 provider physical usage、global ownership、release 與 headroom 為 unknown，不以 HTTP accepted、request、SSE connection 或 receipt 數替代
- [x] 6.3 顯示 offline-only、preflight blocked、running、pending evidence、ready for review、GO、NO-GO 與 rollback 狀態，且不提供自動晉級控制
- [x] 6.4 在 160 檔列表與設定區完成 compact layout、鍵盤操作、focus、aria label、模糊股名搜尋與 K 線連動回歸測試
- [x] 6.5 建立不重載、不新增完整交易頁面的 chart freshness 觀測方式；任何額外 HTTP method 或 subscription mutation 都必須保存並拒絕零干擾宣告

## 7. 直接 160 檔盤中執行

- [x] 7.1 為 exact 160 cohort 建立緊接前一交易日的可信 1 分 K baseline，逐檔保存來源、完整分鐘、累積量與 hash；僅作比較基準，不計入 live 驗收日
- [x] 7.2 在 20 GO、160 完整離線 Gate、可信 baseline、fresh session 與 preflight 通過後，使用合規 simulation session 完成相同 160 檔的一個完整盤中驗收日，執行同分鐘量比 deterministic replay、資源及三件式既有功能驗證；2026-09-16 exact 160 於 08:50–13:34:30 完成，09:01 canary 160／160、盤中功能與資源 Gate 通過，3026.TW 的兩個收盤尾端 live 缺口依受限政策完成盤後雙抓與前綴核對
- [x] 7.3 審閱 160 前日基準＋單日盤中 evidence，GO 時才核准 160 候選，NO-GO 或未核准時維持 20；2026-09-15 NO-GO 歷史保留，2026-09-16 由 Codex 依使用者委託完成 derived GO 審閱並原子核准 160，50／100 未啟動

## 8. 最終驗收與歸檔候選

- [x] 8.1 建立 acceptance dossier，彙整 prerequisite、離線 160 壓測、160 前日基準＋單日 live evidence、資料品質、資源、UI、accessibility、rollback、tests 與 reviewer sign-off；2026-09-15 原始 NO-GO 與 2026-09-16 受限尾端例外 GO dossier 均已保存
- [x] 8.2 執行相關單元、整合、browser、長時間 soak、`git diff --check` 與 `openspec validate evaluate-tiered-intraday-monitor-expansion-to-160 --strict`；最終非 browser 237 files／2,450 tests、browser 14 files／130 tests 通過，完整交易日提供長時間 soak 證據
- [x] 8.3 確認所有 evidence hash、人工決策、正式 active limit 與 unresolved risks 完整後才標記歸檔候選；原始／衍生 capture、bundle、review 與 product state hashes 已重算相符，狀態為 `complete_go`／`approvedActiveLimit=160`，provider physical usage／global ownership／release／headroom 仍如實保留 unknown；依本輪使用者明確要求進行 archive 與精準 commit，不自動 push

## 9. 2026-09-11 直接 160 與空間容量調整

- [x] 9.1 相容已完成的 20 檔單日功能 bundle；直接 160 前置改為 20 GO，失敗保留 20，v2 token 拒絕舊版
- [x] 9.2 建立專用 32／64／128 MiB 儲存 profile、8 GiB free-space 拒絕、原子 exclusive writer 與超限／不覆寫測試
- [x] 9.3 量測兩日各 43,200 分鐘的 synthetic session、bundle、讀回雜湊、重播及 peak RSS，產出容量報告與新 1 GiB RSS plan
- [x] 9.4 將專用 profile 接入 160 live transport／recorder／launcher／bundle；verify 43,200 筆、兩日來源、超限 fail-closed、failure sidecar 與單次 unsubscribe

本輪沒有啟動任何 160 live 訂閱。舊 50／100 artifacts 僅作歷史，不是新主路徑的必要 Gate。

2026-09-11 本輪驗證：完整非 browser tests 219 files／2,374 tests、build、此 change strict validation 與 git diff --check 均通過。容量量測與限制見 acceptance/direct-160-capacity-assessment-2026-09-11.md。


## 10. 2026-09-11 單日驗收與下次交易日比較基準

- [x] 10.1 將 plan／token 升為 v3、bundle 升為 v2；160 改為可信前日 1 分 K baseline＋一個完整盤中日，session 綁定 baseline hash；缺基準、錯誤日期／cohort、來源漂移均拒絕，第二日穩定性追蹤非阻擋。
- [x] 10.2 建立 exact 160 歷史資料唯讀採集與本機原子 baseline writer，逐檔檢查雙抓穩定性、270 分鐘、1 分 K 累積量及一般時段核對，不變更已完成 20 檔資料。
- [x] 10.3 全部 160 檔基準通過，發布下一適用交易日可用的 baseline set；任何缺口不得補造或自動換股；使用者明確授權的盤前替換須建立新版本。

本輪 10.3／7.1 未完成原因：160 檔已查完，159 檔／42,930 分鐘基準已驗證並原子保存；2926.TWO 的當日正式 1 分 K 持續空白，但 TPEx 當日非零成交，不能補零或換股。詳見 acceptance/direct-160-single-day-and-baseline-2026-09-11.md。最終測試 221 files／2,378 tests 通過，build、strict、diff check 與既有 20 檔 dossier 核對通過。

2026-09-11 後續更新：使用者明確授權換一檔，2926.TWO → 6187.TWO，替補股先通過 270 分鐘驗證，再重建 exact 160 cohort／plan／baseline。7.1 與 10.3 已完成；此前 159 檔缺口紀錄保留歷史。live transport、DB／UI 負載與單日 live 驗收仍未完成。

## 11. 2026-09-14 驗收日同時完成產品功能

- [x] 11.1 將產品設定前 160 檔校正為 immutable cohort 的完全相同順序，6187.TWO 取代 2926.TWO；保存 config revision 且不改寫舊 manifest／baseline。
- [x] 11.2 將 exact 160 recorder 接入正式 evidence DB、baseline、量比 evaluator、trigger 與公開狀態檔；產品 persistence 失敗時 fail closed。
- [x] 11.3 將 Vite local API 改為讀取產品 runtime 狀態，允許有界 stage 顯示 160 data-active，並從 DB 逐筆投影可精確續傳的 SSE trigger。
- [x] 11.4 實作受 bundle／capture／review hash 約束的 Codex GO activation；通過才原子啟用 160，失敗維持 20。
- [x] 11.5 正式 capture 量測產品 DB＋WAL working growth，要求同日被動圖表證據，並以唯讀 local SSE probe 驗證重連與零重複通知。
- [x] 11.6 更新 13:35 基準準備與下一交易日 08:45 排程，使其執行產品模式、建立同日畫面證據、bundle、Codex review、activation 與最終 UI/API 驗證。
- [x] 11.7 重啟 Web 載入 state-backed gateway，執行產品 sink、activation、local API/SSE、browser、build、strict OpenSpec 與 diff check；保存下一交易日 runbook 與失敗回復路徑。

2026-09-15 live 結果：7.2 未完成，因資料只有 09:10–13:30 共 41,752 observations、四檔止於 13:28，且同日被動圖表 evidence 缺失；7.3 判定 NO-GO、active limit 維持 20。8.1 的失敗 dossier 見 `acceptance/direct-160-live-no-go-2026-09-15.md`。8.2 尚待收盤後修正 change 完成後執行完整回歸；8.3 不是歸檔候選。11.7 的既有實作驗證歷史保留，但本日證明排程、data-plane readiness、bootstrap、service log、圖表 freshness 與 failure sidecar path 仍需修正。

2026-09-16 最終結果：原始 capture 先因 3026.TW 缺 13:29／13:30 保存 strict NO-GO；依使用者核准的受限收盤尾端政策，盤後同來源 KBar 雙抓完整 270 分鐘且 hash 一致，並與 09:01–13:28 live 累積量逐分相符，derived GO dossier 因此核准 160。原始 NO-GO 與 derived GO 均保留。最終非 browser 237 files／2,450 tests、browser 14 files／130 tests、build、change strict validation 與 whitespace check 通過。

## 12. 160 檔延後收盤確認

- [x] 12.1 明確將個股可能延後至 13:33 收盤納入 160 檔正式規格；整批訂閱維持至 13:34:30，延後成交併入 canonical `13:30`，未知編碼或缺口 fail closed。
- [x] 12.2 增加 exact 160 端到端 regression：同一 cohort 同時包含一般 13:30 與延後 13:33 收盤個股，仍須產生每檔 270 slots、43,200 replay steps 與正確逐檔 `closeMode`。
- [x] 12.3 驗證 full-session launcher 的固定結束時間為 13:34:30，避免排程在 13:30 或 13:31 提前封存／取消訂閱。
