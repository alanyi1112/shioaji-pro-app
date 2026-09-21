## 1. Gate 0：資料來源與 subscription 資源證實

2026-09-07 改採不需修改 Shioaji HTTP server 的 bounded realtime KBar 路線。2 檔單 batch 實測已逐檔收到合法分鐘棒；provider physical counting／release 仍明示 unknown，但不再是本 change 的交付前提。最多 200 檔 configured、固定 20 檔 active pilot，50 檔以上另案。詳見 `gate-0/kbar-batch-alternative-decision-2026-09-07.md`。

- [x] 1.1 以唯讀盤點列出 5173、5174、chart、watchlist、alert、smart order、MultiView 與同一 login 外部 client 的 subscription owner、connection generation、contract、quote type、physical key、refcount 及目前狀態，保存不含機密的 evidence
- [x] 1.2 在 simulation 以單一 multi-stock KBar request 驗證 2 檔逐檔事件、payload、分鐘時序與 unsubscribe accepted 語意；將無法由現有 binary 證實的 physical counting／release 保持 unknown，並決議固定 20 檔、不輪替、不重用推定容量
- [x] 1.3 查證台股整股 Tick `total_volume`、1 分 K 或其他可用 bootstrap 的實際欄位、張／股單位、交易日期、exchange time、simtrade／intraday odd lot 標記及 source version，建立可重現 mapping fixture
- [x] 1.4 量測上一交易日與今日 completed-minute bootstrap 的批次能力、request bucket、deadline、cache、速率限制、200 檔成本與資料完整度；禁止以週期 Snapshot／ticks／Kbars 輪詢代替 subscription
- [x] 1.5 盤點現有 MultiView gateway 與 Shioaji HTTP server 的 active-universe、SSE、process ownership 及容量限制，決定共用 transport authority 應落點並記錄替代方案
- [x] 1.6 保留原 physical inventory NO-GO 鑑識，另產出 bounded KBar 修正決策；provider counting／usage／release 保持 unknown，pilot 只憑逐商品 KBar receipt 判定最多 20 檔 data-active

## 2. 版本化 domain 與持久化模型

- [x] 2.1 定義 monitor config、candidate item、effective threshold、admission state、lease、minute observation、baseline、trigger event、capacity status 與 reason code 的版本化 TypeScript／runtime schema
- [x] 2.2 實作 canonical 台股整股 STK 解析、去重、最多 200 檔驗證、1.00–100.00 decimal 門檻及全域／逐商品覆寫，加入不部分寫入的單元測試
- [x] 2.3 建立本機 monitor config repository 與 migration，保存 revision、穩定排序、啟用狀態及來源，且不含帳號、憑證或交易資料
- [x] 2.4 建立 minute／baseline／trigger evidence repository、唯一鍵、monotonic revision、引用完整性及 bounded retention；清理不得刪除仍被當日結果引用的 evidence
- [x] 2.5 加入 repository migration、rollback、重啟恢復、revision conflict、corrupt row fail-closed 與 retention 測試

## 3. 防禦性 subscription ownership 元件（bounded KBar pilot 不接用）

- [x] 3.1 依 Gate 0 結論實作只讀 ownership inventory adapter，投影所有已證實 owner 的 generation、physical key、refcount、confirmation 與 freshness
- [x] 3.2 實作不可偽造的 consumer demand handle，以及相同 generation／contract／quote type 的 physical subscription 去重與 reference count
- [x] 3.3 實作共享 physical usage 小於或等於 160、至少 40 headroom、`max(0, 160 - confirmed usage)` 的 admission 計算與安全 blocker
- [x] 3.4 實作 chart／alert／安全關聯 smart-order 高於 intraday monitor 的優先序，以及依使用者排序與 canonical symbol 的 deterministic waiting；不得輪替監控
- [x] 3.5 實作 unsubscribe confirmation、unknown subscription 保留、disconnect generation rollover、stale plan 拒絕及容量只在確認後回收
- [x] 3.6 以 contract tests 證明既有 smart-order coordinator 的 broker authority、fail-closed、160 上限與 safety demand 不會因共用 adapter 被放寬
- [x] 3.7 加入跨 owner 去重、容量耗盡、高優先需求搶占、外部 usage 不可見、evidence 過期、subscribe／unsubscribe unknown 及禁止 polling fallback 的測試
- [x] 3.8 實作 bounded realtime KBar transport：最多 20 檔 immutable cohort、單一 subscribe／SSE／unsubscribe、逐事件白名單、provider usage／release unknown，且不具 production、broker write 或 service lifecycle authority

## 4. Lease、分鐘記錄、基準與量比判定

- [x] 4.1 實作 opaque page lease 的 acquire／renew／release、短 TTL、多分頁 refcount 與異常關頁自動到期；correctness 不依賴 `beforeunload`
- [x] 4.2 實作只有至少一個有效 lease 才提出 intraday-only demand，最後 lease 消失後完成原子 minute flush、停止新增事件並確認釋放 demand
- [x] 4.3 實作 realtime KBar observation adapter 與 one-bar delay seal，拒絕 cohort 外商品、舊 generation、重複／倒退 minute、跨日、future time、非安全整數／負量、gap 與未知單位
- [x] 4.4 實作交易日曆、regular-session minute key 與 completed-minute watermark，正確區分合法 carry-forward、已知 0 與資料缺口
- [x] 4.5 依 Gate 0 驗證來源實作一次性、有界的上一交易日 baseline bootstrap，保存日期、涵蓋範圍、單位、完整度、來源版本與 hash
- [x] 4.6 實作晚開頁的今日 completed-minute bootstrap；來源完整時產生 historical replay，無法回補時保存監控有效起點且不得推論開頁前是否達標
- [x] 4.7 實作精確 `today_cumulative >= threshold × previous_cumulative` 判定、零分母與 unknown 語意，確保 matched、notMatched、unknown 對 admitted 母體守恆
- [x] 4.8 實作 immutable trigger latch、交易日 namespace、設定 revision 語意、stable event id／hash、ratio 回落保留及 live／historical 類型
- [x] 4.9 實作斷線暫停、gap 修復、generation 恢復與 degraded 狀態；無法證實連續性時不得新增 trigger
- [x] 4.10 加入分鐘聚合、carry-forward、基準日曆、零分母、精確 decimal、門檻修改、重播一致性、跨日與中斷恢復的 deterministic 測試
- [x] 4.11 實作 bounded KBar shadow session evidence：只有 09:01–13:30 共 270 個 sealed minute、逐商品連續 sequence 與可信 close seal 全部成立才可成為 baseline；晚開頁固定為 partial
- [x] 4.12 修正台股個股延後收盤：沒有逐檔旗標時固定 cohort 持續訂閱至 13:33 後 90 秒、13:34:30 才核發 close authority；合法 13:33 撮合量只併入 canonical 13:30 累積端點，逐檔保存 `closeMode`，未知編碼 fail closed
- [x] 4.13 建立獨立 post-close repair domain／validator：保存 live interruption evidence，逐檔驗證 calendar、identity、時區、來源版本、單位、OHLCV／Amount 結構、分鐘連續性、live overlap、final volume、13:30／13:33 與重抓 hash；通過後只產生 `historical_repaired_verified`
- [x] 4.14 建立 immutable interruption／repair manifest repository，實作 monotonic revision、冪等寫入、同 generation／sequence window interruption conflict、同來源 payload conflict detection 與逐商品查詢，不接入今日 live capture
- [x] 4.15 以 fixture／暫存 SQLite 完成回補成功、overlap 衝突、缺分鐘、合法 known-zero carry-forward、延後收盤、量倒退、hash 不穩定、authority 不明、零 retroactive 通知、acceptance 分離及正常 live baseline 不退化測試
- [x] 4.16 2026-09-09 capture 於 evidence hashing 失敗後，先保存 failure size／mtime／SHA-256、確認主檔未建立並解除錯誤 keepalive；再將 repair worker 接入不可偽造的 post-close authority，且只接受已先 immutable 持久化的 interruption evidence，採逐檔有界 fetch／refetch、部分成功隔離、repository 寫入及零通知／交易／服務生命週期權限，且不對 2026-09-09 升格
- [x] 4.16a 修正完整 20 × 270 session evidence 超過通用 1 MiB 上限：使用專用 4 MiB canonical hash budget、16 MiB 原子 exclusive output、immutable failure sidecar 與明確 `KeepAlive=false` one-shot launcher，並以離線完整 cohort 測試證明 recorder 與 validator 雜湊一致、兩日 bundle 可組裝且不覆寫既有結果
- [x] 4.17 完成既有中斷回補整合後執行完整離線測試、build、strict OpenSpec validation 與 diff check，保存逐商品 repair／拒絕 evidence；回補不得冒充中斷當日的 live acceptance（結果見 `acceptance/post-close-historical-repair-offline-verification-2026-09-09.md`）
- [x] 4.18 實作正常前一交易日 `historical_baseline_verified` 流程：只在沒有 `live_full_session_verified` baseline 時，以交易日 authority 鎖定緊接前一交易日，逐商品執行有界雙重 fetch、來源／單位／270 分鐘／收盤總量／13:33 canonicalization／payload hash 驗證，保存 immutable baseline manifest、monotonic revision 與 conflict detection，並接入 baseline resolver 的次順位來源
- [x] 4.19 以 fixture／暫存 SQLite 驗證正常歷史 baseline 成功、雙抓 hash 不一致、缺分鐘無零量證據、合法 known-zero、13:33 合併、前置連續性不足、量倒退、非緊接前日、authority／單位不明、既有 live baseline 優先及零 retroactive trigger／通知；不得連接 production 或改變 broker state
  - 2026-09-10 已完成正常歷史 baseline validator、獨立 worker／repository、來源優先序與 fixture／暫存 SQLite 驗證；結果見 `acceptance/normal-historical-baseline-and-functional-bundle-offline-verification-2026-09-10.md`。

## 5. 本機 API、event stream 與診斷

- [x] 5.1 定義並實作 monitor config 讀寫 API，使用固定 schema、revision／idempotency、bounded payload 及逐項錯誤，拒絕未知與交易相關欄位
- [x] 5.2 定義並實作 lease acquire／renew／release API，驗證 client identity、generation、TTL 與過期行為
- [x] 5.3 定義並實作 status／capacity／results／diagnostics 唯讀 API，回傳 configured、eligible、active、各 waiting／degraded 數、ownership、usage、headroom、baseline 與 completed minute evidence
- [x] 5.4 實作支援 cursor／reconnect 的 SSE trigger stream，確保既有 event 重播不會建立第二筆通知 authority
- [x] 5.5 將所有盤中監控路由限制於固定 loopback／same-origin allowlist，hosted target 保持 feature-off，並證明 GET 不觸發 provider、subscription、DDL、runtime lifecycle 或 broker write
- [x] 5.6 加入 API schema、revision conflict、分頁／cursor、stale generation、host rejection、offline、payload limit、read-only side-effect 及秘密值遮蔽測試

## 6. 盤中選股專用 workspace 與監控面板

- [x] 6.1 新增盤中選股 route、專用 workspace identity 及同步 `window.open` helper，從「版面」選單開新分頁且不修改來源 workspace
- [x] 6.2 建立桌面左側監控／結果、右側 K 線的 viewport-safe 配置，以及窄寬、600 CSS px 高與特大字級的可操作 fallback
- [x] 6.3 建立「盤中監控」面板的單筆搜尋、批次貼上、自選清單匯入與盤後選股結果匯入 draft，顯示合法、重複、非法與超量項目並要求明確提交
- [x] 6.4 建立名單啟用／停用、刪除、排序、全域門檻、逐商品覆寫及 revision conflict UI
- [x] 6.5 顯示 configured、eligible、active、waiting gate／pilot limit／baseline、degraded，並將 other physical usage／headroom 明示 unknown；不把 health／heartbeat 冒充即時 ready
- [x] 6.6 串接 page lease 與 SSE lifecycle，處理 renew 失敗、重連、分頁重整、多分頁設定 invalidation 及當日結果恢復
- [x] 6.7 建立結果清單、穩定排序與 evidence 詳情，顯示 live／historical、兩個交易日、同分鐘累積量、門檻、觸發／目前 ratio、來源與完整度
- [x] 6.8 加入「尚未開始、等待 bounded Gate、等待 pilot limit、等待基準、監控中、部分 degraded、服務離線、無達標、已有結果」的可辨識狀態與安全操作限制
- [x] 6.9 監控卡片顯示經驗證的「股票代號＋股名」並可從暫時失敗有界恢復；單筆搜尋重用 MultiView 本機商品索引支援代號與繁中股名模糊搜尋、候選市場、鍵盤選取、錯誤辨識，加入草稿前仍由 Shioaji 合約 API 驗證
- [x] 6.10 新增 MultiView「我的清單」唯讀頁籤匯入：只列出台股、顯示各頁籤檔數、排除非台股、加入草稿前再經 Shioaji 驗證，且不觸發 realtime watchlist 同步、不修改 MultiView 或直接儲存監控設定

## 7. K 線連動、自選清單與通知

- [x] 7.1 重用既有 chart target 協調建立盤中選股頁內的未鎖定 K 線選取，將 contract、Snapshot 與 target 綁定同一 selection generation
- [x] 7.2 實作快速連點、target 移除／鎖定、所有圖表已鎖定與直接開 URL 的 race tests，證明結果點選只影響同頁指定圖表
- [x] 7.3 實作結果右上「加入盤中選股清單」按鈕與互斥事件處理，使結果內容只選 K 線、按鈕只送 watchlist mutation
- [x] 7.4 擴充 server-backed watchlist helper，精確尋找或建立「盤中選股」、冪等加入合法合約、處理 `already_present` 與未知結果對帳，且不切換 active list
- [x] 7.5 串接既有 watchlist invalidation，證明其他 RealTimeStock 分頁只重新讀取 metadata，不改選取商品；MultiView D1 清單與既有「選股」清單保持不變
- [x] 7.6 實作預設關閉的頁內聲音／系統通知控制，只有使用者明確啟用、Notification granted、lease 有效且新 live event 時才通知
- [x] 7.7 實作 server event id 與 client acknowledgement 去重，證明多分頁、重整、SSE 重播、historical trigger、門檻修改與 reconnect 都不補發通知
- [x] 7.8 完成鍵盤、focus、hover、touch、live region、色彩非唯一語意及高頻更新合併的 browser／accessibility 測試

## 8. 試辦、回歸與完成證據

- [x] 8.1 建立不含假正式行情的 deterministic fixture 與 replay runner，逐筆對帳 minute、baseline、ratio、trigger id／hash、unknown reason 及交易日切換
- [x] 8.1a 建立 bounded KBar 完整日 capture CLI：只接受正好 20 檔 receipt manifest、08:50–09:00:30 啟動、涵蓋個股 13:33 延後收盤且最早 13:34:30 close seal、新檔寫入與 simulation transport；今日晚開不得冒充完整日
- [x] 8.1b 建立每日三件式 evidence contract、被動 K 線 evidence builder 與完整性守門器：10:00 後缺件即告警、收盤後缺任一 capture／chart／assurance 即拒絕 daily bundle，並修正 08:45 自動任務不得再遺漏 companion evidence
- [x] 8.1c 將 bundle builder／validator 與 08:45 驗收編排改為支援「`live_full_session_verified` 或 `historical_baseline_verified` 前日 baseline＋一個三件式完整盤中日」；驗證交易日緊接、cohort／設定／門檻一致、20 檔 baseline 完整、hash 引用與跨日量比可重算，並保留舊兩日 live 輸入作相容或穩定性追蹤，不得把第二日維持為功能硬門檻
  - 2026-09-10 已新增單日功能 bundle schema、雙 baseline 輸入、CLI／verifier round trip、舊版相容測試，並更新 08:45 heartbeat 與隔日組裝清單；結果見 `acceptance/normal-historical-baseline-and-functional-bundle-offline-verification-2026-09-10.md`。
- [x] 8.2 在 feature-off／通知關閉下，以固定 20 檔完成「緊接前一交易日可信 baseline＋一個三件式完整盤中驗收日」的 shadow recording、跨日量比重播與 simulation dry run，保存正確性、headroom、CPU、記憶體、DB、SSE latency、重連及既有 K 線新鮮度證據；第二個完整盤中日列為非阻擋穩定性追蹤
  - 2026-09-07 已完成盤中 3 分鐘 partial rehearsal：修正非四位數及 `00` 開頭商品的 fail-closed eligibility 後，固定 cohort 20／20 檔均取得兩根連續 sealed minute；結果與限制見 `acceptance/partial-rehearsal-2026-09-07.md`，本次不計入完整交易日。
  - 2026-09-08 第一個 full-session capture 於 13:31 正常停止並 accepted 相同 cohort unsubscribe，但 20 檔各只 seal 09:01–09:23 共 23 分鐘，固定保存為失敗 evidence，不計入完整交易日。原因與修正見 `acceptance/kbar-shadow-failure-2026-09-08.md`。
  - 2026-09-09 full-session capture 盤中維持單一行程，但收盤後在完整 evidence canonical hashing 階段超過原通用 1 MiB 上限，主檔未建立；錯誤 launchd keepalive 累積重叫後已移除。固定保存為 tooling failure、不計入 baseline 或 live acceptance，詳見 `acceptance/kbar-shadow-failure-2026-09-09.md`。
  - 2026-09-10 full-session capture 已通過 20／20 檔、每檔 270 個 completed minute 與 baseline 驗證；但 08:45 自動任務未納入同日被動 K 線 evidence 與 runtime assurance 的必做／缺件守門，兩份 companion evidence 未保存。因此本日 capture 固定不計入三件式完整盤中驗收日，但可作 2026-09-11 的 `live_full_session_verified` baseline；若 9/11 自身三件式 evidence 與跨日量比重播通過，即可完成本項必要的一日功能驗收，不必等待 9/14。根因與修正見 `acceptance/companion-evidence-root-cause-and-fix-2026-09-10.md`。
  - 2026-09-11 三件式 evidence 已齊全：20／20 檔各 270 個 completed minute、同日被動 K 線新鮮度與 runtime assurance 均通過；以 9/10 `live_full_session_verified` baseline 組成的功能 bundle 經 validator 回傳 `valid=true`、`readyForHumanReview=true`，重播辨識 8 筆 trigger，未發生不完整資料誤報、重複通知、broker write、production transition 或服務生命週期 mutation。結果見 `acceptance/pilot-evidence-bundle-2026-09-10_2026-09-11.json`。
- [x] 8.3 由人工審閱「可信前日 baseline＋一個完整盤中日」的 20 檔 evidence；只有分鐘與量比可重算、重播一致、零重複通知、零不完整資料誤報且既有功能無退化時才核准本機 20 檔試辦版；第二完整日為非阻擋穩定性追蹤，50 檔以上另開 change
  - 2026-09-11 Codex 依使用者明確授權代理完成 GO／NO-GO 審閱，並清楚標示不是使用者本人簽核；抽樣重算、資源尖峰、provider unknown、第二完整日非阻擋追蹤及 rollback 條件均已保存於 `acceptance/pilot-stage-review-2026-09-11.md`，決策為本機 simulation 固定 20 檔 `GO`。
- [x] 8.7 執行既有圖表、watchlist、alert、smart order、simulation runtime、盤後選股、workspace、MultiView 與服務生命週期回歸，證明 broker write、production 切換及自動啟停服務皆為 0
- [x] 8.8 完成實際桌面、窄寬、600／768／900 CSS px 高、特大字級、多分頁、離線、popup blocked 與 Notification denied 的逐項 UI 驗收及 console 檢查
  - 2026-09-07 依實際 63 檔畫面將左側容量摘要、警示、通知、頁籤、新增／匯入工具與監控商品卡緊湊化；長狀態改為跨欄完整顯示，桌面商品卡主要控制改為單列。重驗 1512 × 982、390 × 844、1024 × 600 及 150% 字級無頁面溢出；見 `acceptance/compact-left-panel-ui-2026-09-07.md`。
- [x] 8.9 彙整 bounded KBar Gate、20 檔完整日、資料品質、資源、UI、accessibility、rollback 與 reviewer sign-off 證據，記錄 provider physical usage unknown 與 active 上限 20 的決策
  - 2026-09-09 已更新 pending manifest，納入 9/8、9/9 失敗證據與收盤後回補離線驗證；`acceptance-dossier.prepared-2026-09-09-v2.json` 的 schema、16 個引用檔案與 SHA-256 均有效。
  - 2026-09-10 已完成正常歷史 baseline 路線與「外部可信 baseline＋一個完整盤中日」bundle 工具；目前只剩 9/11 三件式完整日、實際功能 bundle、人工審閱／簽核、正式 active 上限與未解風險確認，故本項維持未完成。
  - 2026-09-11 建立 `acceptance-dossier.manifest.final-2026-09-11.json` 與 `acceptance-dossier.final-2026-09-11.json`；dossier validator 回傳 `valid=true`、`readyForArchive=true`、23 個引用檔案 hash 全部一致。正式 active 上限固定 20，provider physical usage／global ownership／release／headroom 保持 unknown，未解風險均保留並完成代理審閱。
- [x] 8.10 執行相關單元、整合、browser 測試、`git diff --check` 與 `openspec validate add-configurable-intraday-relative-volume-monitor --strict`，確認所有 required artifacts 與驗收證據完整後才進入歸檔候選
  - 2026-09-09 盤後重跑 `pnpm test`（213 files／2,329 tests）、`pnpm build`、strict OpenSpec validation 與 `git diff --check` 均通過。
  - 2026-09-10 完成 4.18／4.19／8.1c 後重跑 `pnpm test`（218 files／2,369 tests）、`pnpm build`、strict OpenSpec validation 與 `git diff --check` 均通過；仍須等 9/11 三件式完整日、實際 bundle 與 reviewer sign-off 齊全後執行最後一次全套驗證，故本項維持未完成。
  - 2026-09-11 最終採信驗證：`pnpm test` 218 files／2,369 tests、`pnpm test:browser` 11 files／111 tests、`pnpm build`、strict OpenSpec validation、`git diff --check` 全部通過；詳見 `acceptance/final-verification-2026-09-11.md`。另一次重疊執行的非採信測試曾出現 smart-order watchdog timing 單次失敗，已如實保留為非阻擋測試排程風險。
