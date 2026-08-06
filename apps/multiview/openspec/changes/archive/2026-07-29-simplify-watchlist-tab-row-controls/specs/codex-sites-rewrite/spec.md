## MODIFIED Requirements

### Requirement: 台股個股籌碼正式部署驗收

系統 MUST 在 build、測試、migration 檢查與 OpenSpec strict validation 通過後才部署籌碼功能，並 MUST 以已登入 Codex Sites 正式站驗證上市、上櫃代表普通股與 ETF 的可見副圖及 API。

#### Scenario: 正式站普通股驗收
- **WHEN** 新版本成功部署至 owner-only Codex Site
- **THEN** 驗收至少涵蓋一檔 `.TW` 與一檔 `.TWO` 普通股的法人、外資持股、融資融券、可用借券及大戶／散戶資料
- **AND** 確認 1／2／3／4／6／8 圖 A／B、3 圖一列三欄、4 圖方式 A 2×2、4 圖方式 B 一列四欄、6／8 圖方式 B 的 document scroll、實際資料日期、單位、來源、時間同步與 hover 讀值
- **AND** 確認多圖 panel 雙擊會在新分頁顯示正確商品的 1 圖，且原分頁狀態不變
- **AND** 確認台股單一商品頁可切換 A／B、非台股單一商品頁固定 A，且資格只依目標商品判斷

#### Scenario: 正式站 ETF 驗收
- **WHEN** 正式站載入至少一檔上市 ETF 及一檔可用的上櫃 ETF
- **THEN** 每個可用 dataset MUST 顯示真實資料，不可用 dataset MUST 顯示獨立原因
- **AND** 大戶／散戶 MUST 標示 TDCC 週資料、比例線、週變化柱與實際資料日期

#### Scenario: 正式站不適用與容錯驗收
- **WHEN** 驗收人員切換到非日 K、非台股商品、缺欄位或模擬來源失敗
- **THEN** 畫面顯示正確的不適用／部分／過期狀態
- **AND** K 線、既有技術副圖與其他 panel 不受影響
