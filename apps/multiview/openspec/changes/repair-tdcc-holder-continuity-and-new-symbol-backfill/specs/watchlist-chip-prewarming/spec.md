## ADDED Requirements

### Requirement: 新商品籌碼預熱必須揭示各資料路徑的交接結果

合格台股商品保存成功後，系統 MUST 分開追蹤日籌碼預熱與 TDCC 歷史回補的 target、queue、handoff 及完成狀態；任一路徑成功 MUST NOT 掩蓋另一條路徑尚未接手、coverage 不足或失敗。互動式保存 MUST 維持快速回應，但背景工作結果 MUST 可由逐 symbol API 與安全 health 查證。

#### Scenario: 日籌碼完成但 TDCC 只有最新一週
- **WHEN** 新商品的法人、外資持股、融資券與借券已預熱，但 TDCC 只有最新一筆分布資料
- **THEN** 日籌碼 MAY 顯示 ready，TDCC MUST 保持 queued／partial 並顯示其 handoff 狀態
- **AND** 系統 MUST NOT 將整體商品或持股副圖標示為歷史完整

#### Scenario: 保存後背景生命週期提前結束
- **WHEN** 商品保存 response 已成功，但 request background lifetime 在 target、queue 或 dispatch 全部完成前終止
- **THEN** durable discovery／watcher MUST 依使用者已啟用商品重新建立缺少的 TDCC target 或 queue
- **AND** 不得要求使用者移除重加、重新部署或開啟持股副圖才能恢復

#### Scenario: 新商品 handoff 超過門檻
- **WHEN** target 已 queued 超過 deployment 規定的接手門檻且沒有新鮮 run／lease
- **THEN** health MUST 將該 symbol 計入 handoff overdue 或同等 degraded 計數
- **AND** 必須保留 queued-since、最後 dispatch 結果與安全 reason，不能只顯示全域 scheduler healthy

#### Scenario: 相同商品由多個清單加入
- **WHEN** 同一 canonical symbol 已有 target／queue，之後由另一頁籤或使用者再次加入
- **THEN** 系統 MUST 共用相同市場資料、日期計畫與 single-flight handoff
- **AND** MUST NOT 建立依使用者身分分裂的 TDCC 歷史副本或重複 runner
