## MODIFIED Requirements

### Requirement: 台股官方第二來源核對必須保守且一致

系統 MUST 只對 `.TW` 與 `.TWO` 的已完成日 K 進行官方第二來源核對；`.TW` MUST 優先使用可依日期取得同日一般交易收盤行情的 TWSE 官方資料，`.TWO` 使用 TPEx，先對齊官方交易日再比較收盤價，且 candles 與 stream MUST 回傳一致的市場階段、來源時間與核對結果。盤中日 K MUST 標示為不適用收盤核對，不得顯示成核對失敗。

#### Scenario: 台股盤中日 K 不進行收盤核對

- **WHEN** 主來源回傳台股當日尚未完成的日 K
- **THEN** `quote.kind` MUST 為 `intraday`
- **AND** `quote.verification.status` MUST 為 `not_applicable`
- **AND** 系統 MUST NOT 呼叫 TWSE、TPEx、TWSE MIS 或 TPEx mirror 收盤資料

#### Scenario: 官方交易日與收盤價一致

- **WHEN** 主來源報價為已完成日 K
- **AND** 主來源與官方第二來源的 `sessionDate` 相同
- **AND** 兩者收盤價依官方資料精度正規化後相同
- **THEN** `quote.verification.status` MUST 為 `verified`
- **AND** API MUST 回傳實際解析出的 `referenceSessionDate` 與 `checkedAt`
- **AND** 前端 MUST 明確顯示「已核對」

#### Scenario: 上市商品取得 TWSE 同日收盤行情

- **WHEN** `.TW` 主來源報價為已完成日 K
- **AND** TWSE 日期指定的 `MI_INDEX` 已發布相同 `sessionDate`
- **THEN** 系統 MUST 從同時含有「證券代號」與「收盤價」欄位的 table 尋找商品
- **AND** 系統 MUST 依欄位名稱定位資料，不得依賴固定 table index 或固定欄位順序
- **AND** 只有官方回傳日期、證券代號與主來源交易日均一致時才能比較收盤價

#### Scenario: 官方資料尚未發布目標交易日

- **WHEN** 主來源報價已轉為已完成日 K
- **AND** 官方第二來源交易日早於主來源 `sessionDate`
- **THEN** 核對狀態 MUST 為 `pending`
- **AND** reason MUST 為 `reference_not_published`
- **AND** 系統 MUST NOT 將此情況標示為「未驗證」或價格不一致

#### Scenario: TWSE 同日端點明確尚未發布

- **WHEN** `.TW` 已完成日 K 查詢 TWSE 日期指定的同日資料
- **AND** 官方回覆目標日期尚無資料或沒有目標日期的有效 table
- **THEN** 核對狀態 MUST 為 `pending`
- **AND** reason MUST 為 `reference_not_published`
- **AND** 系統 MUST NOT 將正常產製延遲視為 provider failure

#### Scenario: TWSE 同日端點真正失敗

- **WHEN** `.TW` 已完成日 K 的 TWSE 同日端點發生連線、HTTP 或無法安全解析的格式錯誤
- **THEN** 系統 MAY 使用 TWSE MIS 的 `tse` 行情作保守 fallback
- **AND** MIS 失敗時 MAY 再使用既有 `STOCK_DAY_ALL`
- **AND** 所有 fallback 仍 MUST 先對齊交易日再比較收盤價
- **AND** provider MUST 明確反映實際完成核對的官方來源

#### Scenario: 官方商品沒有可比較的收盤價

- **WHEN** 同交易日官方商品的收盤價為 `--`、空值、非有限數值或其他無成交標記
- **THEN** 系統 MUST NOT 產生 `mismatch`
- **AND** 核對結果 MUST 使用安全且可診斷的 `unverified` reason

#### Scenario: 多個上市面板查詢同一交易日

- **WHEN** 多個 `.TW` 面板同時核對相同 `sessionDate`
- **THEN** 系統 MUST 共用同一個全市場請求或 inflight promise
- **AND** 成功結果與尚未發布結果 MUST 使用有界快取，避免每個面板重複呼叫官方端點

#### Scenario: TPEx 官方網域無法由 Sites Worker 存取

- **WHEN** `.TWO` 已完成日 K 的 TPEx 官方端點在 Codex Sites runtime 回應失敗
- **THEN** 系統 MAY 使用 TWSE 官方 MIS 的 `otc` 行情作為保守 fallback
- **AND** provider MUST 明確標示為 `twse-mis`
- **AND** fallback 仍 MUST 先對齊交易日再比較收盤價

#### Scenario: Sites 使用獨立 TPEx 官方資料鏡像

- **WHEN** Sites runtime 無法直接存取 TPEx 與 TWSE MIS
- **THEN** private GitHub Actions MAY 定期抓取並驗證 TPEx 官方全市場收盤資料後寫入 Sites D1
- **AND** 寫入請求 MUST 同時通過 Sites bypass token 與獨立 ingest secret
- **AND** D1 payload MUST 驗證單一官方日期、至少 500 筆有效代號與有限收盤價
- **AND** provider MUST 標示為 `tpex-mirror`
- **AND** 只有鏡像交易日與主來源相同且收盤價一致時才能標示 `verified`
- **AND** 此流程 MUST NOT 依賴 Render 服務

#### Scenario: candles 與 stream 讀取同一商品

- **WHEN** `/api/candles` 與 `/api/stream` 讀取相同台股商品與日 K
- **THEN** 兩者 MUST 共用相同的正規化與核對流程
- **AND** 兩者 MUST 回傳相同的 `marketPhase`、`kind`、`verification`、來源與最後有效交易日
