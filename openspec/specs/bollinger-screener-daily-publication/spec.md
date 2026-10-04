# bollinger-screener-daily-publication Specification

## Purpose
定義獨立於籌碼與瀏覽器的本機盤後準備及發布流程，依官方交易日與來源完整性執行有界重試、晚開機補跑、冪等發布與唯讀查詢，保留原失敗及安全驗收證據。
## Requirements
### Requirement: 純價量發布必須獨立於籌碼及瀏覽器

系統 MUST 在本機以普通股母體、官方交易日與新價量 capability 發布 v8 immutable 底稿及三階段預設報告，不得要求 v5／v6／v7 籌碼 head ready。背景工作 MUST 不依賴任何頁面、圖表週期、畫面可見性或 Codex 排程；指標計算、準備與發布 MUST 不由 GET 觸發。啟用其他籌碼分支時 MUST 只 join 同一 D／universe revision 的合法資料，未備齊分支 MUST 為 unknown。

#### Scenario: 法人與 TDCC 尚未公布

- **WHEN** 同日官方價量及歷史已驗證，但法人／TDCC 尚未 ready
- **THEN** 布林純價量底稿與報告 MUST 可發布，單獨查布林 MUST 可用；啟用的未備齊籌碼分支 MUST 明示 unknown

#### Scenario: 所有瀏覽器關閉

- **WHEN** 每日策略已初始化啟用且本機 runtime 運作，但沒有任何 Web 或 MultiView 頁面
- **THEN** 本機 MUST 仍自行準備、發布、寫 run receipt 與休眠，不能要求開啟 1 分 K 或特定版面

#### Scenario: 舊籌碼工作停用且共用日曆到期

- **WHEN** v8 每日策略已啟用，但舊 v5／TDCC 工作停用，既有日曆缺少或到期
- **THEN** 新能力 MUST 以有界的獨立官方日曆準備入口續跑；不得等 TDCC 才能查明交易日，也不得把來源錯誤推論為休市或延長過期 authority

### Requirement: 盤後執行必須以官方資料 readiness 而非時鐘直接成功

系統 MUST 在 Asia/Taipei 官方交易日 14:00 起接入既有本機盤後入口，只有上市／上櫃同一 D 的已驗證官方日報或 Shioaji daily_quotes 備援，其日期、schema、來源及全市場批次終態通過才切換 head。共同官方日曆與普通股母體 MUST 另行成立；一份備援可以覆蓋兩市場，但不得省略逐市場／逐商品核對。14:00 MUST 是檢查起點，不是來源已公布保證。資料尚未公布 MUST 保留 expectedSessionDate／effectiveSessionDate、pending 原因及舊快照；舊結果 MUST 明示日期與過期並禁止當作今日可操作結果。休市 MUST 不產生新資料日。

#### Scenario: 一市場仍回昨日資料

- **WHEN** 14:00 後 TWSE 已有 D，但 TPEx 仍回 P
- **THEN** 系統 MUST 不發布混日 v8，保留等待狀態與兩市場原因，不把 P 標為 D

#### Scenario: 日期正常但個別商品短歷史

- **WHEN** 兩市場批次已驗證並完整列出母體終態，但部分新上市商品不能算 120 日相對基準
- **THEN** 報告 MUST 可在列出逐商品 unknown 與守恆計數後發布；不得把全市場 ready 誤解為每檔皆可判定

#### Scenario: 官方上櫃來源失敗但備援批次合法

- **WHEN** TPEx 日報無法使用，而獨立 verified 的備援及共同 Gate 已確認兩市場同一 D 的完整批次
- **THEN** MUST 允許正常 staging／發布，保存來源 manifest、切換原因及原 TPEx 失敗；不能稱 TPEx 入口恢復

### Requirement: 每日發布必須冪等且保留設定版本

系統 MUST 使用 `(D, universeRevision, dataMappingVersion, formulaVersion, dailyProfileRevision)` 作為唯一成功發布鍵，dataMappingVersion MUST 引用來源 policy 版本及不可變 source-selection manifest hash；先 staging 再核對母體／雙市場／hash／守恆並原子切換 publication head。相同鍵重複觸發 MUST no-op，不重新抓來源或重算指標。官方來源恢復 MUST NOT 隱式重建成功鍵或改寫 head。已成功報告 MUST 不因 UI 草稿改動而改寫；不同每日設定只可由使用者明確儲存後建立新 revision 與引用同日凍結底稿的新報告，舊報告及收據 MUST 保留。

#### Scenario: 同日並行觸發兩次

- **WHEN** 兩個 worker 同時嘗試同一每日發布鍵
- **THEN** 租約與資料庫唯一性 MUST 只允許一個成功發布，另一個為 lease_busy／unchanged，不能產生兩份成功 head

#### Scenario: 只調整面板草稿

- **WHEN** 使用者修改放量倍數但未明確儲存每日設定
- **THEN** 背景 dailyProfileRevision、已發布報告及原始收據 MUST 不變

### Requirement: 來源重試與晚開機補跑必須有界自主恢復

背景 MUST 沿用本機 watcher／RunAtLoad，來源未公布或可恢復傳輸失敗須有界退避與 checkpoint。每 provider/market/date/capability MUST 最多 18 次來源嘗試；Shioaji 全市場批次 MUST 共用一次計數，不分市場加倍。一般重試至少間隔 20 分鐘；429 MUST 尊重 Retry-After 且至少一小時；schema／日期違反 MUST 保留 invalid 且不得自動解除。官方尚在 cooldown 時 MAY 使用已獨立 verified 且不在 cooldown 的備援，但 MUST 不重試官方、不重設任一來源嘗試數，且兩者合計 MUST 遵守每輪兩次 HTTP／8 MiB 及集中持續保留的日額度。單次 run MUST 不超過 15 分鐘。晚開機 MUST 補最近已完成且尚未完成的官方資料日，不無界補跑多年歷史報告、不冒稱當時排程成功。收據 MUST 分列 provider、trigger、時間、資料日、嘗試、結果、nextAttemptAt、request／row／bytes、切換及 admission 原因，原 failed／partial MUST 不覆寫。

#### Scenario: 收盤後才開機

- **WHEN** 當日正式資料已公布且使用者在 18:00 啟動本機，今日尚無報告
- **THEN** 既有喚醒入口 MUST 以 late-boot trigger 有界補跑今日，不偽造 14:00 receipt

#### Scenario: 429 後再觸發

- **WHEN** 來源回 429 且下一次 watcher 在 cooldown 到期前執行
- **THEN** MUST 只讀取並回報等待，不發新來源請求、不重置嘗試或覆寫失敗 evidence

### Requirement: 休眠判定必須逐能力而非依 v5 全域完成

idle gate MUST 分別計算 enabled capability 的 head、當日 progress、設定 revision 與 nextAttemptAt。v5 已完成 MUST NOT 阻擋 v8 尚未完成工作；v8 完成 MUST NOT 停止其他未完成能力。全部當日適用能力完成後，選股只做唯讀 fast path，下一新交易日工作不得早於官方下一交易日 14:00。既有 TDCC watcher 與盤中監控排程 MUST 不因布林報告完成而停止或改頻率。

#### Scenario: v5 完成但 v8 未完成

- **WHEN** v5 head 已 published 且 v8 history 仍 pending
- **THEN** watcher MUST 允許 v8 在其預算與 cooldown 內續跑，不得回全域 session_complete_sleeping 而略過它

#### Scenario: v8 完成後再次輪詢

- **WHEN** v8 當日同設定完成且其他能力無到期工作
- **THEN** 選股 MUST 不下載或重算，保存下一官方交易日允許時間；TDCC 與行情服務維持原運作

### Requirement: v8 查詢必須版本隔離且沒有行情交易副作用

API MUST 只讀取已發布的凍結底稿並做有界純函式條件判定／排序／分頁，MUST NOT 抓來源、補建指標、寫 DB 或建立行情訂閱。snapshot／data capability／mapping／formula／criteria fingerprint／cursor／cache MUST 版本化；v1–v7 數值、偏好、cursor 與舊 head MUST 不重解釋。新分支關閉時 MUST 保持舊查詢可用，新分支啟用但沒有 v8 MUST 明示 pending。明確儲存每日 profile MUST 是獨立本機驗證寫入，不與 GET 混合，也不立即擷取來源。

#### Scenario: v7 已可用但 v8 尚未初始化

- **WHEN** 使用者啟用布林新分支而只有 v7 snapshot
- **THEN** 查詢 MUST 回 v8 pending，不能用 v7 130 日偽裝；停用新分支後舊查詢 MUST 仍可用

#### Scenario: 展開證據並翻頁

- **WHEN** 使用者查詢、排序、翻頁或展開證據
- **THEN** source request、broker login／subscription、委託與交易草稿 MUST 不變；只允許既有本機唯讀查詢

### Requirement: 結案必須具備真實盤後自動發布與可重算證據

正式驗收 MUST 保存至少一個真實官方交易日的雙市場來源日期／receipt、全市場逐商品 readiness、獨立公式重算、三類與 unknown 守恆、自動 run／atomic head、相同鍵 no-op、實際 API／UI／console 及無交易／行情副作用證據。fixture／隔離 late-boot 或續跑測試 MUST 與真實自動 run 分開，不得相互冒充；尚未發生真實自動發布 MUST 保持 live task 未完成。

#### Scenario: 離線測試全部通過但沒有真實自動 run

- **WHEN** focused tests 與 strict validation 通過，但只有人工 publish 或歷史 fixture
- **THEN** MUST 不宣稱每日自動發布已正式驗收，保留未完成的 live task 與原因
