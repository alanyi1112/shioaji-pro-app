## ADDED Requirements

### Requirement: Durable premarket 必須每日建立目前交易日 session authority

系統 MUST 由 durable local scheduler 在每次 08:20 執行時，以 `Asia/Taipei`、前一適用交易日盤後已發布且完整驗證的本機 TWSE／TPEx 官方年度日曆判定當日與上一個適用交易日；盤前四步 MUST NOT 依賴當時再連官方網站。適用交易日 MUST 原子建立唯一 session manifest，綁定 trade date、previous trade date、config revision、cohort hash、baseline hash、artifact bundle hash、approval hash、API generation 與 scheduler receipt；08:35、08:45、08:50 MUST 讀取並驗證同一份 manifest。固定日期 config、過去交易日 claim 或昨日 successful state MUST NOT 取代當日 rollover。

#### Scenario: 下一個適用交易日自動 rollover
- **WHEN** 官方交易日 authority 判定今天為新的適用交易日，且上一日 approval 與所需 artifacts 有效
- **THEN** 08:20 runner MUST 建立今天唯一的 current-session manifest，後續三個步驟 MUST 使用相同 session id 與 hashes
- **AND** operator MUST NOT 需要手動修改 `tradeDate` 或複製前一日設定

#### Scenario: 排程執行但設定仍停在過去交易日
- **WHEN** durable scheduler 已於今天觸發，但可讀取的 session 或 legacy config 仍綁定過去交易日
- **THEN** 系統 MUST 記錄 `session_rollover_missing` 或 `session_trade_date_stale` incident
- **AND** MUST NOT 將此情況記成 non-trading no-op、沿用歷史 subscription receipt 或宣稱今日監控已啟動

#### Scenario: 今天不是官方交易日
- **WHEN** 官方交易日 authority 明確判定今天不是適用交易日
- **THEN** 系統 MUST 保存帶 authority 來源與日期的 non-trading receipt，且不得建立 KBar demand

#### Scenario: 盤後官方來源暫時連線失敗
- **WHEN** 盤後建檔取得 TWSE／TPEx 官方年度日曆時，任一來源失敗、逾時或 schema 不合格
- **THEN** 採集器 MAY 以 TWSE 官方 OpenAPI 與另一個 TWSE 官方年度端點作有界來源切換；TPEx 官方來源仍必須驗證
- **AND** 未完成雙來源及 baseline 驗證時 MUST 保存失敗收據，不得發布可供隔日盤前使用的新 artifact

#### Scenario: 盤前使用前一日已驗證的本機官方日曆
- **WHEN** 08:20／08:35／08:45／08:50 需要判定當日是否為預排交易日
- **THEN** runner MUST 唯讀驗證已發布 baseline 的 hash、官方雙來源 schema／年份／日期、source version、來源日與目標交易日，不向官方網站發起新請求
- **AND** 最新 artifact 缺失、篡改、來源不一致或超過有界期限時 MUST 保存 `calendar_authority_unavailable`，不得猜測交易日或回退至更舊 artifact

#### Scenario: 08:20 失敗後後續盤前步驟有條件恢復
- **WHEN** 08:20 留下同日 `calendar_authority_unavailable` 原始失敗收據且無 session，後續步驟重新取得合格的本機 authority 與完整基準、安全 Gate，並能證明今日無 capture／訂閱／observation／trigger
- **THEN** 08:35／08:45 MAY 以自身 claim 建立 session 並重驗完整 Gate，收據 MUST 連結原 08:20 收據 SHA-256 且標為 `session_recovered_after_0820_failure`
- **AND** MUST 保留原 08:20 失敗與 `scheduled0820Success=false` 語意；不得啟停服務、建立第二條訂閱或把恢復冒稱 08:20 自動驗收成功；08:50 不得補建

### Requirement: 盤前產品啟動輸入與失敗警示必須提早、獨立驗證

08:35／08:45 的 Gate MUST 唯讀執行與正式產品 sink 相同的固定 cohort 順序、160 檔基準及 durable Stage 160 approval 靜態輸入驗證；前一日可變 `failed`／`complete_go` 不得決定今日核准。預檢不得建立訂閱、修改 session 或取代當日 authority／generation Gate。正式排程失敗時 MUST 保存原始收據並同日嘗試本機警示；獨立唯讀稽核 MUST 在 08:52 檢查 08:50 收據、13:40 檢查正式擷取結果。警示交付結果 MUST 另存不可覆寫收據，區分 OS 接手、交付失敗與使用者實際看見（未知）；通知失敗不得隱藏原故障或觸發 broker／服務操作。

#### Scenario: 前一日擷取失敗但今日正式核准與 session 有效
- **WHEN** 前一日產品狀態為 `failed`，今日固定 cohort、基準、正式 Stage 160 approval 與 current session 均通過
- **THEN** 08:35／08:45 預檢 MUST 通過產品靜態輸入，08:50 不得再因前一日 phase 拒絕產品 sink

#### Scenario: 盤前預檢或收盤擷取失敗
- **WHEN** 盤前產品輸入不合格，或正式擷取收尾產生失敗 sidecar
- **THEN** 系統 MUST 保留原失敗證據、嘗試同日通知，並由 08:52／13:40 獨立稽核發現漏報
- **AND** `alertEligible` 或 `os_handoff` MUST NOT 被當成使用者已讀或當日監控成功

#### Scenario: 08:52 正式擷取仍在執行
- **WHEN** 08:50 已有當日排程 claim、同日 session 已接受 control-plane 訂閱且仍新鮮執行中，尚無失敗 sidecar，但 full-session 擷取尚未產生收尾 receipt
- **THEN** 08:52 稽核 MUST 將收尾 receipt 缺席視為待完成，不得單憑缺席送出 `premarket_step_failed` 通知
- **AND** 當日失敗 sidecar、明確失敗 receipt 或有界執行中證據過期時仍 MUST 保留原警示與 13:40 收尾稽核

### Requirement: Premarket 執行 artifacts 必須在 OpenSpec 歸檔後保持可解析

系統 MUST 將 cohort、plan、baseline prerequisite 與 verifier metadata 匯入以 SHA-256 定址的 immutable runtime artifact bundle。執行期 MUST 以 bundle manifest 驗證 schema、來源 identity、hash 與相依關係，不得依賴可被 OpenSpec archive 搬移的 active-change 絕對路徑，亦不得以 basename 搜尋、symlink 或最近檔案猜測替代。

#### Scenario: OpenSpec change 歸檔後啟動下一交易日
- **WHEN** 原始 acceptance artifacts 已由 `openspec/changes/<name>/` 搬至 archive
- **THEN** premarket Gate MUST 透過既有 immutable runtime bundle 解析完全相同的內容與 hashes
- **AND** archive 搬移 MUST NOT 使合法下一交易日啟動失敗

#### Scenario: Bundle 缺檔或 hash 不符
- **WHEN** runtime bundle 缺少必要 artifact、schema 不符或內容 hash 與 manifest 不一致
- **THEN** runner MUST fail closed、保存 `artifact_bundle_invalid`，且不得啟動 subscription、通知、production 或 broker write

### Requirement: Premarket 排程必須保存每日實際執行與 rollover 結果

每個排程時點 MUST 保存 scheduler computed fire time、實際開始時間、當地日期、session id、step claim、rollover outcome 與失敗 reason。status 與維運查詢 MUST 能區分 scheduler 未執行、非交易日 no-op、rollover 失敗、Gate 失敗與 capture 已啟動；stdout／stderr 丟棄或 LaunchAgent loaded MUST NOT 作為執行成功證據。

#### Scenario: 四個排程時點都有 run 但 rollover 失敗
- **WHEN** 08:20、08:35、08:45、08:50 都有 scheduler run，而 current-session manifest 未建立
- **THEN** 狀態 MUST 回報四個 run 與共同 rollover blocker，不得只顯示 LaunchAgent loaded 或 historical GO

### Requirement: 下一交易日的分鐘量基準必須在前一交易日收盤後有界產出

系統 MUST 在官方 authority 確認的適用交易日收盤後，使用既有 simulation business session 逐檔取得同日歷史 1 分 K，累計封閉分鐘成交量，並依既有雙抓、逐筆每分鐘、契約、`common_lot`、官方日曆與 cohort hash 驗證。啟動預算 MUST 由目前 provider 總額、同 cohort 近期至少兩次完整驗證的實測成本及有界安全係數計算，不得採用固定剩餘 bytes 起跑線；樣本或 usage 欄位不足 MUST fail closed。採集期間 MUST 在每個資料請求前重新查核 provider 剩餘額度與動態保留額，並持續估計剩餘 160 檔工作量。MUST 保留 8 GiB 磁碟保留、串行間隔與有界期限；MUST NOT 自行登入、訂閱、重啟服務或降低資料驗證條件。只有 160 檔完整合格時才可原子發布下一適用交易日精確日期路徑的 baseline bundle。

#### Scenario: 歷史 1 分 K 與逐筆資料完整
- **WHEN** 收盤後來源、官方日期、流量與 cohort 均合格，且 160 檔每分鐘成交量及終量核對一致
- **THEN** 排程 MUST 保存來源／驗證 receipt，並發布 160 檔、270 個已封閉分鐘的隔日 baseline bundle

#### Scenario: 流量不足或部分商品驗證失敗
- **WHEN** provider 使用量不足以涵蓋動態保留額與實測預算、實測樣本不足，或任一商品資料缺漏／不一致
- **THEN** 系統 MUST 保留失敗或 partial receipt，MUST NOT 發布可用 baseline，隔日 session MUST 顯示 `baseline_missing`

#### Scenario: 同日有限重試不覆寫第一次失敗
- **WHEN** 第一次嘗試已留下完整失敗 receipt，且原因可恢復、仍在同一適用交易日的指定重試時段
- **THEN** runner MAY 建立最多第二、第三次獨立 claim／來源／budget／receipt，MUST NOT 覆寫先前任何證據
- **AND** 前次仍在執行、已有可用 baseline 或超出嘗試上限時 MUST no-op

#### Scenario: 當日排程失敗後的事後歷史補建
- **WHEN** 使用者明確指定過去 1–30 日的來源交易日，下一個由當前 TWSE／TPEx 官方日曆證實的適用交易日尚未到來，且既有 simulation business session、不可變 160 檔 cohort、動態流量預算及磁碟保留皆通過
- **THEN** 系統 MAY 在獨立 namespace 進行最多三次有界歷史採集，MUST 維持同日採集的雙抓、逐檔 270 分鐘、ticks、契約、單位、成交量與來源日期驗證
- **AND** 只有 160/160 完整通過才 MAY 原子發布供下一適用交易日使用的精確 baseline 路徑；原排程失敗 claim／receipt MUST 原樣保存，補建 receipt MUST 明示非當時排程成功，且不得取代翌日真實 session／盤中驗收

### Requirement: 開盤前 API 換代只能在零資料活動時受控恢復

若 08:20 後 API generation 改變，runner MUST 先將舊 session 視為 `generation_mismatch`。僅在同交易日官方 authority、cohort／bundle／approval／config revision、simulation business session 與 Snapshot 重新驗證，且原 session 尚未提出或接受訂閱、逐檔無訂閱與第一筆 KBar、無結果及觸發時，MAY 以 append-only transition receipt 推進同 session 的 generation epoch。MUST 保留原身份與失敗收據，轉換後重跑完整 Gate；任一條件未知或已活動時 MUST fail closed。

#### Scenario: 08:20 後 API 於訂閱前換代
- **WHEN** 原 session 無 control-plane／data-plane 活動、所有資料 identity 與新 simulation generation 均已核對
- **THEN** runner MAY 記錄舊／新 identity 與 generation 的不可覆寫 receipt，恢復後再通過完整 premarket Gate

#### Scenario: 換代時已有合法 KBar 或訂閱
- **WHEN** 任一 control-plane、逐檔 subscription、第一筆 KBar、結果或觸發已存在或不可證明為零
- **THEN** runner MUST 保持 `generation_mismatch`，不得重綁 session 或重播結果
