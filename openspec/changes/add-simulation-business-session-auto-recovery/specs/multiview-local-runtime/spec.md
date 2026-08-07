## ADDED Requirements

### Requirement: MultiView 必須在 simulation session 恢復後重新協調目前 demand
每份 MultiView document MUST 維持至多一條 Shioaji SSE，並 MUST 在 SSE open、週期 mode check、visibility 恢復與 browser online 時，比對目前 `desired` demand 與已完成 Snapshot／Kbars bootstrap 的 `active` subscription。對缺少的 demand，系統 MUST 執行 per-symbol single-flight、有界退避的重新訂閱；只有合法 business response 完成後才能將商品標為 active 或恢復 Shioaji 即時狀態。

#### Scenario: API 重啟後 SSE 早於 business session 恢復
- **WHEN** simulation API 重啟、SSE 已重新 open，但缺少商品的 subscribe、Snapshot 或 Kbars 仍回傳 `SessionNotEstablished`
- **THEN** MultiView 保留該商品為非 active 並依有界退避補訂閱，不得因 SSE open 宣稱即時行情已恢復

#### Scenario: 缺少 demand 後續恢復成功
- **WHEN** 目前仍可見商品的補訂閱與必要 Snapshot／Kbars bootstrap 成功
- **THEN** MultiView 將該商品加入 active set，套用合法來源時間的 Shioaji snapshot，並自動恢復即時狀態

#### Scenario: 補訂閱持續失敗
- **WHEN** business session 尚未恢復或 provider 持續拒絕 subscribe／Snapshot／Kbars
- **THEN** 自動來源模式維持 Yahoo 完整 snapshot 延遲備援，明確 Shioaji-only 模式維持不可用提示
- **AND** coordinator 不得建立第二條 SSE、重複同商品的 in-flight request 或無界重試

#### Scenario: 多 panel 使用相同商品
- **WHEN** 多個 panel 在 API 恢復期間要求相同 canonical 商品
- **THEN** coordinator 只建立一個該商品的補訂閱流程，成功後由相同 active subscription 服務所有 demand

### Requirement: Watchdog 重啟不得破壞 MultiView 非即時能力與本機資料
simulation API watchdog 重啟期間，5174 process、既有歷史、國外商品、Yahoo 延遲來源、盤後資料與 D1 MUST 維持可用且不得被 runtime 重設。recovery 流程 MUST 延續既有 data-only allowlist，不得新增 order、account、CA、token 或 server-management proxy。

#### Scenario: Watchdog 重啟 8080
- **WHEN** runtime 因符合門檻的 `SessionNotEstablished` recovery incident 重啟 simulation API
- **THEN** 5174 listener、D1 integrity／coverage、個人清單與盤後 pipeline 狀態保持不變
- **AND** 台股即時來源在中斷期間顯示延遲備援或不可用，不阻斷其他資料功能

#### Scenario: Session 恢復後重新啟用即時來源
- **WHEN** 8080 business probe 與目前 demand 的 Snapshot／Kbars bootstrap 均恢復成功
- **THEN** MultiView 自動恢復 Shioaji data-only 行情，且不得呼叫任何交易、帳務、CA 或 server-management 路徑
