## ADDED Requirements

### Requirement: MultiView 啟動入口必須在目標服務未啟動時仍可診斷
RealTimeStock MUST 以不依賴 5174 process 的 loopback launcher 開啟 MultiView，並在導向 5174 前以有界 timeout 判斷本機服務狀態。launcher MUST 不修改目前 workspace，且 MUST 對服務未啟動、Shioaji business session 離線、使用延遲 fallback、盤後資料異常與正常可用提供可見狀態及精確重試指引。

#### Scenario: 5174 未啟動
- **WHEN** 使用者從「版面」開啟 MultiView 且 5174 無法連線
- **THEN** 新分頁 MUST 留在 5173 launcher 並顯示 MultiView 未啟動、重試按鈕與本機 runtime 啟動指引
- **AND** 目前 RealTimeStock workspace MUST 保持不變

#### Scenario: MultiView 可用
- **WHEN** launcher 取得合法且顯示 simulation 的 5174 health
- **THEN** launcher MUST 導向既定 5174 MultiView URL

#### Scenario: Shioaji 離線但延遲來源可用
- **WHEN** 5174 正常但 Shioaji business request 失敗且 Yahoo 延遲來源可用
- **THEN** launcher 或 MultiView MUST 顯示行情為延遲 fallback、來源狀態與可重試操作
- **AND** 不得把 HTTP health 或 SSE heartbeat 冒充即時行情可用
