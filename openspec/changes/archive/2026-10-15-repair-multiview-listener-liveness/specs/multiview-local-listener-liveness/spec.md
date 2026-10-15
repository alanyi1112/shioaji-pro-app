## ADDED Requirements

### Requirement: 僅對持續失去自身 listener 的 MultiView 有界復原

系統 MUST 在本機 MultiView 真正開始監聽後，對持續 60 秒失去自身 HTTP listener 的失效程序退出非零狀態，交由原 launchd KeepAlive 復原；MUST NOT 因資料 partial、單一查詢逾時、初始啟動、短暫正常重載或正常關閉而錯誤退出。

#### Scenario: 程序存活但 listener 已持續關閉
- **WHEN** 已成功監聽的 5174 程序仍在且連續 60 秒沒有 listener
- **THEN** 防護只結束該失效程序，不新增排程，不重啟 8080、5173、watchdog 或盤前／盤後程序

#### Scenario: 重載恢復或初始啟動
- **WHEN** listener 尚未開始，或正常重載後在寬限內重新監聽
- **THEN** 防護不觸發失效退出，且重載前舊觀測不得誤判新 server

#### Scenario: 正常停止與純本機觀測
- **WHEN** 程序收到正常終止訊號或執行 listener 健康取樣
- **THEN** 正常終止取消觀測，取樣不建立 HTTP、SSE、券商登入／訂閱或任何交易請求

### Requirement: 選股服務復原必須以真正查詢與保護錨點驗證

修復 MUST 驗證正式 5174 health 及經 5173 的合法選股查詢，而非只憑 PID 或狀態 HTTP 200 宣稱完整；MUST 保留資料 partial、原失敗與未確認觸發者，並核其他服務與明日動態名單排程不變。

#### Scenario: 資料服務斷線造成選股代理失敗
- **WHEN** 原選股代理因 5174 不可連線回傳 `local_data_service_unavailable`
- **THEN** 復原後以合法條件取得真正日期與結果，不能以舊快照或改日期代替；其他服務 PID／generation 與 plist hash 維持原錨點
