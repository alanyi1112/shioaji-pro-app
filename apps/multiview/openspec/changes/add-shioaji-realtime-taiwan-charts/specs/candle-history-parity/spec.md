## ADDED Requirements

### Requirement: Realtime overlay 必須與 canonical candle history 分層

系統 MUST 將 Shioaji 盤中 overlay 視為可替換的 session state，而不是永久 candle history；歷史 API、快取與前端合併 MUST 以 `provider + symbol + interval + period key` 辨識並取代相同期間 provisional row。

#### Scenario: 日 K history 加上今日 overlay

- **WHEN** D1 或上游 history 已提供最近完成交易日且今日 Shioaji overlay 可用
- **THEN** response MUST 在尾端加入或取代一根今日 provisional K
- **AND** canonical history rows MUST 保持原本 provider 與時間

#### Scenario: 同期間已有 provisional row

- **WHEN** history 最後一根與 realtime overlay 對應相同日、週或月 period key
- **THEN** response MUST 以完整 realtime overlay 取代該 provisional row
- **AND** MUST NOT 產生兩根相同期間 K 或加總兩個 provider 的 volume

### Requirement: Tick 與分時資料不得無限制寫入 candle_history

系統 MUST NOT 將 Shioaji Tick、每秒微批次、分時價格點或成交量 bucket 寫入 `candle_history`；必要 session checkpoint MUST 有獨立身分、明確 retention 與 quota 上限，且不得改變既有日週月歷史 key。

#### Scenario: 正常交易日持續 Tick

- **WHEN** 閘道整日送入即時 Tick
- **THEN** `candle_history` rows written MUST NOT 隨 Tick 數增加
- **AND** 現有 yfinance 日週月歷史 MUST 繼續使用原 key 與 changed-tail 規則

#### Scenario: 清理過期 session checkpoint

- **WHEN** session checkpoint 超過設定 retention
- **THEN** 系統 MUST 以 bounded cleanup 刪除
- **AND** cleanup MUST NOT 刪除 canonical 日週月 history

### Requirement: 收盤後 canonical row 必須取代盤中 overlay

系統 MUST 在相同交易日的 canonical 日 K 可用後移除盤中 overlay，並由日 K重算週月尾端；任何 overlay 與 canonical 差異 MUST 保留安全診斷，但不得把未核定 realtime row 寫成已驗證歷史。

#### Scenario: canonical 日 K 到達

- **WHEN** 相同 session date 的 canonical 日 K 刷新完成
- **THEN** 後續 history response MUST 使用 canonical row
- **AND** 同日 realtime overlay MUST 不再參與日週月聚合

#### Scenario: 收盤資料尚未完成

- **WHEN** 市場已收盤但 canonical 日 K 尚未可用
- **THEN** 系統 MAY 暫時提供最後 overlay
- **AND** cache metadata MUST 表示 provisional／closing
- **AND** MUST NOT 將其標示為 verified canonical history
