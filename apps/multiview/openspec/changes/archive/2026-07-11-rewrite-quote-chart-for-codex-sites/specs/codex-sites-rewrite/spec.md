## ADDED Requirements

### Requirement: Sites 完整執行環境

系統 MUST 在 Codex Sites／Cloudflare Workers 相容 runtime 中提供首頁、靜態資產、同源 API、即時資料與持久化，不得把既有 Render 站當作正式依賴。

#### Scenario: 正式站獨立運作

- **WHEN** 使用者開啟 Codex Sites 正式網址
- **THEN** 首頁與 `/api/health` 皆由 Sites deployment 回應
- **AND** 圖表資料請求不會導向既有 Render 網域

### Requirement: 多圖功能 parity

系統 MUST 保留來源產品的 1／2／4／6／8 圖、多市場頁籤、分類分頁、聚焦單圖、主副圖指標、價格資訊與 Fixed Range Volume Profile 行為。

#### Scenario: 使用者切換圖表數量

- **WHEN** 使用者選擇 1、2、4、6 或 8 張圖
- **THEN** 系統顯示對應數量的圖表面板
- **AND** 每個面板能載入所選商品與週期的 K 線及指標

### Requirement: Workers 市場資料與指標

系統 MUST 以 Workers 相容方式取得 Yahoo Chart、Hyperliquid 或 sample 行情，並以 TypeScript 產生既有前端需要的指標 payload。

#### Scenario: 讀取台股日 K

- **WHEN** 前端請求 `/api/candles?symbol=2330.TW&interval=1d`
- **THEN** API 回傳 K 線、quoteTime、quote、marketSession、indicators 與 dataWindow
- **AND** 不暴露上游秘密或內部錯誤細節

#### Scenario: Massive 維持免費方案

- **WHEN** Massive 免費方案不包含特定指數、外匯或期貨資料
- **THEN** 系統 MUST 維持 `unverified`
- **AND** 系統 MUST 顯示安全且可診斷的 entitlement 原因
- **AND** 完成條件 MUST NOT 要求升級 Massive 付費方案

### Requirement: 使用者清單持久化

系統 MUST 使用 Sites D1 保存使用者自訂頁籤與商品清單，並以 Sites 伺服器端使用者識別隔離資料。

#### Scenario: 儲存個人頁籤

- **WHEN** 已識別使用者新增或修改個人頁籤
- **THEN** 重新載入後仍可取得該頁籤
- **AND** 其他使用者不可讀寫該資料

### Requirement: 台股官方第二來源核對必須保守且一致

系統 MUST 對 `.TW` 已完成日 K 使用 TWSE、對 `.TWO` 已完成日 K 使用 TPEx，先對齊官方交易日再比較收盤價，且 candles 與 stream MUST 回傳一致的核對結果。

#### Scenario: 官方交易日與收盤價一致

- **WHEN** 主來源與官方第二來源的 `sessionDate` 相同
- **AND** 兩者收盤價依官方資料精度正規化後相同
- **THEN** `quote.verification.status` MUST 為 `verified`
- **AND** API MUST 回傳實際解析出的 `referenceSessionDate` 與 `checkedAt`
- **AND** 前端 MUST 明確顯示「已核對」

#### Scenario: 官方資料尚未發布目標交易日

- **WHEN** 官方第二來源交易日早於主來源 `sessionDate`
- **THEN** 核對狀態 MUST 保持 `unverified`
- **AND** 原因 MUST 為 `reference_not_published`
- **AND** 系統 MUST NOT 將此情況標示為價格不一致

#### Scenario: TPEx 官方網域無法由 Sites Worker 存取

- **WHEN** `.TWO` 商品的 TPEx 官方端點在 Codex Sites runtime 回應失敗
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
- **AND** 兩者 MUST 回傳相同的 verification、來源與最後有效交易日

### Requirement: 台股官方全市場資料必須受快取與併發保護

系統 MUST 對 TWSE 與 TPEx 全市場官方回應分別使用短期快取與 single-flight，不得為同批多圖中的每個商品重複下載完整市場資料。

#### Scenario: 多個台股 panel 同時核對

- **WHEN** 多個 `.TW` 或 `.TWO` panel 在快取有效期間同時載入
- **THEN** 同一官方市場 MUST 只產生一個進行中的全市場請求
- **AND** 後續商品 MUST 重用該回應

### Requirement: 台股占位資料與驗證狀態必須可診斷

系統 MUST 在指標與報價計算前排除符合零量、OHLC 平盤及前收相同條件的台股日 K，並公開中性 `dataQuality` metadata 與保守驗證狀態。

#### Scenario: 排除零量平盤占位 K

- **WHEN** 台股日 K 尾端含有符合條件的占位資料
- **THEN** candles、indicators、quote 與 stream MUST 使用最後有效交易日
- **AND** `dataQuality.ignoredSessionDates` MUST 列出被忽略日期
- **AND** reason MUST 使用 `zero_volume_flat_carry_forward`

#### Scenario: 核對失敗或資料過期

- **WHEN** 第二來源無法核對或只能使用過期 cache
- **THEN** 前端 MUST 分別顯示「未驗證」或「資料過期」
- **AND** API MUST 使用安全原因碼，不得回傳官方原始收盤價、秘密或完整上游錯誤內容

### Requirement: Codex Sites 部署驗收

系統 MUST 在成功建置、API smoke 與核心互動驗證後才建立並部署 Sites 版本。

#### Scenario: 部署成功

- **WHEN** Sites deployment 狀態為 `succeeded`
- **THEN** 回報正式網址
- **AND** 以正式網址確認首頁與 `/api/health` 可用
