## MODIFIED Requirements

### Requirement: 多圖功能 parity

系統 MUST 保留來源產品的 1／2／3／4／6／8 圖、多市場頁籤、分類分頁、雙擊新分頁單圖、主副圖指標、價格資訊與 Fixed Range Volume Profile 行為。多圖中的 panel MUST 以雙擊開啟同源的新分頁單圖，不得在原分頁切換為聚焦單圖。

#### Scenario: 使用者切換圖表數量

- **WHEN** 使用者選擇 1、2、3、4、6 或 8 張圖
- **THEN** 系統顯示對應數量的圖表面板
- **AND** 每個面板能載入所選商品與週期的 K 線及指標

#### Scenario: 雙擊多圖中的商品 panel

- **WHEN** 使用者在多圖工作區雙擊某個非互動控制區的商品 panel
- **THEN** 系統 MUST 在新瀏覽器分頁開啟該商品的 1 圖畫面
- **AND** 新分頁 MUST 保留該 panel 的 canonical symbol、interval 與 tab 識別
- **AND** 原分頁的圖表數量、商品順序、頁碼、捲動位置、visible range 與副圖狀態 MUST 保持不變

#### Scenario: 新分頁重新載入單圖 URL

- **WHEN** 使用者重新載入含有效 `view=single`、`symbol`、`interval` 與 `tab` query 的同源 URL
- **THEN** 該頁 MUST 仍以指定商品與週期顯示 1 圖
- **AND** page-scoped 的 1 圖狀態 MUST NOT 把共用圖表數量偏好覆寫為 1
- **AND** 無效或不存在的 query 值 MUST 經 allowlist／商品目錄驗證後安全 fallback，不得載入任意商品或造成初始化失敗

#### Scenario: 新分頁與原分頁隔離

- **WHEN** 雙擊手勢成功觸發新分頁
- **THEN** 系統 MUST 使用 `noopener`，新分頁不得取得可操作原分頁的 `window.opener`
- **AND** 本次手勢 MUST NOT 同時觸發原分頁聚焦模式、圖表數量持久化或第二個新分頁

### Requirement: 台股個股籌碼正式部署驗收

系統 MUST 在 build、測試、migration 檢查與 OpenSpec strict validation 通過後才部署籌碼功能，並 MUST 以已登入 Codex Sites 正式站驗證上市、上櫃代表普通股與 ETF 的可見副圖及 API。

#### Scenario: 正式站普通股驗收
- **WHEN** 新版本成功部署至 owner-only Codex Site
- **THEN** 驗收至少涵蓋一檔 `.TW` 與一檔 `.TWO` 普通股的法人、外資持股、融資融券、可用借券及大戶／散戶資料
- **AND** 確認 1／2／3／4 圖 A／B、6／8 圖強制 A、3 圖一列三欄、4 圖方式 A 2×2、4 圖方式 B 一列四欄、實際資料日期、單位、來源、時間同步與 hover 讀值
- **AND** 確認多圖 panel 雙擊會在新分頁顯示正確商品的 1 圖，且原分頁狀態不變

#### Scenario: 正式站 ETF 驗收
- **WHEN** 正式站載入至少一檔上市 ETF 及一檔可用的上櫃 ETF
- **THEN** 每個可用 dataset MUST 顯示真實資料，不可用 dataset MUST 顯示獨立原因
- **AND** 大戶／散戶 MUST 標示 TDCC 週資料、比例線、週變化柱與實際資料日期

#### Scenario: 正式站不適用與容錯驗收
- **WHEN** 驗收人員切換到非日 K、非台股商品、缺欄位或模擬來源失敗
- **THEN** 畫面顯示正確的不適用／部分／過期狀態
- **AND** K 線、既有技術副圖與其他 panel 不受影響
