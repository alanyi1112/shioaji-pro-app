## ADDED Requirements

### Requirement: 監控名單必須可設定且與實際啟用容量分離

系統 MUST 允許使用者保存最多 200 個去重後的合法上市或上櫃台股整股 STK 合約，支援全域門檻、逐商品覆寫、啟用狀態、穩定排序與來源標記。全域及逐商品量比門檻 MUST 支援 1.5、2、3 快速值及 1.00–100.00、最多兩位小數的自訂 decimal；預設 MUST 為 1.5。設定 mutation MUST 使用版本、revision 與固定 schema 原子驗證，非法商品、重複商品、超量或非法門檻 MUST NOT 部分寫入。

configured 商品數 MUST NOT 被描述成 active 商品數。bounded KBar pilot 的 eligible 商品 MUST 另符合實測 endpoint 的四位 ASCII 數字 stock code 限制，並排除實測 batch accepted 但沒有逐檔 KBar receipt 的 `00` 開頭 ETF 代號；其他合法 STK 仍可保存 configured，但 MUST 顯示 `kbar_contract_unsupported`，不得進入 cohort。每個商品 MUST 明確呈現 `disabled`、`waiting_gate`、`waiting_pilot_limit`、`waiting_baseline`、`active` 或 `degraded` 等可辨識狀態與原因。

#### Scenario: 保存 200 檔合法候選名單

- **WHEN** 使用者提交 200 個去重後合法台股整股 STK 合約與合法門檻
- **THEN** 系統 MUST 原子保存設定並回傳相同 revision 下的 configured 數量、排序與逐商品有效門檻
- **AND** 系統 MUST 另行回傳實際 active 數量，不得宣稱 200 檔已同時監控

#### Scenario: 候選名單超過上限或含非法輸入

- **WHEN** 去重後候選名單超過 200 檔，或任一商品／門檻不合法
- **THEN** 系統 MUST 拒絕整筆 mutation、保留上一個合法 revision，並回傳逐項可讀錯誤

#### Scenario: 個別門檻覆寫全域門檻

- **WHEN** 全域門檻為 1.5 且某商品合法覆寫為 3
- **THEN** 該商品 MUST 只以未四捨五入的 3 倍門檻判定，其他商品 MUST 繼續使用 1.5 倍

### Requirement: bounded KBar Gate 通過後才可啟動 20 檔試辦

系統 MUST 在任何盤中監控 demand 前確認固定 loopback Shioaji API、`simulation=true`、KBar SSE 可達、不可變 cohort hash、最多 20 檔、通知關閉及 feature-off 試辦模式。Gate evidence MUST 保存 API 版本、request schema、逐商品實際 KBar receipt、事件欄位／單位、前後 SSE aggregate 與所有 mutation 摘要，但 MUST 將 provider physical usage、counting dimension 與 release confirmation 保持為 `unknown`，不得用 HTTP 200 或 connection count 補造。

#### Scenario: simulation 2 檔受控探針成功

- **WHEN** 一個 `subscribe/kbars` request 對固定 2 檔 cohort 被 accepted，且專用 SSE 在同分鐘逐檔收到合法 `code/date/time/volume`
- **THEN** Gate MAY 證明 multi-stock KBar functional path 可用
- **AND** MUST NOT 宣告 physical usage、200 檔容量或 unsubscribe release 已證實

#### Scenario: production 或 KBar 資料缺漏

- **WHEN** `simulation` 不是 true、endpoint 非 loopback、cohort 超過 20、SSE 不可達或任一商品沒有合法 KBar
- **THEN** session MUST fail closed，受影響商品 MUST NOT 進入 active，且不得改用 Snapshot／ticks／Kbars polling

### Requirement: bounded transport 只能管理單一固定 cohort

每個 Shioaji process／session，盤中監控 MUST 最多建立一個不可變的 20 檔 KBar batch 與一條專用 SSE。第 21 檔起 MUST 顯示 `waiting_pilot_limit`；同一 session 內不得輪替、補位、擴量或根據 unsubscribe accepted 重用容量。停止時只可對完全相同 cohort 送一次 unsubscribe，並保存 accepted／unknown 語意。

盤中監控 MUST NOT 接管或改寫 chart、watchlist、alert、smart order、MultiView 或外部 client 的 subscription。provider physical usage 及 headroom MUST 顯示 unknown；若既有 K 線新鮮度或 simulation runtime 退化，試辦 MUST 停止新增判定。

#### Scenario: configured 有 200 檔

- **WHEN** 200 檔皆合法啟用且使用者排序已確定
- **THEN** session cohort MUST 固定為排序前 20 檔，其餘 180 檔 MUST 顯示 `waiting_pilot_limit`
- **AND** 系統 MUST NOT 在其中一檔無資料時以第 21 檔補位

#### Scenario: unsubscribe 回傳 accepted

- **WHEN** 相同 cohort 的 unsubscribe 回傳 HTTP 200 與 `success=true`
- **THEN** 系統 MUST 只記錄 request accepted，MUST NOT 宣告 provider physical capacity 已釋放或在同一 session 配置新 cohort

### Requirement: 盤中監控只能由有效頁面 lease 啟動

每個「盤中選股」分頁 MUST 以 opaque client identity 取得有期限的 lease，並以有界 heartbeat 續期。至少一個當期 lease 存在時，runtime MAY 依設定及 admission 提出 intraday-only demand；所有 lease 到期或被釋放後，runtime MUST 停止新增比較與觸發、完成已開始的原子 minute flush，並釋放 intraday-only demand。已保存的設定、基準、分鐘 evidence 與當日結果 MUST 保留。

多個分頁 lease MUST 共用同一監控 session、physical subscription 與 trigger ledger，不得使相同商品重複訂閱或重複通知。correctness MUST NOT 依賴 `beforeunload` 成功送出。

#### Scenario: 第一個盤中選股分頁開啟

- **WHEN** 使用者開啟盤中選股分頁並成功取得第一個有效 lease
- **THEN** runtime MUST 依最新合法設定、Gate 0 與容量結果啟動 eligible 商品，不得啟動未設定或等待中的商品

#### Scenario: 最後一個分頁異常關閉

- **WHEN** 最後一個 lease 因分頁崩潰或停止 heartbeat 而到期
- **THEN** runtime MUST 自動停止新增事件並釋放 intraday-only demand
- **AND** 已保存資料 MUST 保持可供下次開頁重播，不得因此清空名單或當日結果

#### Scenario: 同時開啟兩個分頁

- **WHEN** 兩個合法盤中選股分頁同時持有 lease
- **THEN** coordinator MUST 只維持一份去重後 demand 與 trigger ledger，任一 trigger MUST NOT 產生兩筆系統通知事件

### Requirement: 分鐘累積量必須由已 seal 的 realtime KBar 建立

即時 observation MUST 只接受固定 cohort 的合法台股整股 STK realtime 1 分 KBar `volume`，並使用 `common_lot`（張）單位。每筆 MUST 包含 canonical contract、trade date、bar time、receive time、stream generation、per-symbol sequence、來源版本與品質旗標。舊 generation、重複或倒退 minute、跨日、future timestamp、非安全整數、負量、cohort 外商品或單位不明 MUST NOT 推進 minute state。

剛收到的 KBar MUST 先視為 forming。只有同商品下一個連續 minute 抵達，或可信 session-close seal 驗證完成，前一根才可 seal；累積量以 sealed `volume` 依序加總。任一 gap、重連、漏棒或亂序 MUST 將受影響 minute 與其後累積量標為 unknown，且不得用 0、carry-forward 或歷史 polling 補造。

recorder MUST 考慮個別有價證券可能延後至 13:33 收盤。當來源沒有可信的逐檔延後收盤旗標時，固定 cohort MUST 全數維持原訂閱至 13:33 後的有界資料傳輸寬限期，且 session-close authority MUST NOT 早於 13:34:30 核發。若收到合法 13:33 延後收盤 KBar，只有相同 generation 的 regular-session sequence 已連續至 13:29 時，才 MAY 將該撮合量併入 canonical `13:30` 累積端點；來源 MAY 已有 13:30 forming 棒，也 MAY 因 13:30 未實際撮合而由 13:33 事件直接橋接。系統 MUST NOT 建立 13:31、13:32 或 13:33 regular-session minute rows。每檔完整日 evidence MUST 記錄一般／修訂 13:30 或延後 13:33 的 `closeMode`。

#### Scenario: 同一 KBar 重送

- **WHEN** 相同 generation、symbol 與 minute 的 KBar 被重送兩次
- **THEN** recorder MUST 只保留一份 forming／sealed state，累積量與 trigger MUST NOT 重複增加

#### Scenario: 下一分鐘使前一根完成

- **WHEN** 09:37 的合法 KBar 在相同 generation 抵達，且前一根為連續的 09:36
- **THEN** 09:36 MAY 被 seal 並累加，09:37 MUST 仍保持 forming，直到下一根或合法 close seal

#### Scenario: 中間漏一根

- **WHEN** 某商品從 09:36 直接收到 09:38，沒有可驗證的 09:37
- **THEN** 09:37 與其後累積量 MUST 為 unknown，且系統 MUST NOT 以 0 或前值補上

#### Scenario: 一般商品於 13:30 收盤

- **WHEN** 商品具備連續至 13:29 的 sealed sequence、合法 13:30 forming KBar，且 13:33 後寬限期內沒有延後收盤 KBar
- **THEN** recorder MUST 在不早於 13:34:30 的 close authority 下將 13:30 seal，並記錄 `closeMode=normal_or_revised_13_30`

#### Scenario: 商品延後至 13:33 收盤

- **WHEN** 相同 generation 的 regular-session sequence 已連續至 13:29，且收到合法 13:33 KBar；來源可能已有 13:30 forming，也可能因 13:30 未撮合而直接從 13:29 接續
- **THEN** recorder MUST 將 13:33 撮合量併入 canonical 13:30 累積端點，記錄 `closeMode=delayed_13_33`
- **AND** evidence MUST 仍只有 09:01–13:30 共 270 個 regular-session minute，不得補造 13:31–13:33 rows

#### Scenario: 13:31 嘗試整批封存

- **WHEN** operator 或排程在 13:31 嘗試核發 session-close authority
- **THEN** authority MUST 被拒絕為 `session_not_closed`，transport MUST 繼續接收原 cohort，且不得提前 unsubscribe

#### Scenario: 延後收盤編碼無法驗證

- **WHEN** 13:33 KBar 缺少連續至 13:29 的前置證據、發生量倒退，或來源使用未知收盤編碼
- **THEN** 該商品 MUST 標為 degraded／partial，該日 MUST NOT 成為 baseline 或產生通知

### Requirement: 上一交易日同分鐘基準必須完整且可追溯

每個 active 商品 MUST 以交易日曆 authority 決定上一個適用官方交易日，並建立 regular-session minute cumulative baseline。baseline MUST 帶來源、來源版本、取得時間、原始單位、canonical 單位、預期 minute 範圍、實際涵蓋、完整度與 hash；不得用瀏覽器日曆昨日、昨日全天量比例、今日 Snapshot 或任意較舊日期替代。

合法 live baseline SHOULD 優先來自相同 bounded KBar recorder 已 seal 的上一完整交易日。歷史 Kbars 預設沒有 coverage receipt，只可作診斷或顯示 `historical_unverified`；只有通過本規格「正常前一交易日歷史 1 分 K 驗證基準」的資料，才 MAY 升格為 `historical_baseline_verified`，而盤中中斷後通過「收盤後驗證式歷史 1 分 K 回補」的資料才 MAY 升格為 `historical_repaired_verified`。兩者都只能供緊接的下一個適用交易日作 baseline，不得取得 live acceptance 或通知權限。任何歷史來源都 MUST NOT 變成盤中週期輪詢。缺少與目前 completed-minute 相同 minute key 的合法 baseline、前一日分母為 0 或來源不完整時，商品 MUST 維持不可比較且不得觸發。

#### Scenario: 週一使用上一個星期五基準

- **WHEN** 交易日曆 authority 證實星期一的上一個適用交易日為前一個星期五
- **THEN** 系統 MUST 使用星期五相同 minute key 的完整累積量，不得使用週日或任意最近一筆資料

#### Scenario: 前一交易日同分鐘為零量

- **WHEN** 前一交易日的目標 minute key 已完整驗證且累積量為 0
- **THEN** 商品 MUST 顯示不可比較的零分母原因，MUST NOT 產生 Infinity、達標或通知

#### Scenario: 第一個完整錄製日

- **WHEN** 固定 cohort 首次完成從 session 起點至 close seal 的完整交易日錄製
- **THEN** 系統 MUST 封存該日作為下一適用交易日 baseline，當日通知數 MUST 為 0

#### Scenario: 晚開頁或錄製中斷

- **WHEN** 頁面在 session 起點後才取得 lease，或任一商品 KBar 串流中斷／缺棒
- **THEN** 該日 MUST 保存為 partial 並維持 `waiting_baseline`
- **AND** 盤中系統 MUST NOT 以歷史 Kbars、估算或無界 retry 補成完整日
- **AND** 收盤後若執行驗證式回補，成功結果仍 MUST 保持 `liveCaptureAcceptance=false`，不得冒充完整 live capture

### Requirement: 正常前一交易日歷史 1 分 K 必須經驗證後才可作 baseline

當緊接目前交易日之前的適用官方交易日沒有 `live_full_session_verified` baseline 時，系統 MAY 在該前一交易日 13:34:30（Asia/Taipei）收盤定稿後、目前交易日開始比較前，對固定 20 檔 cohort 逐商品取得一次性、有界的歷史 1 分 K。流程 MUST 明確區分正常 baseline bootstrap 與中斷 repair，不得要求 interruption evidence，也不得在盤中以 polling、輪替或無界 retry 維持資料。

每個商品 MUST 獨立驗證：官方交易日且確為目前交易日的緊接前一適用交易日、交易所與商品身分、Asia/Taipei、來源／版本、原始單位、canonical `common_lot` 單位、OHLC／Volume／Amount 等長結構、09:01–13:30 minute coverage、嚴格遞增分鐘、無重複／跨日／負量／倒退／盤外異常、可信 regular-session 收盤總量，以及相同來源版本兩次獨立 fetch 的 canonical 內容與 payload hash 完全一致。任一未知、缺漏或衝突 MUST 只拒絕該商品，且不得因部分商品成功而宣稱 cohort baseline 完整。

缺少成交的分鐘 MUST NOT 直接補 0。只有其餘非負分鐘量已與可信 regular-session 收盤總量完全對帳、商品狀態可證實，因而能證明缺口只能為零成交，且具有可驗證的前一個 close 時，才 MAY 建立 `known_zero` 與 `carry_forward`。合法 13:33 延後撮合 MUST 只併入 canonical 13:30，MUST NOT 建立 13:31、13:32、13:33 regular-minute rows；未知收盤編碼、13:29 前置連續性不足或 cumulative volume 倒退 MUST fail closed。

全部通過後，系統 MUST 重建 09:01–13:30 共 270 筆 canonical cumulative-volume series，並保存 immutable baseline manifest，至少包含 symbol、trade date、target trade date、source／source version、兩次 fetch time、minute coverage、final-volume reconciliation、close mode、兩次 payload hash、verifier version、cohort hash 與 `provenance=historical_baseline_verified`。repository 寫入 MUST 使用 monotonic revision、immutable manifest 與 conflict detection；同一來源版本、商品與日期出現不同內容或 payload hash 時 MUST 拒絕覆寫。

升格成功 MUST 只設定 `baselineUsable=true`，並固定 `liveCaptureAcceptance=false`、`notificationEligible=false`、`retroactiveTriggerEligible=false`。既有 `live_full_session_verified` baseline MUST 具有較高優先序，歷史流程不得覆寫或降級；資料也 MUST NOT 產生前一交易日或目前交易日的 retroactive live／historical trigger、聲音或系統通知。

#### Scenario: 正常歷史基準完整通過

- **WHEN** 前一適用交易日的某商品兩次歷史 1 分 K 抓取內容相同，270 分鐘結構、收盤總量、單位與收盤模式全部通過
- **THEN** 系統 MUST 保存 `historical_baseline_verified` immutable manifest 與 cumulative series
- **AND** 該商品 MUST 只取得下一適用交易日的 baseline authority

#### Scenario: 正常歷史基準重抓不穩定

- **WHEN** 相同來源版本、商品與日期的兩次 canonical payload 或 hash 不一致
- **THEN** 系統 MUST 維持 `historical_unverified`／`waiting_baseline`，且不得覆寫任何既有 manifest

#### Scenario: 正常歷史基準缺分鐘且無零成交證據

- **WHEN** 歷史資料缺少預期 minute，且無法由可信收盤總量與商品狀態證明缺口為零成交
- **THEN** 系統 MUST NOT 補 0、carry-forward 或建立 baseline

#### Scenario: 正常歷史基準的合法 known-zero

- **WHEN** 其餘非負分鐘量總和已等於可信收盤總量、商品狀態合法，且缺口有可驗證前一 close
- **THEN** 系統 MAY 建立 `known_zero`／`carry_forward`，並 MUST 在 baseline manifest 明列證據

#### Scenario: 正常歷史基準處理延後收盤

- **WHEN** 分鐘連續至 13:29 且合法 13:33 延後撮合資料可驗證
- **THEN** 系統 MUST 將延後撮合量併入 canonical 13:30、記錄 `closeMode=delayed_13_33`，且不得建立 13:31–13:33 rows

#### Scenario: 不是緊接的前一交易日

- **WHEN** 候選歷史日期不是交易日 authority 判定的緊接前一適用交易日
- **THEN** 系統 MUST 拒絕升格，不得以任意較舊完整資料替代

#### Scenario: 已有完整 live baseline

- **WHEN** 同商品與日期已有 `live_full_session_verified` baseline
- **THEN** resolver MUST 使用 live baseline，不得以正常歷史基準覆寫、降級或改變 acceptance 語意

#### Scenario: 正常歷史基準不產生通知

- **WHEN** 歷史資料成功升格供目前交易日比較
- **THEN** 因升格動作新增的 retroactive trigger、聲音與系統通知數 MUST 全部為 0

### Requirement: 收盤後驗證式歷史 1 分 K 回補必須逐商品 fail closed

盤中串流中斷時，系統 MUST 立即將受影響商品標為 partial／degraded，暫停該商品的新量比判定與通知，並保存已收到的 live minute、中斷起訖、stream generation、sequence、cohort hash、source version、payload hash 與中斷原因。最早在該交易日 13:34:30（Asia/Taipei）完成收盤定稿後，系統才 MAY 對指定交易日取得一次性、有界的歷史 1 分 K；盤中、未定稿、週期 polling 或無界 retry MUST 被拒絕。

每個商品 MUST 獨立驗證官方交易日、交易所、商品身分、日期、Asia/Taipei、來源／版本、原始單位、canonical `common_lot` 單位、OHLC／Volume／Amount 等長結構、嚴格遞增分鐘、重複／跨日／負量／倒退／盤外資料、所有 live 重疊分鐘、可信 regular-session 收盤總量，以及相同來源版本重抓後的內容與 payload hash。重疊分鐘的 volume MUST 精確一致；其他雙方皆提供的 OHLC／Amount 欄位亦 MUST 一致。任一未知、缺漏或衝突 MUST 只拒絕該商品，不得因部分商品成功而宣稱整批成功。

缺少成交的分鐘 MUST NOT 直接補 0。只有其餘非負分鐘量已與可信收盤總量完全對帳、商品狀態可證實且缺口因此只能為零成交時，才 MAY 建立 `known_zero`，並使用可驗證的前一個 close 建立 `carry_forward` OHLC。合法 13:33 延後撮合 MUST 只併入 canonical 13:30；MUST NOT 建立 13:31、13:32、13:33 regular-minute rows。未知收盤編碼、13:29 前置連續性不足或 cumulative volume 倒退 MUST fail closed。

全數通過後，系統 MUST 重建 09:01–13:30 共 270 筆 canonical cumulative-volume series，並保存 immutable repair manifest，至少包含 symbol、trade date、source／source version、fetch time、repaired gap、live overlap 結果、minute coverage、final-volume reconciliation、close mode、payload hash、verifier version 與 `provenance=historical_repaired_verified`。repository 寫入 MUST 使用 monotonic revision、immutable manifest 與 conflict detection。同一來源版本、商品與日期出現不同內容或 payload hash 時 MUST 拒絕覆寫。

修復成功 MUST 只設定 `baselineUsable=true`，並固定 `liveCaptureAcceptance=false`、`notificationEligible=false`、`retroactiveTriggerEligible=false`。升格資料只能供下一個適用交易日比較；MUST NOT 回頭補發中斷當天的聲音、系統通知或即時／歷史 trigger，也 MUST NOT 取代原本要求的完整 live capture 驗收日。正常 `live_full_session_verified` baseline 流程 MUST 保持原語意與較高優先序。

#### Scenario: 完整回補通過全部驗證

- **WHEN** 某商品歷史 1 分 K 的完整結構、live 重疊、收盤總量、收盤模式與相同來源版本重抓 hash 全部一致
- **THEN** 該商品 MUST 保存 `historical_repaired_verified` immutable manifest 與 270 筆 cumulative series
- **AND** MUST 設定 `baselineUsable=true`、`liveCaptureAcceptance=false` 且通知／retroactive trigger authority 為 false

#### Scenario: live 與歷史重疊分鐘衝突

- **WHEN** 任一重疊 minute 的成交量不一致，或雙方皆提供的 OHLC／Amount 不一致
- **THEN** 該商品 MUST 拒絕升格並保留 partial／degraded，其他商品 MUST 獨立處理

#### Scenario: 缺分鐘且沒有零成交證據

- **WHEN** 歷史資料缺少預期 regular-session minute，且無法由可信收盤總量與商品狀態證明缺口為零成交
- **THEN** 系統 MUST NOT 補 0、carry-forward 或建立 baseline

#### Scenario: 缺分鐘可由全天量證明為零成交

- **WHEN** 其餘非負分鐘量總和已等於可信 regular-session 收盤總量、商品狀態合法，且缺口有可驗證前一 close
- **THEN** 系統 MAY 以 `known_zero`／`carry_forward` 建立該 minute，並在 manifest 明列修復缺口與證據

#### Scenario: 合法 13:33 延後收盤回補

- **WHEN** 分鐘連續至 13:29 且合法 13:33 延後撮合資料可驗證，來源可能有或沒有 13:30 row
- **THEN** 系統 MUST 將延後撮合量併入 canonical 13:30 並記錄 `closeMode=delayed_13_33`
- **AND** MUST NOT 建立 13:31–13:33 regular-minute rows

#### Scenario: 延後收盤證據不完整或量倒退

- **WHEN** 13:33 前置連續性不足、收盤編碼未知或 cumulative volume 倒退
- **THEN** 該商品 MUST 拒絕升格並維持 degraded

#### Scenario: 重抓 payload 不穩定

- **WHEN** 相同來源版本、商品與日期重抓後的內容或 payload hash 不一致
- **THEN** 系統 MUST 拒絕升格，且 immutable repository MUST NOT 覆寫既有 manifest

#### Scenario: authority 或單位不明

- **WHEN** 來源版本、原始單位、canonical 單位、官方交易日、交易所、商品身分或商品狀態任一不明
- **THEN** 該商品 MUST 拒絕升格並回傳安全 reason code

#### Scenario: 回補不產生中斷當天通知

- **WHEN** partial 商品在收盤後成功升格為下一交易日可用 baseline
- **THEN** 中斷當天的聲音、系統通知、live trigger 與 historical trigger 新增數 MUST 全部為 0

#### Scenario: 正常完整 live baseline 不受影響

- **WHEN** 同一商品已有 `live_full_session_verified` 完整 baseline
- **THEN** baseline resolver MUST 保留 live baseline 與其既有 acceptance 語意，不得以歷史回補覆寫或降級

### Requirement: 同分鐘量比必須以精確門檻判定

系統 MUST 只比較今日與上一個適用交易日的同一 completed-minute key，並以 `today_cumulative >= threshold × previous_cumulative` 且 `previous_cumulative > 0` 判定。運算 MUST 使用 canonical 非負整數量及 decimal 門檻，不得先四捨五入 ratio；UI 顯示值可格式化，但 evidence MUST 保留未四捨五入輸入與公式版本。

只有今日 minute、上一日 baseline、calendar、session、unit、generation 與完整度均合法時，判定 MAY 為 matched 或 not matched；其他情況 MUST 為 unknown 並提供 reason code。`matched + notMatched + unknown` MUST 等於當期 admitted 商品數。

#### Scenario: 精確達到 1.5 倍

- **WHEN** 今日完成分鐘累積量為 1,500 張、上一交易日同分鐘為 1,000 張且門檻為 1.5
- **THEN** 結果 MUST 為 matched，evidence MUST 保存兩個交易日、minute key、兩側原始量、門檻及公式版本

#### Scenario: 顯示四捨五入但實際未達標

- **WHEN** 格式化 ratio 顯示為 1.50，但精確不等式仍小於 1.5 倍
- **THEN** 結果 MUST 為 not matched，不得依顯示字串觸發

#### Scenario: 完整度不足

- **WHEN** 今日或基準 minute 的 unit、session 或 continuity 任一項未知
- **THEN** 該商品 MUST 計入 unknown，新增 trigger 與通知數 MUST 為 0

### Requirement: 觸發事件必須可重播且同日去重

商品第一次從未達標跨越其有效門檻時，runtime MUST 建立 immutable trigger event，內容至少包含 trade date、symbol、exchange、minute key、設定 revision、threshold、今日與基準累積量、來源／公式版本、完整度、event id 與 evidence hash。結果在該交易日 MUST 保持可查，即使後續 ratio 下降；下一個交易日 MUST 建立新的日界線，不得沿用前日 latch。

同一 `trade date + symbol + threshold config revision` MUST 最多建立一筆 live notification event。設定修改後若商品在第一個新 revision observation 已高於門檻，系統 MUST 標示為依新設定符合或歷史符合，不得把設定動作偽裝成新的 live cross。重播、重連與重新整理 MUST 產生相同 event id／hash，不得補發聲音或系統通知。

#### Scenario: 量比先達標後回落

- **WHEN** 商品於 10:00 首次達到 2 倍並在 10:30 回落至 1.8 倍
- **THEN** 10:00 trigger MUST 留在當日結果並更新目前 ratio 狀態，MUST NOT 刪除或重建事件

#### Scenario: SSE 重連重播既有事件

- **WHEN** 分頁斷線後以 cursor 重新取得同一 trigger event
- **THEN** UI MAY 恢復結果，但 runtime 與 client MUST NOT 再播放聲音或建立第二筆系統通知

#### Scenario: 交易日切換

- **WHEN** calendar authority 推進至下一個合法交易日且新 session ready
- **THEN** 前一日結果 MUST 轉為歷史，新的 latch namespace MUST 從空集合開始
- **AND** 系統 MUST NOT 在 calendar／session 尚未 ready 時提前清空或推進

### Requirement: 晚開頁與中斷恢復不得偽造歷史觸發

頁面在盤中較晚取得 lease 時，runtime 只有在已驗證來源提供今日 completed-minute 序列及上一日相同 minute baseline 時，才 MAY 逐分鐘重播並建立標示為 `historical_trigger` 的事件；historical trigger MUST NOT 發出聲音或系統通知。若今日較早分鐘無法完整回補，系統 MUST 明示監控自哪一個 completed minute 起有效，且不得聲稱開頁前未曾達標。

連線中斷期間 MUST 暫停 affected 商品的新判定。恢復後只有在 generation、sequence、current cumulative、缺口與 baseline 均重新驗證時才可繼續；無法修復的 gap MUST 維持 `degraded`。

#### Scenario: 10:30 開頁且今日分鐘可完整重播

- **WHEN** runtime 在 10:30 取得有效 lease，並驗證今日及上一日 09:00 至 10:29 的完整 minute series
- **THEN** 系統 MUST 可重播並列出最早達標 minute，事件 MUST 標示 historical 且通知數為 0

#### Scenario: 10:30 開頁但今日較早分鐘不可得

- **WHEN** runtime 只能從 10:30 後取得可信 observation
- **THEN** UI MUST 顯示監控有效起點及較早分鐘未回補，且系統 MUST NOT 產生或否認任何開頁前 trigger

#### Scenario: 中斷期間資料有缺口

- **WHEN** stream 重連後無法證實缺口期間的累積量與 sequence 連續性
- **THEN** 商品 MUST 顯示 `degraded`，缺口涵蓋的 completed minute MUST 為 unknown，且不得新增 trigger

### Requirement: 監控 API 與證據必須限定本機且沒有交易權限

設定、lease、status、capacity、results、event stream 與 diagnostics API MUST 只在固定 loopback／same-origin allowlist 提供，並使用版本化 response、固定 schema、bounded page／payload、generation、revision、cursor 及安全 reason code。GET status／results MUST NOT 觸發 provider request、subscription、DDL、runtime 啟停或 broker write；mutation 僅可修改監控設定與 lease，不得攜帶或產生委託、帳務、持倉或策略 authority。

驗收 evidence MUST 保存非敏感的設定版本、calendar／session／source／formula 版本、configured／eligible／cohort／data-active／waiting／unknown 數量、bounded transport、minute completeness、trigger hash、重播結果及資源量測。provider physical usage 與 headroom MUST 明示 unknown。MUST NOT 保存帳號、token、憑證或完整敏感 runtime payload。

#### Scenario: hosted target 請求監控 API

- **WHEN** Cloudflare、Sites 或非 allowlist host 嘗試呼叫盤中監控路由
- **THEN** 路由 MUST 保持停用或拒絕，不得建立 lease、讀取本機 evidence 或新增 subscription

#### Scenario: 查詢當日結果

- **WHEN** 合法本機分頁以 GET 讀取當日 results
- **THEN** API MUST 只讀取已保存的同一 generation／cursor 結果，MUST NOT 因查詢而抓取資料或啟動服務

#### Scenario: 嘗試注入交易欄位

- **WHEN** mutation payload 含 order、account、quantity、price、strategy 或其他非 schema 欄位
- **THEN** API MUST 拒絕整筆請求，且 broker write attempt MUST 為 0

### Requirement: 完整日 capture 結果必須原子保存且失敗不得無限重啟

固定 20 檔完整日 capture MUST 能在明確有界的容量內 canonicalize 並雜湊 20 × 270 個 minute rows。主 evidence MUST 以 atomic exclusive create 建立，既有成功檔或失敗檔都不得被覆寫。若 transport、seal、evidence 組裝、hashing 或寫入任一階段失敗，系統 MUST 另存不含原始行情 payload 的 immutable failure sidecar，並固定標示 `baselineUsable=false`、`liveCaptureAcceptance=false`、通知與 retroactive trigger authority 為 false。

背景 capture MUST 使用明確 one-shot lifecycle；`KeepAlive` MUST 為 false。成功或失敗後不得自動重建第二個 capture、第二個 login 或重複 subscription。錯過 09:00:30 後的啟動 MUST fail closed，且不得以 launchd 重試掩蓋原始失敗。

#### Scenario: 20 檔完整 evidence 大於通用 JSON 上限

- **WHEN** 20 檔各有 270 個合法 completed minute，完整 evidence 超過共用 canonical JSON 預設容量但仍在 KBar capture 專用上限內
- **THEN** 系統 MUST 產生穩定 evidence hash 並原子建立主 evidence，不得因共用預設值遺失整日結果

#### Scenario: evidence 最終化失敗

- **WHEN** session 已停止但 evidence 組裝、hashing 或主檔寫入失敗
- **THEN** 主 evidence MUST 保持不存在或保留原既有版本，並建立不可覆寫的 failure sidecar
- **AND** failure sidecar MUST 明示當日不能成為 baseline 或 live acceptance，且不得包含完整原始 SSE payload

#### Scenario: 背景 capture 結束

- **WHEN** one-shot capture 成功、拒絕或失敗退出
- **THEN** scheduler MUST NOT 因 keepalive 自動再次啟動 capture，亦不得在開盤窗口後重複 subscribe

### Requirement: 20 檔試辦必須以完整日與退化護欄驗收

實作 MUST 先完成 bounded KBar Gate，再以固定 20 檔 cohort 執行 feature-off、通知關閉的 shadow recording、離線重播及 simulation dry run。功能驗收 MUST 具有一份緊接前一適用交易日、涵蓋相同 20 檔且來源為 `live_full_session_verified` 或 `historical_baseline_verified` 的可信 baseline，以及一個完整盤中驗收日；不得要求兩個完整 live capture 日才允許功能核准。第二個完整盤中日 SHOULD 作為非阻擋的穩定性追蹤。50／100／160 active 擴量不屬本 change，MUST NOT 由本案自動開始。

試辦 MUST 驗證 20 檔 sealed minute 累積量及量比可由保存 evidence 重算、trigger event 可重播、baseline／minute completeness 守恆、重複通知為 0、不完整資料誤報為 0，且既有 K 線、watchlist、alert、smart order 與 simulation runtime 沒有新增退化。provider physical usage 與 headroom MUST 保持 unknown。任一商品缺棒、既有行情退化、資料不完整卻觸發、重複事件或資源超過核定門檻 MUST 停止試辦並保持 feature-off。

完整盤中驗收日 MUST 同時具有相同交易日且各自通過 validator 的完整 KBar capture、被動 K 線新鮮度 evidence 與 runtime assurance；assurance MUST 引用官方緊接前一交易日及其 baseline hash。被動 K 線 evidence MUST 在盤中由已存在且穩定的頁面完成至少兩次唯讀 DOM 觀測，證明 visual commit 推進及 canvas 可見；觀測與 evidence 建立 MUST 為零 navigation、零 reload、零 click、零額外網路請求、零 subscription mutation、零通知、零 broker write、零 production transition 及零 service lifecycle mutation。系統 MUST 使用專用 builder 驗證同日、同商品、同週期、觀測先後、geometry、operation ledger 與 canonical hash，並以 immutable exclusive create 保存。

每日完整性守門器 MUST 在 10:00（Asia/Taipei）後缺少被動 K 線 evidence 時產生可行動告警；最早 13:34:30 收盤定稿後，若 capture outcome、被動 K 線 evidence 或 runtime assurance 任一缺失、無效、交易日不一致或 assurance 的 `previousTradeDate` 不符官方前一交易日，當日 MUST 固定為 `readyForDailyBundle=false`。完整 capture MAY 仍依自身規則成為下一日 baseline，但 MUST NOT 因 capture-only 成功而被列為三件式完整驗收日，且不得事後補造盤中 UI evidence。

#### Scenario: 20 檔單一完整盤中日功能護欄通過

- **WHEN** 固定 20 檔具有緊接前一適用交易日的可信 baseline，並完成一個三件式完整盤中驗收日，且所有跨日量比、重播、資源與既有功能護欄均通過
- **THEN** 經人工審閱 MAY 核准本機 20 檔試辦版
- **AND** MUST NOT 宣告 50、100、160 或 200 檔可同時監控；擴量必須另開 change

#### Scenario: 第二個完整盤中日尚未完成

- **WHEN** 一日功能護欄已通過，但第二個完整盤中穩定性追蹤日尚未完成，且沒有已知退化
- **THEN** 系統 MUST NOT 只因缺少第二日而阻擋功能人工審閱、核准或歸檔
- **AND** 後續追蹤若發現退化，MUST 重新開啟相應風險與修正工作

#### Scenario: 任一商品資料不完整

- **WHEN** 任一 trigger 使用 incomplete、stale、錯誤日期、錯誤單位、零分母或未 seal 的 KBar
- **THEN** 試辦 MUST 立即停止新增判定、feature MUST 維持通知關閉，並保存可重播 evidence 供修正

#### Scenario: capture 成功但同日 companion evidence 缺漏

- **WHEN** 20 檔完整 KBar capture 通過，但收盤後缺少同日被動 K 線 evidence 或 runtime assurance
- **THEN** capture MAY 依自身驗證結果供下一交易日作 baseline，但該日 MUST 為 `readyForDailyBundle=false`
- **AND** 系統 MUST 保存缺件原因、不得事後補造盤中觀測，也不得將該日冒充完整盤中驗收日

#### Scenario: 盤中提早發現被動 evidence 尚未建立

- **WHEN** 候選驗收日已到 10:00 且同日被動 K 線 evidence 尚未建立
- **THEN** 排程 MUST 立即標示 `passive_chart_evidence_overdue` 並在仍可合法觀測的盤中時段處理
- **AND** MUST NOT 重載頁面、另開交易頁、送出 subscription mutation 或干擾既有 KBar capture
