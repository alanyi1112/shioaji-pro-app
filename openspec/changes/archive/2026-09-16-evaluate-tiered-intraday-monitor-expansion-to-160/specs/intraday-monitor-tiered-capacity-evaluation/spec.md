## ADDED Requirements

### Requirement: 系統必須分離離線負載與盤中容量證據

系統 MUST 使用不同 schema、evidence class 與 validator 保存離線負載結果及盤中 provider 結果。離線 fixture 即使來源為已封存的正式 capture，只要透過複製、映射或 synthetic symbol 擴成較大 cohort，就 MUST 標記為 `synthetic_load_only`，且 MUST NOT 作為正式行情覆蓋、provider subscription 容量、physical usage、release 或 headroom 證據。

#### Scenario: 收盤後建立 160 檔離線負載

- **WHEN** operator 使用通過 hash 與 schema 驗證的封存 capture 建立 160 檔 synthetic load fixture
- **THEN** 系統 MUST 保存 source hash、expansion mapping、target count 與 `synthetic_load_only` evidence class
- **AND** 系統 MUST 在不提出 provider subscription、不發通知、不送 broker write 且不啟用 production 的情況下量測 CPU、RSS、DB、replay 與 UI 效能

#### Scenario: 離線結果被提供給正式盤中 validator

- **WHEN** 正式盤中 bundle 引用 synthetic load evidence 作為逐商品或 provider 容量證據
- **THEN** validator MUST 拒絕該 bundle，且 MUST 回報明確 reason code

### Requirement: 盤中擴量必須支援由 20 直接驗證 160 檔

主路徑 MUST 以已核准 20 檔的有效功能 bundle 與對應 reviewer GO 直接進入 160。前置 MUST 支援可信前日 baseline＋一個三件式完整盤中日的功能 bundle，並保留舊有效兩日 bundle 相容。50／100 MAY 作未來診斷，MUST NOT 作為 160 必要前置。缺有效 bundle、GO、cohort、資源預算或 preflight 時 MUST fail closed。

#### Scenario: 20 檔尚未核准

- **WHEN** operator 要求 160，但 20 檔 bundle 或 reviewer GO 不完整
- **THEN** 系統 MUST 拒絕 live execution authority，僅可執行離線評估

#### Scenario: 由 20 直接測試 160

- **WHEN** 20 檔功能 bundle／GO 有效、160 離線 Gate 與新版計畫的所有 preflight 均通過
- **THEN** 系統 MAY 依明確執行授權準備 160 單次測試，MUST NOT 因沒有 50／100 結果而拒絕
- **AND** validator 自身 MUST NOT 啟動訂閱或修改產品 active limit

#### Scenario: 舊版逐級 execution token 被重用

- **WHEN** 直接 160 路徑收到舊版 token、已用 token 或與 plan／cohort 不符的 token
- **THEN** 系統 MUST 拒絕，不得沿用過期前級推定

### Requirement: 每個 stage 必須使用 immutable cohort 與獨立 simulation session

每個 live stage MUST 使用 exact target count 的 immutable cohort receipt manifest、獨立 simulation process／session、單一 batch subscribe、單一專用 SSE 與完全相同 cohort 的單次 unsubscribe。同一 session MUST NOT 輪替、補位、擴量，亦 MUST NOT 因 unsubscribe accepted 而重用推定容量。

#### Scenario: Stage 進行中商品沒有資料

- **WHEN** stage cohort 中任一商品在開始後沒有合法 KBar receipt 或形成 minute unknown
- **THEN** 系統 MUST 保留該商品與缺口證據，不得換入其他商品
- **AND** 該完整日 MUST NOT 取得 promotion 資格

#### Scenario: 同一 session 要求改變 target count

- **WHEN** operator 或程式嘗試把正在執行的 50 檔 session 改成 100 或 160 檔
- **THEN** 系統 MUST 拒絕變更，且原 cohort hash MUST 維持不變

#### Scenario: unsubscribe accepted 但 physical release 不可證實

- **WHEN** stage 結束收到 unsubscribe accepted，但沒有 provider physical release diagnostics
- **THEN** evidence MUST 將 release 與 headroom 保持 `unknown`
- **AND** 同一 process／session MUST NOT 再啟動另一個容量 stage

### Requirement: 正式 stage 必須保存完整且不可補造的逐分鐘證據

正式完整交易日 MUST 對 exact cohort 的每個商品保存 09:01–13:30 共 270 個 minute slots、來源版本、connection generation、接收與 seal 時間、累積成交量、完整性與 reason。系統 MUST 區分有來源證明的零成交分鐘與 unknown；MUST NOT 將沒有 KBar 或其他權威來源的空白補成零成交。個股可能因暫緩收盤機制延至 13:33 撮合，因此 exact cohort MUST 維持原訂閱至 13:33 後的有界傳輸寬限，且 MUST NOT 早於 13:34:30 核發 close authority 或解除訂閱。合法 13:33 成交或來源在寬限期內送達的 13:30 revision MUST 併入 canonical `13:30` 端點並保存逐檔 `closeMode`；MUST NOT 建立 13:31–13:33 regular-session minute rows。

#### Scenario: 全 cohort 具有完整分鐘證據

- **WHEN** exact cohort 每檔都有 270 個可驗證 minute slots、無 unknown、cohort hash 未變且 session 正常 close seal
- **THEN** 該日 MAY 被計入該 stage 的完整交易日

#### Scenario: 任一分鐘缺乏權威證據

- **WHEN** 任一商品任一 minute slot 沒有可驗證來源，或 sequence、時間、累積量、單位不一致
- **THEN** 系統 MUST 將該 slot 標為 unknown 或 invalid
- **AND** validator MUST 拒絕將該日計入完整交易日

#### Scenario: 少量商品只缺收盤尾端 live KBar

- **WHEN** 原始 live capture 的 09:01 canary 為 160／160、盤中連續性與其他 Gate 均通過，且最多 4 檔各自只缺落在 13:26–13:30 的最後連續至多 5 分鐘
- **THEN** 原始 capture 與首次 NO-GO MUST 保留，不得覆寫或將缺口改稱 live
- **AND** 系統 MAY 在收盤後以同來源完整 270 分鐘 KBar 雙抓 hash 一致、且逐分 live cumulative prefix 完全相符的證據建立 derived acceptance
- **AND** 回補列 MUST 標記 `liveDelivered=false`，不得取得通知、retroactive trigger、production 或 broker-write 權限
- **AND** 缺漏達 5 檔、超過 5 分鐘、不在連續尾端、雙抓漂移或 live prefix 衝突時，validator MUST 維持 NO-GO

#### Scenario: 160 檔中部分個股延後至 13:33 收盤

- **WHEN** exact 160 中一般個股已形成 13:30 收盤資料，另有個股在相同 generation 於 13:33 形成合法延後收盤 KBar
- **THEN** recorder MUST 同時保留一般個股的 `closeMode=normal_or_revised_13_30` 與延後個股的 `closeMode=delayed_13_33`
- **AND** 延後成交量 MUST 併入該個股 canonical `13:30` 累積量，完整日仍為每檔 270 slots

#### Scenario: 排程在延後收盤完成前嘗試結束 160 stage

- **WHEN** runner 在 13:34:30 前嘗試封存 session 或解除 cohort 訂閱
- **THEN** close authority MUST 被拒絕，且該日 MUST NOT 取得完整日或晉級資格

### Requirement: 每一級必須通過資料、資源、重連與既有功能 Gate

每個 stage plan MUST 在執行前鎖定 CPU、RSS、DB growth、磁碟、event-to-seal latency、chart freshness 與 reconnect budgets。正式 bundle MUST 保存觀測值、兩次以上 deterministic replay、既有 K 線／watchlist／alert／smart-order／MultiView 回歸結果，以及 notification、broker write、production transition、service lifecycle mutation ledger。

#### Scenario: 所有 Gate 通過

- **WHEN** 完整日資料可重算、replay output hash 一致、資源未超過執行前鎖定的預算、重連成功、既有功能無退化且所有禁止 operation 都為零
- **THEN** validator MUST 僅輸出 `readyForHumanReview=true`
- **AND** validator MUST NOT 自動晉級或修改正式 active limit

#### Scenario: evidence 產生後放寬預算

- **WHEN** stage evidence 已存在後，manifest 或 plan 的 resource budget 被修改
- **THEN** canonical hash 驗證 MUST 失敗，且該 evidence MUST NOT 用於晉級

#### Scenario: browser assurance 產生額外訂閱

- **WHEN** chart freshness probe 出現非允許的 HTTP method 或 subscribe／unsubscribe mutation
- **THEN** assurance MUST 保存實際 operation 並維持 pending 或 failed
- **AND** 系統 MUST NOT 將其標記為零干擾回歸證據

### Requirement: Stage 160 必須使用可信前日基準加一個完整盤中日

Stage 160 MUST 使用 exact cohort 的可信前一適用交易日 1 分 K baseline，加一個有效完整盤中日，或符合本規格受限收盤尾端政策的 derived acceptance。baseline MUST 以每檔 1 分 K Volume 按分鐘累加，共 160 × 270 筆，與 20 檔相同算法。正常歷史 baseline MUST 核對來源身分、時區、單位、雙抓穩定性、完整分鐘、一般交易時段總量與 canonical hash；MUST NOT 將歷史資料計為 live 日、混入盤後定價量或以其他商品複製補足。

第二個完整盤中日 SHOULD 作非阻擋穩定性追蹤；MUST NOT 阻擋已通過的一日功能驗收。plan／token MUST 使用新版，舊版兩日硬門檻 artifacts 保留歷史但不能沿用執行。50／100 MUST NOT 作必要前置。

#### Scenario: 可信基準與單日完整

- **WHEN** exact 160 cohort 的可信前日 baseline 有效，一個完整盤中日及 replay、資源、三件式回歸 Gate 全部通過
- **THEN** validator MAY 輸出 `readyForHumanReview=true`，不必等待第二個盤中日
- **AND** 正式 active limit 仍 MUST 等待明確 GO 決策

#### Scenario: 缺基準或使用錯誤交易日

- **WHEN** baseline 缺任一商品、分鐘、hash 不符或不是緊接前一適用交易日
- **THEN** MUST 維持 `waiting_baseline` 且 `readyForHumanReview=false`
- **AND** 若正常歷史基準不能建立，MAY 先採集一個完整日基準，再於下一個適用交易日驗收；MUST NOT 補造零成交分鐘或在已啟動的 live session 換股補位

#### Scenario: 追加穩定性追蹤

- **WHEN** 單日功能驗收已通過
- **THEN** 第二日追蹤 MUST 為非阻擋；若發現退化 MUST 重新處理風險

### Requirement: 擴量流程必須維持 simulation-only 與零交易權限

所有離線及 live capacity stage MUST 固定為 loopback simulation、feature-off、通知關閉，且 MUST 沒有 broker write、production transition、自動 service lifecycle 或自動 active-limit mutation authority。任何安全前置條件不明或失敗時 MUST fail closed。

#### Scenario: runtime 不是 simulation

- **WHEN** preflight 無法證實 `simulation=true`、loopback 或 production false
- **THEN** 系統 MUST 拒絕執行，且 MUST NOT 發出 subscription 或 broker request

#### Scenario: operation ledger 出現禁止行為

- **WHEN** evidence 顯示 notification dispatch、broker write、production transition、自動 service lifecycle mutation或未授權 active-limit mutation大於零
- **THEN** 該 stage MUST 判定失敗
- **AND** 系統 MUST 保留 evidence 並維持最近人工核准的 active limit

### Requirement: 晉級與回復必須由人工核定並保留完整稽核鏈

每一級的 promotion、NO-GO 與最終 active limit MUST 由人工 reviewer 明確簽核。系統 MUST 保留成功、失敗、中斷與 release unknown evidence；MUST NOT 為取得通過結果而覆寫或刪除舊 evidence。

#### Scenario: 直接 Stage 160 判定 NO-GO

- **WHEN** 160 測試失敗、證據不足或 reviewer 判定 NO-GO
- **THEN** 系統 MUST 維持已核准的 20，不得回復到未驗證的 100
- **AND** MUST NOT 自動開始 50／100 診斷、重試或變更產品設定

#### Scenario: Stage 160 完成但尚未決定產品上限

- **WHEN** Stage 160 evidence 已可供人工審閱，但最終 active limit 尚未簽核
- **THEN** 系統 MUST 保持既有正式 active limit
- **AND** change MUST NOT 被標記為可歸檔完成


### Requirement: 160 檔證據必須有獨立有界空間與原子保存

160 路徑 MUST 使用版本化空間 profile：32 MiB session canonical、64 MiB capture、128 MiB bundle canonical／output 與 offline fixture；MUST NOT 改變已完成 fixed-20 路徑上限。每次建立 artifact 前 MUST 確認至少 8 GiB 可用磁碟，且 plan 必須引用相同 profile。未知空間、低於保留、超過單檔／canonical 上限時 MUST 拒絕。暫存採 exclusive create、fsync 與原子 no-clobber 發布；失敗 MUST 保留既有 evidence，不得以自動刪除歷史回收容量。Live stream／frame／log 上限接線亦必須在 live runner 完成前驗證。

#### Scenario: 160 完整兩日 synthetic 儲存驗證

- **WHEN** 工具以已驗證來源映射兩日各 43,200 分鐘，執行序列化、雜湊、落檔及讀回
- **THEN** MUST 保存 source hashes、實際 bytes、peak RSS、兩次重播與 readback hashes
- **AND** MUST 標示 synthetic_load_only，不能宣稱 provider／DB／UI 或完整 live 已通過

#### Scenario: 磁碟不足或檔案已存在

- **WHEN** free space 少於 8 GiB、無法量測或目標檔已存在
- **THEN** writer MUST 拒絕並保留既有檔案，不啟動 provider 或自動清理歷史

#### Scenario: 完整日大於舊雜湊容量

- **WHEN** 合法 160 檔資料超過舊 4 MiB 但仍在新 profile 上限內
- **THEN** 160 專用 canonical／writer MUST 能完成一致性 round trip
- **AND** 超過新上限仍 MUST fail closed，不得無界放寬


### Requirement: 盤中執行前的明確授權替換必須建立新版本

在 live stage 尚未啟動時，若使用者明確授權替換基準缺資料的商品，系統 MAY 從既有 configured 清單選擇一檔合格且不重複的股票。MUST 先驗證替補商品的前日 1 分 K 基準，再建立新的 exact 160 cohort、plan、baseline set 與替換稽核紀錄。其餘 159 檔可重用有 hash 的原始資料，但 MUST 重新驗證並綁定新 cohort。MUST NOT 覆寫舊 artifacts、沿用舊 execution token，或將替換解讀為正式 active limit 變更。

#### Scenario: 使用者在盤前授權替換一檔

- **WHEN** 尚未啟動 live stage，使用者明確要求替換缺資料股票，且替補商品基準通過
- **THEN** 系統 MUST 保存新舊商品、原 cohort hash、來源重用 ledger 與新版 manifest／plan／baseline hashes
- **AND** exact 160 基準全部通過才 MAY 標示 baselineUsable=true；live 驗收仍 MUST 另外完成

### Requirement: 驗收 recorder 與產品盤中選股必須共用同一份 sealed observation

Stage 160 完整日執行時，系統 MUST 將同一個有界 KBar transport 與 recorder 接受的 sealed 1 分 K observation 寫入產品 evidence repository，並依當下 config threshold 計算量比及首次 trigger。系統 MUST NOT 為產品面板另開第二組 160 provider 訂閱，亦 MUST NOT 以驗收 JSON 事後模擬為即時產品結果。

#### Scenario: 驗收日 160 檔形成完整分鐘

- **WHEN** recorder 接受某分鐘 exact 160 檔的合法 sealed observation
- **THEN** 產品 evidence DB MUST 保存相同 contract、trade date、minute、cumulative common lot、source version 與 connection generation
- **AND** 本機 status MUST 顯示 `evaluationStageTarget=160`、`dataActive=160` 與 `boundedTransportReady=true`

#### Scenario: 產品 persistence 失敗

- **WHEN** 任一已被 recorder 接受的 observation 無法寫入產品 evidence DB 或建立一致 trigger
- **THEN** 該 observation MUST NOT 被當作成功產品證據，商品與整體 runtime MUST 標為 degraded／failed
- **AND** 完整日 bundle MUST NOT 取得審閱資格

### Requirement: 產品 SSE 必須即時投影持久化 trigger 並精確續傳

本機 API MUST 從產品 evidence repository 投影新增 trigger。每一筆 SSE event id MUST 對應該筆已送出事件後的持久化 cursor；連線在批次中任一事件後中斷時，`Last-Event-ID` 重連 MUST NOT 跳過未送事件或重複產生通知。歷史 replay 與 160 驗收日 MUST 保持 `notificationAuthority=false`。

#### Scenario: 外部 recorder 寫入新 trigger

- **WHEN** Web process 以外的有界 160 recorder 將 trigger 寫入 evidence DB
- **THEN** 已連線面板 MUST 經 local SSE 收到該 trigger，而不必重載頁面
- **AND** 搜尋、排序、選取與 K 線連動 MUST 使用這份持久化結果

#### Scenario: SSE 在一批事件中途重連

- **WHEN** client 保存最後一筆已收到 event id 後重新連線
- **THEN** server MUST 從下一筆持久化 trigger 繼續投影
- **AND** replay MUST NOT 取得通知權限或造成重複通知

### Requirement: 160 正式啟用必須綁定完整 bundle 與受委託審閱

系統 MUST 先保存 `pending_review` 狀態。只有當 exact 160 單日 bundle 通過所有資料、資源、同日圖表、local SSE reconnect 與既有功能 Gate，且 Codex 依使用者明確委託保存帶 hash 的 GO review 時，activation 才 MUST 將正式 `approvedActiveLimit` 原子改為 160。任一引用不一致、NO-GO、缺證據或寫檔失敗時 MUST 維持 20。

#### Scenario: Codex 審閱完整 160 bundle 為 GO

- **WHEN** capture、bundle、review、manifest、baseline 與 trade date hashes 全部一致且 reviewer sign-off 為真
- **THEN** 產品狀態 MUST 轉為 `complete_go`、`evaluationState=go` 與 `approvedActiveLimit=160`
- **AND** MUST 保存 active-limit mutation count 與 review artifact，不得覆寫舊 evidence

#### Scenario: activation 引用錯誤 bundle

- **WHEN** review bundle hash、capture session hash 或產品 runtime state 與待啟用 evidence 不一致
- **THEN** activation MUST 拒絕且不修改 active limit

### Requirement: 正式完整日必須量測產品 DB 與同日畫面健康

產品化 Stage 160 的資源 Gate MUST 使用實際 evidence DB 加 WAL 成長量，不得固定填零。Chart freshness MUST 使用同交易日既有頁面的被動 DOM visual commit 證據；Web／MultiView HTTP latency MAY 作服務可達性證據，但 MUST NOT 取代圖表視覺更新。系統 MUST 以唯讀 local trigger SSE probe 驗證斷線重連。

#### Scenario: 只有 HTTP 200 沒有圖表更新

- **WHEN** 5173／5174 可達，但缺同交易日 visual commit 前進或 chart freshness 超過 plan 上限
- **THEN** 完整日 bundle MUST NOT 取得審閱資格

#### Scenario: DB／WAL 成長超過盤前預算

- **WHEN** 本次產品 evidence DB 與 WAL working growth 超過 plan 的 `maxDatabaseGrowthBytes`
- **THEN** resource Gate MUST 失敗並保留量測，不得以 capture JSON 大小取代該數值
