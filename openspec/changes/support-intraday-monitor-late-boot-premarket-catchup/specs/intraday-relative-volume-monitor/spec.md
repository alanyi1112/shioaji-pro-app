## ADDED Requirements

### Requirement: 晚開機接續不得冒充完整日監控

系統 MUST 將晚開機 session 與 capture 的實際建立時間、原排程缺席、cold-start risk、首筆合法 KBar、canary 與 freshness 分開呈現。沒有完整 current-session identity、合法同日資料與前日基準時，data active、結果及通知權限 MUST 維持關閉。晚開機入口即使在開盤前啟動，也 MUST NOT 回填 08:20／08:50 準時排程成功或完整日 Stage 160 live acceptance。

#### Scenario: 晚開機已訂閱但尚無今日 KBar
- **WHEN** 晚開機入口已送出同一 cohort 的訂閱，但尚未收到有效交易日與 generation 的首筆 KBar
- **THEN** 系統 MUST 顯示 control-plane 已提出但 `dataActive=0`，不得稱為今日監控資料已運作

#### Scenario: 09:01 canary 缺失
- **WHEN** 晚開機入口在 08:56 啟動，但 09:02:15 前缺少任一檔 09:01 合法 KBar
- **THEN** 系統 MUST 保存 canary 失敗與 partial／degraded 證據，不得將有界 REST 補抓改寫成完整日 live 驗收成功
