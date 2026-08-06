## ADDED Requirements

### Requirement: 休市顯示不得降級最近交易日核對結果

系統 MUST 將目前市場是否休市與最近交易日報價的 verification 分開處理。台股週末或可由既有市場 metadata 證明的休市日，價格列 MUST 顯示「休市」；若最近一個 `sessionDate` 已通過官方核對，系統 MUST 保留該 verification，且 MUST NOT 只因台北日期跨日或市場未開盤而改成 `unverified` 或顯示「未驗證」。真正的 stale cache 或 verifier 失敗仍 MUST 依既有優先順序顯示。

#### Scenario: 星期六顯示前一交易日已核對收盤
- **WHEN** 台北時間為星期六，台股最近一個 `sessionDate` 是星期五且 verification 已完成
- **THEN** 價格列 MUST 顯示星期五來源時間與「休市」
- **AND** verification metadata MUST 保留星期五的成功結果
- **AND** 可見文案 MUST NOT 顯示「未驗證」

#### Scenario: 星期日顯示休市
- **WHEN** 台北時間為星期日且最近報價仍是上一個有效交易日
- **THEN** 價格列 MUST 顯示「休市」
- **AND** 系統 MUST NOT 因報價日期不是台北當日而重新啟動或降級收盤核對

#### Scenario: 休市時仍優先顯示真正過期資料
- **WHEN** 市場休市且目前只能取得已超過既有 freshness 門檻的 stale cache
- **THEN** 系統 MUST 保留「資料過期」等既有警示
- **AND** tooltip 或狀態 metadata MUST 仍可辨識目前為休市
