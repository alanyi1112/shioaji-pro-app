## ADDED Requirements

### Requirement: 已載入資料後的前景更新必須原子套用

系統 MUST 將快取首繪與後續 `/api/candles` 前景更新限制在目前有效的 panel generation、load token、symbol、interval 與 chart instance，並在資料正規化及完整圖表套用成功後才提交新的 canonical payload、last payload 與 panel cache。圖表套用失敗 MUST 保留上一份完整可用畫面，且不得把成功的 API response 誤報為資料來源失敗。

#### Scenario: 相鄰頁預載後切換至該頁

- **WHEN** 使用者切換至已有 panel payload cache 的分類頁，系統先顯示快取再收到前景 `/api/candles` 成功回應
- **THEN** 系統 MUST 以同一個有效 panel 生命週期依序完成快取首繪與前景更新
- **AND** 前景 payload MUST 在完整套用成功後才取代 cache 與 canonical payload
- **AND** panel 狀態 MUST 最終顯示目前 symbol 與週期已載入
- **AND** browser Console 與 panel 狀態 MUST NOT 出現 `Value is null`

#### Scenario: 快取更新期間快速往返分類頁

- **WHEN** 使用者在第 1、2 頁或其他相鄰分類頁之間快速往返，且前景 request、series 重建或延遲 refit 尚未完成
- **THEN** 已失效 generation 的同步與延遲圖表工作 MUST 停止或被忽略
- **AND** 最後頁面的 panel MUST 對應最後選定的 canonical 商品
- **AND** 最後一次前景更新 MUST 能完成，不得停留在「使用已載入資料，更新失敗」

#### Scenario: payload 含可略過的指標空值

- **WHEN** `/api/candles` 成功回應的指標 line 或 histogram 含 null、undefined、NaN 或非有限 value
- **THEN** 系統 MUST 在呼叫 Lightweight Charts 前略過該資料點，或在支援 whitespace 的 series 轉換成只有有效 time 的資料點
- **AND** 系統 MUST NOT 將缺值改成 0
- **AND** 其餘有效 K 線與指標 MUST 繼續顯示

#### Scenario: payload 沒有可繪製 K 線

- **WHEN** `/api/candles` 回應不含任何具有效 time 與 OHLC 的 K 線
- **THEN** 系統 MUST 拒絕套用及寫入 cache
- **AND** 若 panel 已有成功載入資料，MUST 保留該完整畫面並顯示「圖表更新失敗」類型的診斷狀態
- **AND** 訊息 MUST 與 request timeout、HTTP error 或來源資料載入失敗區分

#### Scenario: 代表性 ETF 完成快取後更新

- **WHEN** `00919.TW` 或 `00982A.TW` 在單圖多層副圖模式先使用預載資料再完成前景更新
- **THEN** 主圖、技術副圖與已選籌碼副圖 MUST 保持可讀
- **AND** 可視範圍與游標對齊 MUST 對應目前圖表寬度與最後載入資料
- **AND** panel MUST 不顯示 `Value is null` 或假性資料更新失敗
