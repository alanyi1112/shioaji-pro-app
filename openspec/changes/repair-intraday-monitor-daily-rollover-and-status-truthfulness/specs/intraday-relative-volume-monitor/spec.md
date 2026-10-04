## ADDED Requirements

### Requirement: 即時比較必須綁定目前交易日 session identity

盤中監控 MUST 只有在 current session 的 authority trade date、session trade date、config revision、cohort hash、baseline hash、artifact bundle hash與 API generation 全部一致時，才能接受 observation、推進 completed minute、比較量比或產生 trigger。歷史 `complete_go`、過去交易日 subscription receipt、舊 config revision 或舊 generation MUST 只能作稽核資料，不能取得今日 data-plane、result 或 notification authority。

#### Scenario: 歷史 GO 存在但今天 session 未建立
- **WHEN** durable approval 顯示 Stage 160 `GO`，但今天沒有符合完整 identity 的 current session
- **THEN** `dataActive`、今日 subscription confirmation、今日 trigger 與 notification authority MUST 分別為 0、false、空集合與 false
- **AND** status MUST 回報 `current_session_missing`，不得把 approval decision 當作 live state

#### Scenario: Session trade date 與官方 authority 不同
- **WHEN** session 綁定過去交易日，但官方 authority 已推進至新的適用交易日
- **THEN** 系統 MUST 回報 `session_trade_date_stale`、停止新比較與觸發，並保留舊 session evidence 不變

#### Scenario: 盤中設定 revision 前進
- **WHEN** saved config revision 與已啟動 session 鎖定 revision 不同
- **THEN** 系統 MUST 顯示 `config_revision_mismatch` 並停止新觸發，不得把新增商品合併進固定 cohort或以第 161 檔後的商品補位

### Requirement: Status 計數必須區分 admission state 與資料完整度

每個 configured 商品 MUST 恰屬一個互斥 admission／runtime state，所有 state count 總和 MUST 等於 configured。系統 MUST 另行提供 baseline complete、missing、stale、unknown 與各 trade date 的資料完整度統計；`waitingBaseline=0` 只代表沒有商品位於該互斥 state，MUST NOT 被描述為所有 configured 商品都有當日可用 baseline。

#### Scenario: 40 檔受 active limit 阻擋且 11 檔沒有 subscription evidence
- **WHEN** configured 為 200、approved limit 為 160，其中 40 檔為 `waiting_pilot_limit`、11 檔為 degraded 且 baseline unknown
- **THEN** state counts MUST 明確列出 40 與 11，baseline summary MUST 另列至少 51 檔 unknown／missing
- **AND** UI／API MUST NOT 只以 `waitingBaseline=0` 宣稱 baseline 完整

### Requirement: Evidence freshness 必須 fail closed

Status MUST 保存並回傳 evidence trade date、observedAt、age、phase-specific freshness budget 與 `fresh` 判定。交易時段內若最新 product evidence 來自過去交易日、超過 freshness budget或無法驗證，整體狀態 MUST 為 idle／degraded 並帶 stale reason；不得以 Web heartbeat、頁面 lease、HTTP 200 或歷史 persisted rows 改判為即時監控中。

#### Scenario: 最新 evidence 停在六日前
- **WHEN** 今天為交易日且 business session available，但 product state 的 trade date 與 updatedAt 仍停在六日前
- **THEN** 系統 MUST 回報 `session_trade_date_stale` 與 `fresh=false`，今日 results MUST 為空或只可明確標記為歷史

#### Scenario: 收盤集合競價後有界封存最後一分鐘
- **WHEN** 正式擷取在當日收盤窗口內仍有新鮮 `running` authority、已接受訂閱與相同 session／generation，且須等到 13:34:30 才能核對一般 13:30 或暫緩 13:33 收盤 KBar
- **THEN** 系統 MUST 在盤中兩分鐘 freshness 失效前轉入有界 `closing` phase，保留最後真實 evidenceAt，不得把定時轉換當作新行情
- **AND** 後續合法 observation MUST 保持 `closing`；只有逐檔真實來源與連續性均通過才可封存 13:30，已 stale／身分不符／未訂閱時 MUST fail closed，不得補造零量 KBar
