## ADDED Requirements

### Requirement: TDCC 最新快照必須依發布週次判斷新鮮度

系統 MUST 依 `Asia/Taipei` 的 TDCC 每週發布窗口計算目前最低可接受資料週；當 requested range 包含該週時，cache state 的 `source_date` MUST 位於該週或更晚，只有最近成功時間不得視為已覆蓋。判定 MUST 接受同一週內因休市產生的合法最後營業日，不得硬寫成固定星期五日期。

#### Scenario: 發布窗口前官方仍是前一期
- **WHEN** 本週資料尚未進入預定發布窗口，官方最新 `dataDate` 仍在前一資料週
- **THEN** 系統 MUST 接受前一資料週為目前最新可用資料
- **AND** MUST NOT 因尚未發布而清除既有分布資料

#### Scenario: 發布窗口後 cache 仍是前一期
- **WHEN** 已進入新資料週的發布窗口後，cache `source_date` 仍早於該週星期一
- **THEN** 系統 MUST 將 cache 視為 stale 並嘗試 latest refresh
- **AND** `last_success_at` 尚未超過 8 天 MUST NOT 阻止此次 refresh

#### Scenario: 新商品只有一週舊資料
- **WHEN** 新加入商品的 target 已保存一筆舊週快照，但最新已發布週與最低歷史 coverage 尚未完成
- **THEN** target MUST 保持 `queued` 或 `partial` 並可由後續排程 claim
- **AND** 舊快照 MUST NOT 讓 latest 或 history 工作提前標示完成

### Requirement: 本機 TDCC 排程必須涵蓋主同步與隔日重試

本機 runtime 的 durable scheduler MUST 在 TDCC 發布窗口後執行每週主要同步，並 MUST 於下一日提供一次有限重試；兩次執行 MUST 使用相同受保護的 `tdcc-weekly` pipeline 與 durable queue。

#### Scenario: 主要同步時官方尚未更新
- **WHEN** 週六主要同步只取得前一期 `dataDate` 或遇到可重試上游錯誤
- **THEN** 系統 MUST 保留既有 rows 與 queued targets
- **AND** 週日重試 MUST 再次檢查 latest 並接續未完成 queue
