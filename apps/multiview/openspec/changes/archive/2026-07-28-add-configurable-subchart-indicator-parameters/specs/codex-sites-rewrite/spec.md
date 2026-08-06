## MODIFIED Requirements

### Requirement: Workers 市場資料與指標
系統 MUST 以 Workers 相容方式取得 Yahoo Chart、Hyperliquid 或 sample 行情，並以 TypeScript 產生既有前端需要的指標 payload。指標 payload MUST 支援經驗證的全域副圖參數，其中 RSI 預設為 5／10 Wilder 雙序列，KD 預設為 9／3／3 且 K、D 初始值為 50；candles 與 stream MUST 使用相同參數與公式。

#### Scenario: 讀取台股日 K
- **WHEN** 前端請求 `/api/candles?symbol=2330.TW&interval=1d`
- **THEN** API 回傳 K 線、quoteTime、quote、marketSession、indicators 與 dataWindow
- **AND** indicators MUST 包含 RSI 雙序列、KD、MACD、ATR 與本次使用的正規化參數
- **AND** 不暴露上游秘密或內部錯誤細節

#### Scenario: 以自訂副圖參數讀取 K 線與 stream
- **WHEN** 前端以合法 RSI、KD、MACD 或 ATR query 參數請求 `/api/candles` 或 `/api/stream`
- **THEN** Worker MUST 以同一份正規化設定計算回傳 indicators
- **AND** candle payload cache MUST 區分不同設定簽章

#### Scenario: Massive 維持免費方案
- **WHEN** Massive 免費方案不包含特定指數、外匯或期貨資料
- **THEN** 系統 MUST 維持 `unverified`
- **AND** 系統 MUST 顯示安全且可診斷的 entitlement 原因
- **AND** 完成條件 MUST NOT 要求升級 Massive 付費方案
