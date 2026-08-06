## MODIFIED Requirements

### Requirement: Sites 台股個股籌碼資料鏈

系統 MUST 在 Codex Sites／Cloudflare Workers 相容 runtime 中，依資料族群提供台股普通股與 ETF 的日頻籌碼、TDCC 週頻股權分散、D1 快取與副圖資料，不得把既有 Render 站作正式依賴，也不得由瀏覽器直接攜帶上游 token。

#### Scenario: Sites Worker 取得普通股籌碼
- **WHEN** 正式站請求 eligible `.TW` 或 `.TWO` 普通股的日頻籌碼
- **THEN** 同源 Worker API 從 D1 或允許介接的上游回傳正規化資料
- **AND** response 不導向 Render、不暴露 token 或內部錯誤

#### Scenario: Sites Worker 取得 ETF 籌碼
- **WHEN** 正式站請求商品目錄確認為 TWSE／TPEx ETF 的日頻籌碼或 TDCC 週頻股權分散
- **THEN** 同源 Worker API MUST 逐 dataset 回傳 eligibility、availability、來源及可用資料
- **AND** 某 dataset 無資料時不得拒絕同一 ETF 的其他可用 dataset

#### Scenario: D1 或特定來源暫時不可用
- **WHEN** 某資料族群無法讀取或更新
- **THEN** 其他 K 線、技術指標、清單及可用籌碼族群 MUST 繼續運作
- **AND** 籌碼 API 回傳安全的局部失敗狀態

### Requirement: 台股個股籌碼正式部署驗收

系統 MUST 在 build、測試、migration 檢查與 OpenSpec strict validation 通過後才部署籌碼功能，並 MUST 以已登入 Codex Sites 正式站驗證上市、上櫃代表普通股與 ETF 的可見副圖及 API。

#### Scenario: 正式站普通股驗收
- **WHEN** 新版本成功部署至 owner-only Codex Site
- **THEN** 驗收至少涵蓋一檔 `.TW` 與一檔 `.TWO` 普通股的法人、外資持股、融資融券、可用借券及大戶／散戶資料
- **AND** 確認 1／2／3 圖 A／B、4／6／8 圖強制 A、3 圖版面、實際資料日期、單位、來源、時間同步與 hover 讀值

#### Scenario: 正式站 ETF 驗收
- **WHEN** 正式站載入至少一檔上市 ETF 及一檔可用的上櫃 ETF
- **THEN** 每個可用 dataset MUST 顯示真實資料，不可用 dataset MUST 顯示獨立原因
- **AND** 大戶／散戶 MUST 標示 TDCC 週資料、比例線、週變化柱與實際資料日期

#### Scenario: 正式站不適用與容錯驗收
- **WHEN** 驗收人員切換到非日 K、非台股商品、缺欄位或模擬來源失敗
- **THEN** 畫面顯示正確的不適用／部分／過期狀態
- **AND** K 線、既有技術副圖與其他 panel 不受影響
