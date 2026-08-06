## ADDED Requirements

### Requirement: 價格更新動畫必須只表示盤中實際價格變動

系統 MUST 只有在同一圖表已呈現過有效價格、最新價格相較前一次呈現值實際改變，且正規化市場狀態仍為交易中時，才顯示商品報價欄的價格更新動畫。初次載入、相同價格重送、`quote.kind = session-close` 或市場已收盤時 MUST NOT 顯示紅／綠底更新動畫；收盤核對與資料品質文字 MUST 繼續正常更新。

#### Scenario: 盤中價格實際變動

- **WHEN** 同一台股圖表已呈現有效價格
- **AND** 後續盤中 payload 的最新價格與前一次呈現值不同
- **AND** 正規化市場狀態為 `open` 且 `quote.kind` 不是 `session-close`
- **THEN** 商品報價欄 MUST 依既有漲跌方向顯示一次短暫更新動畫

#### Scenario: 串流重送相同盤中價格

- **WHEN** `/api/stream` 重送同一台股商品的最新 candle
- **AND** 最新價格與前一次呈現值相同
- **THEN** 商品報價欄 MUST NOT 再次顯示價格更新動畫

#### Scenario: 台股收盤後收到相同或更正資料

- **WHEN** 正規化市場狀態不是 `open` 或 `quote.kind = session-close`
- **THEN** 系統 MUST 更新價格、漲跌與核對狀態等可見資料
- **AND** 商品報價欄 MUST NOT 顯示紅／綠底更新動畫
- **AND** 已完成官方核對時 MUST 繼續顯示「已核對」

#### Scenario: 圖表初次載入

- **WHEN** panel 尚未呈現過可比較的有效價格
- **THEN** 系統 MUST 顯示最新價格與狀態
- **AND** 商品報價欄 MUST NOT 將初次載入誤表示為價格更新
