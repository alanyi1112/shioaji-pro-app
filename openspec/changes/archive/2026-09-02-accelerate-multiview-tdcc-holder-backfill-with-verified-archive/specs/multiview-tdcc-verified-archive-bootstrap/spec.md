## ADDED Requirements

### Requirement: 歷史鏡像必須維持 TDCC provider 與合法授權語意

系統 MUST 將核准的 `wirelessr/tdcc-opendata-archive` 定位為 TDCC `1-5` 資料的歷史傳輸鏡像，主資料 provider MUST 維持 `tdcc`，不得把鏡像誤標為獨立官方來源。使用、API provenance 與可閱讀說明 MUST 明確標示原資料提供機關、資料集、政府資料開放授權條款第 1 版、鏡像 repository 與驗證版本；不得保存或揭露憑證、cookie、token 或個人識別資料。

第一版 MUST 只納入與近 51 週目標具有連續價值、且來源鏈通過本 change 驗證的 2026 快照。來源鏈不同且與目前窗口中斷的 2021 快照 MUST NOT 混入近一年連續線圖或完成計數。

#### Scenario: 顯示由鏡像快速補入的持股資料

- **WHEN** 大戶／散戶持股副圖使用 verified archive row
- **THEN** 資料 provider MUST 顯示或回傳 TDCC，provenance MUST 另記錄鏡像 transport、exact commit、檔案 hash 與 normalization version
- **AND** 使用者可取得符合授權要求的原資料提供機關顯名

#### Scenario: 發現 2021 非連續快照

- **WHEN** 初始 manifest 掃描到 repository 的 2021 目錄
- **THEN** 第一版 importer MUST 排除該目錄，51 週 expected／completed 與副圖相鄰週計算均不得包含這些日期

### Requirement: Archive manifest 必須固定不可變來源並先完成全批驗證

每次初始 bootstrap MUST 使用 committed allowlist manifest，逐期固定 exact repository commit、HTTPS URL、資料日期、原始位元組數、SHA-256 與 normalization version。下載只允許核准 host、固定 commit 與 `snapshots/2026/<date>.csv` path，MUST NOT 接受 redirect、浮動 `main`、query／環境變數／UI 提供 URL 或其他任意來源。

任何正式寫入前，目標 manifest 全部檔案 MUST 通過 UTF-8、精確欄名、單一預期日期、證券代號正規化、唯一 1–17 級、安全整數、比例、調整／合計守恆、row／symbol count、bytes 與 SHA-256 驗證。最新 manifest period MUST 與同次取得的 TDCC 官方 OpenAPI canonical 全市場 rows 完全一致；每個歷史 period MUST 與資料庫任何既有官方重疊列一致。

#### Scenario: 固定 manifest 全部通過

- **WHEN** 所有檔案符合 exact manifest、完整 17 級與守恆規則，最新 period 也與官方全市場資料完全相同
- **THEN** importer 才可建立 staging rows 與待 finalize receipt
- **AND** receipt MUST 保存 commit、date、URL、bytes、SHA-256、row count、symbol count、官方 anchor 與 validator version

#### Scenario: 任一檔案或官方錨點不一致

- **WHEN** 任一期 hash、bytes、欄名、日期、級距、數值、合計、既有官方重疊列或最新官方全檔 anchor 不一致
- **THEN** 本次新 manifest run MUST 在任何正式資料寫入前 fail closed，保存非敏感 safe reason
- **AND** 既有 verified rows、receipts、continuous checkpoint 與副圖 MUST 保持不變

### Requirement: 全市場週次必須 staging-first 且只下載一次

Importer MUST 以 market-period 為工作單位，每個 manifest period 在每個環境最多執行一次受 lease／checkpoint 管理的下載與完整解析，再依當次支援台股母體建立所有合法 `symbol + data_date` rows。MUST NOT 因每位使用者、每次新增商品、圖表載入或同 period 多個 target 重複下載相同 CSV。

資料 MUST 先寫入 run 隔離的 staging，完成 row count、distinct symbol、material hash 與 integrity readback 後才可 period-atomic finalize。API 與副圖只可讀取 receipt 為 verified 的正式 rows，不得讀取半完成 staging。

#### Scenario: 先匯入全市場再新增 8103

- **WHEN** 2026 verified periods 已完成全市場 finalize，使用者之後把 8103 加入 MultiView
- **THEN** shareholder-distribution API MUST 直接從正式資料庫回傳 8103 在合法 period 中的已驗證歷史
- **AND** 本次新增操作的 archive、TDCC history 與其他 provider request 計數 MUST 為零

#### Scenario: 匯入在 chunk 中途停止

- **WHEN** process、網路、D1 batch 或 lease 在某 period staging 中途失敗
- **THEN** 該 period MUST 維持 pending／failed receipt，正式表不得出現該 period 的部分新 rows
- **AND** 後續 run 只可依相同 manifest 與 run checkpoint 安全續作或重新 staging

### Requirement: Archive rows 必須只補缺並保留來源優先序

Archive finalize MUST 對 `symbol + data_date` 採 insert-only。既有 `official-openapi`、`official-history` 或 `legacy-verified` row MUST 保留 material 與 provenance；相同內容可記為 `matched_existing`，不同內容 MUST 標示 `source_mismatch`、阻擋該 period 的不安全提升，且不得覆蓋、刪除、補零或 forward-fill。

每個新增 archive row MUST 可由 row provenance 連回 verified period receipt，並保存 material hash。官方來源日後取得相同日期時，系統 MUST 比對 canonical material；相同才可提升為 official-confirmed，不同則保留最後 verified row並進入可觀測衝突狀態。

#### Scenario: 日期已有官方歷史列

- **WHEN** archive period 包含一筆資料庫既有的 official-history row 且 material 完全相同
- **THEN** importer MUST 保留既有 row／provenance，不執行覆蓋
- **AND** receipt MAY 將該筆記為 matched existing

#### Scenario: Archive 與官方資料衝突

- **WHEN** 相同商品與日期的完整 17 級 canonical material 不一致
- **THEN** 系統 MUST 保存既有官方列、標示 `source_mismatch` 並停止該不安全 period finalize
- **AND** health 與 operator evidence MUST 顯示安全原因，不得把任何一方數值靜默改成另一方

### Requirement: Verified archive coverage 必須精準併入 51 週補缺計畫

只有正式表存在完整 row、對應 period receipt 為 verified，且該日期屬官方 period plan 時，系統才可將相同 `symbol + data_date` 的 continuous item 計為 completed。缺少商品 row、非官方日期、staging row、failed receipt 或衝突 row MUST NOT 增加 completed。

Reconciliation MUST 以 distinct dates 計算 `expectedWeeks`、`archiveImportedWeeks`、`officialVerifiedWeeks`、`completedWeeks`、`remainingWeeks`、`failedWeeks` 與 `overdue`，不得讓 archive 與 official 同日期重複計數。官方 history runner MUST 只 claim remaining dates，並持續執行到既有 51 週目標完成或留下可驗證的合法 unknown／blocked 原因。

#### Scenario: 8103 已有一期官方資料並快速補入多期

- **WHEN** 8103 原先只有最新一期，archive finalize 又提供與 official plan 相交的多個完整日期
- **THEN** completedWeeks MUST 只增加新取得的 distinct verified dates，remainingWeeks MUST 相同幅度下降
- **AND** 最新一期 archive／official 重疊不得計算兩次

#### Scenario: Archive 不含某個 expected date

- **WHEN** 51 週 plan 中有日期不在 verified manifest 或該商品於 period 無合法 row
- **THEN** 該 date MUST 留在 official remaining／可解釋 unknown，不得以 period receipt 存在便標記 completed

### Requirement: 未來週次必須由官方 latest 保存或經官方完全對帳後 append

一般週更 MUST 繼續以 TDCC 官方 latest pipeline 保存全市場資料。若系統要把新的鏡像檔加入可重建 manifest，候選檔 MUST 先固定 immutable commit 與 hash，且其資料日期與 canonical 全市場內容 MUST 與同次官方 OpenAPI 完全一致；manifest 只能 append 新日期，不得就地修改任何既有 period。

系統 MUST 以 payload `資料日期` 與 official period evidence 判斷新週，MUST NOT 以星期幾、檔名、Git commit 時間或政府資料目錄的更新頻率欄位冒充實際資料日期。

#### Scenario: 新官方週期到達

- **WHEN** TDCC latest pipeline 取得新的完整全市場 `資料日期`
- **THEN** 系統 MUST 先按既有 official 流程保存該期，之後新增商品可直接重用
- **AND** 鏡像是否稍後 append 不得阻擋官方 latest 發布

#### Scenario: Upstream 改寫舊日期

- **WHEN** 新 upstream commit 對已驗證 period 提供不同 hash 或內容
- **THEN** manifest updater MUST 拒絕改寫既有 receipt／rows 並標示 drift
- **AND** 只有獨立 source review 與明確新 migration 才能處理歷史修訂

### Requirement: 完成證據必須涵蓋來源、資料、效率與三環境

Change 完成前 MUST 保存非敏感 source review、授權與顯名、exact manifest、validator version、逐 period receipt、row／symbol count、資料庫容量增量、target／processed／remaining／failed／overdue、material hash 與 official anchor。測試 MUST 涵蓋 hash／bytes／UTF-8／欄位／級距／整數／合計錯誤、redirect、浮動 URL、重入、lease、chunk 中斷、衝突、重疊去重、官方回退、actual new listing 與 2021 排除。

本機、Sites 保留站與 Cloudflare 正式站 MUST 分別以同一 release SHA 驗證 migration、receipt、代表 `.TW`／`.TWO`、8103、API coverage、protected health、實際 DOM、可見 canvas 尺寸與 console。任一環境未驗證不得由其他環境成功代替。

#### Scenario: 宣告快速 bootstrap 完成

- **WHEN** 實作者要勾選資料 seed 與三環境驗收任務
- **THEN** 對應環境 MUST 顯示 manifest periods 全部 finalized、remaining archive work／failed／overdue 為零、integrity 通過且代表商品可見歷史符合 receipt
- **AND** 既有 official remaining MAY 大於零，但 MUST 清楚區分為 51 週官方補缺而非 archive seed 失敗

#### Scenario: 驗收新增商品 warm path

- **WHEN** 已完成 seed 的環境新增一檔先前未在個人清單、但存在 verified market periods 的合法商品
- **THEN** 下一次 shareholder-distribution API MUST 只讀資料庫並回傳可用歷史，代表性本機 p95 目標 MUST 不超過 2 秒
- **AND** archive/provider request、Shioaji 訂閱、交易、runtime 啟停與清單外商品副作用 MUST 為零
