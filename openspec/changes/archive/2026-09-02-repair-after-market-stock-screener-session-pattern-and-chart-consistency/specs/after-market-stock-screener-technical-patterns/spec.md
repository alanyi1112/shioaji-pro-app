## MODIFIED Requirements

### Requirement: 原始三 K 分型必須嚴格且已確認

系統 MUST 只使用結束於 snapshot `effectiveSessionDate` 的最新三個相鄰、完整、已驗證官方市場交易日 A、B、C 判定原始三 K，C 必須同時為最新完整交易日及確認日。頂分型 MUST 要求 B 的 high 嚴格高於 A／C high 且 B 的 low 嚴格高於 A／C low；底分型 MUST 要求 B 的 low 嚴格低於 A／C low 且 B 的 high 嚴格低於 A／C high。相等、缺日、非法 OHLC、C 早於日量 D 或仍使用上一期 snapshot MUST NOT pass。

#### Scenario: 最新交易日確認底分型

- **WHEN** A／B／C 日期相鄰、C 等於 `effectiveSessionDate`，且 B.low 低於 A.low、C.low，B.high 也低於 A.high、C.high
- **THEN** 系統 MUST 回傳已確認底分型，並顯示 B 為中心日、C 為確認日

#### Scenario: 高低價相等

- **WHEN** B 任一必要 high／low 與相鄰 K 棒相等
- **THEN** 系統 MUST 將該方向判為 fail，不得以包含、四捨五入或視覺近似判為分型

#### Scenario: 右側 K 棒尚未完成

- **WHEN** 只有左棒與中心棒，C 尚非完整交易日，或 C 不等於當期 `effectiveSessionDate`
- **THEN** 系統 MUST 回 unknown／pending，且不得顯示為已確認分型

#### Scenario: 收盤後交易日推進

- **WHEN** `effectiveSessionDate` 由 D-1 推進至 D
- **THEN** 系統 MUST 以新的 A／B／C 視窗重新判定全市場，不得沿用以 D-1 為確認日的 pass 集合

### Requirement: 布林反轉 K 必須要求首次穿越與指定 K 棒結構

系統 MUST 固定使用結束於 snapshot `effectiveSessionDate` 的 canonical 官方未調整 OHLC 計算 BOLL(20,2)。前一官方市場交易日 P 的收盤 MUST 位於含邊界的通道內；最新完整交易日 D 必須等於 `effectiveSessionDate`，才能以嚴格不等號首次穿越。下軌模式 MUST 同時滿足 `closeD < lowerD`、陽 K `closeD > openD` 與下影線 `lowD < openD`；上軌模式 MUST 同時滿足 `closeD > upperD`、陰 K `closeD < openD` 與上影線 `highD > openD`。模式 MUST 提供下軌、上軌與任一型態。

#### Scenario: 首次跌破下軌並形成陽 K 下影

- **WHEN** P 收盤介於 P 的 lower／upper，且 D 等於 `effectiveSessionDate`、close 低於 lower、close 高於 open、low 低於 open
- **THEN** 下軌陽 K 下影分支 MUST pass，並回傳 P／D OHLC、bands、日期與影線證據

#### Scenario: 首次突破上軌並形成陰 K 上影

- **WHEN** P 收盤介於 P 的 lower／upper，且 D 等於 `effectiveSessionDate`、close 高於 upper、close 低於 open、high 高於 open
- **THEN** 上軌陰 K 上影分支 MUST pass，並回傳 P／D OHLC、bands、日期與影線證據

#### Scenario: 前一日已在通道外

- **WHEN** P 的收盤低於 lower 或高於 upper
- **THEN** 即使 D 仍位於相同通道外且 K 棒結構符合，系統 MUST NOT 判為首次穿越

#### Scenario: 碰軌、十字線或顏色相反

- **WHEN** D 收盤等於 band、open 等於 close、下軌型態為 `close < open`、上軌型態為 `close > open`，或指定方向的影線長度為零
- **THEN** 對應反轉 K MUST 為 fail，不得以台股畫面顏色、顯示四捨五入或名稱猜測取代 OHLC 比較

## ADDED Requirements

### Requirement: 技術型態集合必須與當期官方 OHLC 全市場重算一致

每次準備發布 v3，系統 MUST 以該 snapshot 的 canonical OHLC、session window 與公式版本獨立重算原始三 K、纏論分型與兩種 BOLL pass／fail／unknown 集合，並與保存的 technical evidence、API 分頁全集及守恆計數一致。只有 fixture、單一商品或純函式測試成功 MUST NOT 取代本機全市場 evidence。

#### Scenario: 全市場逐筆稽核

- **WHEN** v3 full run 的 remaining／failed／overdue 均為零
- **THEN** 驗收 MUST 比對每個 pass symbol 的 A／B／C 或 P／D、公式條件、evidence hash 與 API 集合
- **AND** 任一日期、OHLC、陽陰 K、影線或 band 條件不一致時 MUST 阻止完成宣告
