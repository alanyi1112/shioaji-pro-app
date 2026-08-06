## ADDED Requirements

### Requirement: 即時來源與指標必須通過完整 simulation 驗收矩陣
MultiView MUST 在 simulation 實際驗證台股 Shioaji 即時、Yahoo 延遲、斷線 fallback、日／週／月 provisional 聚合、canonical handoff、價格與成交量 availability，以及目前可選技術指標。每項證據 MUST 記錄實際 provider、來源時間、資料狀態與安全計數，不得保存完整行情 payload。

#### Scenario: 快速切換與背景恢復
- **WHEN** 使用者快速切換商品及週期並讓頁面進入背景後回到前景
- **THEN** 舊 generation MUST 不得更新目前 panel，document SSE MUST 維持至多一條，恢復後 MUST 重新 bootstrap 目前 demand

#### Scenario: 指標 full-recompute 對照
- **WHEN** provisional K 棒連續更新 MA、BOLL、KD、MACD、RSI、ATR 與合法 volume indicators
- **THEN** latest-wins 結果 MUST 與相同 candles 的 full recompute 在既定精度內一致

#### Scenario: 斷線切換延遲來源
- **WHEN** simulation Shioaji business session 暫時不可用
- **THEN** 自動模式 MUST 原子切換到 Yahoo 延遲 payload、清楚顯示 provider 與 delayed 狀態，且不得混接同一當期 K 棒
