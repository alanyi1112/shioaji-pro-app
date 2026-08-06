## MODIFIED Requirements

### Requirement: 多圖功能 parity

系統 MUST 保留來源產品的 1／2／3／4／6／8 圖、多市場頁籤、分類分頁、雙擊新分頁單圖、主副圖指標、價格資訊與 Fixed Range Volume Profile 行為。多圖中的 panel MUST 以雙擊開啟同源的新分頁單圖，不得在原分頁切換為聚焦單圖；開啟後正確商品的 panel 與 K 線 MUST 在首次載入顯示，不得因非關鍵設定請求或原頁即時長連線占用而長時間只呈現空白網站框架。

#### Scenario: 使用者切換圖表數量

- **WHEN** 使用者選擇 1、2、3、4、6 或 8 張圖
- **THEN** 系統顯示對應數量的圖表面板
- **AND** 每個面板能載入所選商品與週期的 K 線及指標

#### Scenario: 雙擊多圖中的商品 panel

- **WHEN** 使用者在多圖工作區雙擊某個非互動控制區的商品 panel
- **THEN** 系統 MUST 在新瀏覽器分頁開啟該商品的 1 圖畫面
- **AND** 新分頁 MUST 保留該 panel 的 canonical symbol、interval 與 tab 識別
- **AND** 原頁 MAY 短暫暫停既有 panel 即時串流以釋放同源連線容量，但 MUST 自動恢復
- **AND** 原分頁的圖表數量、商品順序、頁碼、捲動位置、visible range 與副圖狀態 MUST 保持不變

#### Scenario: 新分頁重新載入單圖 URL

- **WHEN** 使用者重新載入含有效 `view=single`、`symbol`、`interval` 與 `tab` query 的同源 URL
- **THEN** 該頁 MUST 仍以指定商品與週期顯示 1 圖
- **AND** 必要商品目錄請求與 panel 建立 MUST NOT 等待非關鍵 app config 完成
- **AND** page-scoped 的 1 圖狀態 MUST NOT 把共用圖表數量偏好覆寫為 1
- **AND** 無效或不存在的 query 值 MUST 經 allowlist／商品目錄驗證後安全 fallback，不得載入任意商品或造成初始化失敗

#### Scenario: 新分頁與原分頁隔離

- **WHEN** 雙擊手勢成功觸發新分頁
- **THEN** 系統 MUST 使用 `noopener`，新分頁不得取得可操作原分頁的 `window.opener`
- **AND** 本次手勢 MUST NOT 同時觸發原分頁聚焦模式、圖表數量持久化或第二個新分頁
- **AND** 即使新分頁遭瀏覽器阻擋，原頁被暫停的即時串流 MUST 在有限時間內恢復
