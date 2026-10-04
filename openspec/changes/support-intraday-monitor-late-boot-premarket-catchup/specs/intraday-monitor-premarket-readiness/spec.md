## ADDED Requirements

### Requirement: 晚開機必須有獨立且有界的盤前接續入口

系統 MUST 透過本機 durable 啟動機制，在登入後檢查是否漏掉當日固定盤前節點；只有 `Asia/Taipei` 08:20:00–08:58:59 且官方雙市場本機日曆確認適用交易日，才可嘗試接續。入口 MUST 使用獨立的 claim、receipt 與實際時間，不得補造、覆寫或冒稱 08:20／08:35／08:45／08:50 原排程成功。服務尚未就緒時只可有界唯讀重查至 08:59:00；不得以 Codex heartbeat 作為必要啟動條件。

#### Scenario: 08:55 開機且 08:20 根本未執行
- **WHEN** 使用者在 08:55 登入，當日沒有 08:20 claim／receipt，且本機日曆、前日 160 檔基準、cohort、approval、config revision、simulation business session 與完整安全 Gate 均有效
- **THEN** 系統 MUST 能以獨立晚開機 claim 建立唯一今日 session，並標示 `scheduled0820Success=false` 與實際建立時間
- **AND** 系統 MUST NOT 建立虛構的 08:20 排程收據或把缺席記為成功

#### Scenario: 開盤前服務延遲就緒
- **WHEN** 使用者於有效窗口登入，但 API、Web 或 MultiView 尚未就緒
- **THEN** 系統 MAY 在同一啟動進程內做有界唯讀重查
- **AND** 若至 08:59:00 仍未通過完整 Gate，MUST 保存失敗證據並停止，不得自行登入或重啟既有服務

#### Scenario: 過晚登入、休市或缺少正式基準
- **WHEN** 登入時已達 08:59:00、不是官方預排交易日，或前一交易日正式基準缺失／不完整
- **THEN** 系統 MUST 不建立 session、capture 或通知權限，並以可辨識原因回報
- **AND** MUST NOT 使用圖表快取、猜測的交易日或未驗證的分鐘量替代

### Requirement: 晚開機採集必須維持單次啟動與真實來源語意

若晚開機接續發生於 08:50:00–08:58:59，系統 MUST 在再次驗證完整 Gate、當日 session identity、generation 與今日零採集／訂閱／觀測／觸發後，才可與固定 08:50 入口競爭同一個每日獨占 capture-start claim。採集器 MUST 驗證晚開機 generation anchor 所引用的同日不可覆寫準備收據；任何重複、時間逾限、identity 不一致或資料活動未知 MUST fail closed。晚開機啟動 MAY 取得今日觀測權限，但 MUST NOT 充當 08:50 準時啟動或完整暖機驗收證據。

#### Scenario: 08:50 已錯過而 08:56 條件完整
- **WHEN** 08:56 的晚開機入口證明固定 08:50 未啟動、今日沒有任何 control-plane／data-plane 活動，且所有安全 Gate 與不可變 identity 均一致
- **THEN** 系統 MAY 以獨立收據與每日獨占 claim 啟動既有單條 capture
- **AND** 收據 MUST 明示晚開機時間、原排程缺席及 cold-start risk

#### Scenario: 固定排程已先啟動或競態發生
- **WHEN** 08:50 固定入口或另一個晚開機入口已取得每日 capture-start claim，或既有 run registry 顯示已啟動
- **THEN** 後來的入口 MUST 不建立第二條 SSE、第二次訂閱或另一個 session
- **AND** MUST 保留原始 claim 與結果，不能刪鎖重試
