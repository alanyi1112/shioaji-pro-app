## MODIFIED Requirements

### Requirement: 上一交易日同分鐘基準必須完整且可追溯

每個 active 商品 MUST 以交易日曆 authority 決定上一個適用官方交易日，並建立 regular-session minute cumulative baseline。baseline MUST 帶來源、來源版本、取得時間、原始單位、canonical 單位、預期 minute 範圍、實際涵蓋、完整度與 hash；不得用瀏覽器日曆昨日、昨日全天量比例、今日 Snapshot 或任意較舊日期替代。

日常 `daily` 模式 MUST 優先使用符合「正常前一交易日歷史 1 分 K 必須經驗證後才可作 baseline」及新版日常來源契約的 `minute_volume_baseline_verified_v2`，不要求前日 live capture。若只有合法 v1 baseline，resolver MUST 唯讀重用並保留其原 provenance；不得改寫 v1 或將 v2 宣稱為雙抓／全日 ticks 對帳資格。legacy diagnostic 模式保留相同 bounded KBar recorder 已 seal 的 `live_full_session_verified` 優先序與原嚴格來源契約。

未驗證歷史 Kbars MUST 維持 `historical_unverified`。通過 legacy 正常雙抓驗證的資料維持 `historical_baseline_verified`，通過 legacy 中斷 repair 的資料維持 `historical_repaired_verified`；v2 使用獨立的來源／結構資格。以上歷史資料都只能供緊接的下一個適用交易日作 baseline，不得取得來源日 live acceptance、retroactive trigger 或通知權限。任何歷史來源都 MUST NOT 變成盤中週期輪詢。缺少與目前 completed-minute 相同 minute key 的合法 baseline、前一日分母為 0 或來源不完整時，商品 MUST 維持不可比較且不得觸發。

#### Scenario: 週一使用上一個星期五基準

- **WHEN** 交易日曆 authority 證實星期一的上一個適用交易日為前一個星期五
- **THEN** 系統 MUST 使用星期五相同 minute key 的完整累積量，不得使用週日或任意最近一筆資料

#### Scenario: 前一交易日同分鐘為零量

- **WHEN** 前一交易日的目標 minute key 已完整驗證且累積量為 0
- **THEN** 商品 MUST 顯示不可比較的零分母原因，MUST NOT 產生 Infinity、達標或通知

#### Scenario: 第一個完整錄製日

- **WHEN** legacy diagnostic 固定 cohort 首次完成從 session 起點至 close seal 的完整交易日錄製
- **THEN** 系統 MUST 依原契約封存該日作為下一適用交易日 baseline，當日通知數 MUST 為 0，不得將診斷錄製改名為 daily 驗收

#### Scenario: 晚開頁或錄製中斷

- **WHEN** 頁面在 session 起點後才取得 lease，或任一商品 KBar 串流中斷／缺棒
- **THEN** 受影響 live coverage MUST 保存為 partial；缺少可用基準的商品 MUST 維持 `waiting_baseline`，連續性未恢復的商品不得新比較／通知
- **AND** 盤中系統 MUST NOT 以估算、週期歷史 polling 或無界 retry 補成完整 live 日；已規範的有界 gap repair 必須保留 historical provenance
- **AND** 收盤後獨立建基準或 legacy 驗證式回補成功，仍 MUST 保持 `liveCaptureAcceptance=false`，不得冒充完整 live capture

#### Scenario: 前日沒有完整擷取檔

- **WHEN** daily 模式前一適用交易日沒有 capture，但已有合法 v2 同商品、日期與分鐘基準
- **THEN** 系統 MUST 正常進行今日同分鐘比較，不得因前日 live partial 或 capture_missing 阻擋

### Requirement: 正常前一交易日歷史 1 分 K 必須經驗證後才可作 baseline

系統 MUST 明確區分日常 v2 基準、legacy v1 bootstrap 與中斷 repair。日常模式 MUST 在來源日最早 13:34:30（Asia/Taipei）定稿後，以有界歷史 1 分 K 建立緊接下一適用交易日基準；不得要求當日 live capture、interruption evidence、每日 Stage GO 或固定 20 檔名單。商品 MUST 依實際核准設定／daily plan 獨立驗證，清單重排不得改變身分或重抓。盤中 polling、輪替與無界 retry MUST 被拒絕。

每商品 MUST 驗證官方日期、前後適用交易日、商品／交易所、Asia/Taipei、來源／版本、原始與 canonical `common_lot` 單位、來源欄位等長、已核實分鐘編碼、09:01–13:30 coverage、嚴格遞增分鐘、無重複／跨日／負量／倒退／盤外異常。日常 v2 預設一次來源查詢；可信同日 regular-session 收盤總量已有時 MUST 對帳，有衝突 MUST 拒絕。沒有可信獨立總量時，僅完整直接觀測的 270 分鐘可依 v2 來源／結構契約發布，MUST 明列 `closeTotalCheck=not_observed`、`independentReconciliation=false`。

缺少成交的分鐘 MUST NOT 直接補 0。只有其餘非負分鐘量已與可信 regular-session 收盤總量完全對帳、商品狀態可證實，因而能證明缺口只能為零成交，且具有可驗證的前一個 close 時，才得建立帶證據的 `known_zero` 與 `carry_forward`。合法 13:33 延後撮合 MUST 只併入 canonical 13:30，MUST NOT 建立 13:31、13:32、13:33 regular-minute rows；未知收盤編碼、13:29 前置連續性不足或 cumulative volume 倒退 MUST fail closed。任一未知、缺漏或衝突 MUST 只拒絕該商品，不得以部分成功宣稱整批完整。

全部通過後，系統 MUST 重建 270 筆 canonical cumulative-volume series，原子保存不可變 manifest，包含商品／交易所、sourceTradeDate／targetTradeDate、來源／版本、實際 fetch time、單位、coverage、close mode、calendar reference、payload hash、verifier version 與實際 validation checks。v2 schema MUST 為 `intraday-minute-volume-baseline/2`、provenance 為 `minute_volume_baseline_verified_v2`，不得偽造 refetch time／hash。repository MUST 使用 monotonic revision 與 conflict detection，同來源版本、商品與日期的新內容衝突 MUST 拒絕覆寫。

legacy v1 的 `historical_baseline_verified` 資格 MUST 保留原兩次獨立 fetch、canonical 內容／hash 相同、可信收盤總量與來源核對契約；舊 manifest 的兩次 fetch time／hash、final-volume reconciliation、cohort hash 與 provenance 不變。legacy resolver 中 `live_full_session_verified` 保持較高優先序；daily resolver 的新版偏好不得覆寫或降級既有檔案。升格成功 MUST 只設定 `baselineUsable=true`，固定 `liveCaptureAcceptance=false`、`notificationEligible=false`、`retroactiveTriggerEligible=false`；基準建立本身不得產生來源日或目前日 retroactive trigger、聲音或通知。

#### Scenario: 正常歷史基準完整通過

- **WHEN** legacy v1 前一適用交易日某商品兩次歷史 1 分 K 內容相同，270 分鐘結構、收盤總量、單位與收盤模式全部通過
- **THEN** 系統 MUST 保存原 `historical_baseline_verified` immutable manifest 與 cumulative series
- **AND** 該商品 MUST 只取得下一適用交易日的 baseline authority

#### Scenario: 正常歷史基準重抓不穩定

- **WHEN** 相同來源版本、商品與日期的兩次 canonical payload 或 hash 不一致
- **THEN** 系統 MUST 保存衝突並維持不可用／`waiting_baseline`，不得覆寫任何既有 manifest；v2 亦不得藉不同 schema 忽略已知衝突

#### Scenario: 正常歷史基準缺分鐘且無零成交證據

- **WHEN** 歷史資料缺少預期 minute，且無法由可信收盤總量與商品狀態證明缺口為零成交
- **THEN** 系統 MUST NOT 補 0、carry-forward 或建立 baseline

#### Scenario: 正常歷史基準的合法 known-zero

- **WHEN** 其餘非負分鐘量總和已等於可信收盤總量、商品狀態合法，且缺口有可驗證前一 close
- **THEN** 系統 MUST 在建立 `known_zero`／`carry_forward` 時保存 baseline manifest 的實際證據

#### Scenario: 正常歷史基準處理延後收盤

- **WHEN** 分鐘連續至 13:29 且合法 13:33 延後撮合資料可驗證
- **THEN** 系統 MUST 將延後撮合量併入 canonical 13:30、記錄 `closeMode=delayed_13_33`，且不得建立 13:31–13:33 rows

#### Scenario: 不是緊接的前一交易日

- **WHEN** 候選歷史日期不是交易日 authority 判定的緊接前一適用交易日
- **THEN** 系統 MUST 拒絕升格，不得以任意較舊完整資料替代

#### Scenario: 已有完整 live baseline

- **WHEN** legacy diagnostic resolver 同商品與日期已有 `live_full_session_verified` baseline
- **THEN** resolver MUST 使用 live baseline，不得以正常歷史基準覆寫、降級或改變 acceptance 語意

#### Scenario: 正常歷史基準不產生通知

- **WHEN** 歷史資料成功升格供目前交易日比較
- **THEN** 因升格動作新增的 retroactive trigger、聲音與系統通知數 MUST 全部為 0

#### Scenario: 日常單次分鐘資料完整通過

- **WHEN** daily 模式單次查詢來源及完整 270 分鐘符合 v2 契約
- **THEN** 系統 MUST 保存獨立 v2 資格及實際總量核對狀態，不要求第二份 K 或全日 ticks，不得標成 v1 雙抓通過

#### Scenario: 日常唯讀沿用舊版基準

- **WHEN** 沒有符合日期的 v2，但有同商品與緊接前日的合法 v1 baseline
- **THEN** daily resolver MUST 保留其原 provenance 與 hash 並唯讀使用，不得因清單重排或模式改變重新下載
