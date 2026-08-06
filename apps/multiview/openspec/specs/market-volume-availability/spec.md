# market-volume-availability Specification

## Purpose
TBD - created by archiving change restore-sox-volume-and-limit-multilayer-subcharts. Update Purpose after archive.
## Requirements
### Requirement: 忠實保留原始商品成交量語意

系統 MUST 保留商品來源本身的 OHLC 與成交量；當已知指數來源沒有提供有效成交量時，MUST 維持來源值並明確回報成交量不可用。系統 MUST NOT 以 ETF、期貨、其他指數、估算、插值或任何其他商品成交量替換原商品成交量。

#### Scenario: 費半來源沒有成交量
- **WHEN** `^SOX` 來源回傳有效價格 candles，但所有成交量皆為 0
- **THEN** 系統 MUST 原樣保留 `^SOX` 的 open、high、low、close 與 volume
- **AND** MUST NOT 請求或合併 `SOXQ`、`SOXX` 或任何其他商品的成交量

#### Scenario: 費半來源開始提供有效成交量
- **WHEN** `^SOX` 來源回傳至少一筆大於 0 的有效成交量
- **THEN** 系統 MUST 使用 `^SOX` 原始成交量
- **AND** MUST NOT 將該批資料標示為成交量不可用

### Requirement: API 與圖表揭露成交量不可用

當已知指數來源沒有提供有效成交量時，系統 MUST 在 `/api/candles` 回傳可機器判讀的 availability metadata，並在圖表顯示「此指數來源未提供成交量」或同等直接文案。來源限制揭露 MUST 保留於商品所有線圖的匯出圖片，且不得被描述為前端錯誤、等待補入或其他商品代理資料。

#### Scenario: API 回傳成交量不可用 metadata
- **WHEN** `^SOX` candles 的來源成交量全部為 0
- **THEN** `quote.volumeAvailability` 與 `dataQuality.volumeAvailability` MUST 回傳 `status: "unavailable"`、`reason: "source_not_provided"` 與中文說明
- **AND** candle volume、價格來源與 `quote.sourceProvider` MUST 維持原始商品語意

#### Scenario: 圖表顯示來源限制
- **WHEN** panel 載入含 unavailable metadata 的 `^SOX` candles
- **THEN** 主圖成交量區 MUST 顯示「此指數來源未提供成交量」
- **AND** 標籤 MUST 不遮住 K 線或右側數值軸，並 MUST 出現在匯出圖片中

#### Scenario: 成交量可用
- **WHEN** candle response 沒有成交量不可用 metadata
- **THEN** 圖表 MUST 隱藏來源限制標籤
- **AND** API MUST NOT 宣稱成交量不可用
