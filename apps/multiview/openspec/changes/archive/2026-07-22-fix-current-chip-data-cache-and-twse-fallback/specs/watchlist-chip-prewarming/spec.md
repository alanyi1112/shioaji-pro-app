## ADDED Requirements

### Requirement: 預熱 ready 必須以實際 coverage 判定

日籌碼預熱 health 與 target discovery MUST 依 fetch-state 的實際資料 coverage 判定 ready／pending；成功請求時間、請求結束日或非空歷史 rows 本身 MUST NOT 取代實際 `coverage_end`。

#### Scenario: 排程成功但來源最新日落後
- **WHEN** scheduler 成功完成請求，但任一必要日 dataset 的實際 `coverage_end` 早於本次預熱 window end
- **THEN** 該 symbol MUST 計入 `pendingSymbols` 而非 `readySymbols`
- **AND** health MUST NOT 僅因 `lastSuccessAt` 新鮮而顯示該 symbol ready

#### Scenario: 官方 fallback 補齊當日資料
- **WHEN** 背景工作以官方 fallback 成功保存 window end 的當日 row，且其他必要 datasets 也完整新鮮
- **THEN** 該 symbol MUST 計入 `readySymbols`
- **AND** 後續 discovery MUST 在 freshness 有效期間略過該完整 symbol
