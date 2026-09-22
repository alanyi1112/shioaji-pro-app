## ADDED Requirements

### Requirement: 自動來源不得顯示即將被即時 bootstrap 取代的中間 payload
對已啟用 Shioaji simulation 且支援即時的台股分鐘與日線，`自動`模式 MUST 先取得完整 Shioaji bootstrap，再一次顯示最終同源 candle payload。canonical Yahoo／TWSE payload MAY 在記憶體中作為 fallback，但 MUST NOT 在 Shioaji bootstrap 尚在進行時先顯示並於第一筆即時行情抵達後可見地整批替換。

#### Scenario: 自動模式 Shioaji bootstrap 成功
- **WHEN** canonical fallback 先完成，而 Shioaji contract、snapshot 與完整 Kbars bootstrap 隨後成功
- **THEN** panel MUST 直接顯示完整 Shioaji payload與實際來源狀態
- **AND** 不得先畫 canonical fallback 再因第一筆 snapshot 改變歷史長度與 viewport

#### Scenario: 自動模式 Shioaji bootstrap 失敗
- **WHEN** contract、snapshot、Kbars 或 business session 在既有 timeout／重試界線內無法成立
- **THEN** panel MUST 原子顯示已保存的完整 canonical fallback 並標示實際 provider、continuity 與 delayed／partial 狀態
- **AND** 不得混接 Shioaji OHLCV、time 或 `common_lot` 到 fallback payload

#### Scenario: Shioaji bootstrap 只是短暫較慢
- **WHEN** canonical fallback 已備妥但 Shioaji Kbars 尚未完成
- **THEN** 自動模式 MUST 先保留等待狀態，不得因 coordinator 初始化的暫態狀態立即畫出 canonical payload
- **AND** 等待超過 1.5 秒後 MAY 顯示完整 canonical fallback；Shioaji 隨後恢復時 MUST 以完整資料集合及有效 viewport 原子交接

#### Scenario: 同交易日即時價持續更新
- **WHEN** 完整 Shioaji 日線已顯示，後續 snapshot 只更新相同交易日最後一棒
- **THEN** 系統 MUST 增量更新最後一棒與受影響的最新指標
- **AND** candle 數量、歷史起訖、來源身分與 viewport MUST 保持不變
