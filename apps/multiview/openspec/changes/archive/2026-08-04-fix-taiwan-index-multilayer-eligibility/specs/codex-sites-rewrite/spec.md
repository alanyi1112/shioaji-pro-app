## MODIFIED Requirements

### Requirement: 多圖功能 parity

系統 MUST 保留來源產品的 1／2／3／4／6／8 圖、多市場頁籤、分類分頁、雙擊新分頁單圖、主副圖指標、價格資訊與 Fixed Range Volume Profile 行為。多圖中的 panel MUST 以雙擊開啟同源的新分頁單圖，不得在原分頁切換為聚焦單圖；開啟後正確商品的 panel 與 K 線 MUST 在首次載入顯示，不得因非關鍵設定請求或原頁即時長連線占用而長時間只呈現空白網站框架。`view=single` 的商品與週期鎖定 MUST 只適用於目前 1 圖生命週期；當使用者切換至多圖時，所有 panel MUST 依目前頁籤與分類頁的 canonical 商品切片建立，且不得讓 single-view 商品持續佔用第一個 panel。台股市場頁籤若含 allowlist 內的台灣市場基準指數，該指數 MUST NOT 封鎖同頁 eligible 台股商品在 1／2／3／4 圖使用多層副圖，但指數自身 panel MUST 不建立籌碼資料生命週期。

#### Scenario: 使用者切換圖表數量

- **WHEN** 使用者選擇 1、2、3、4、6 或 8 張圖
- **THEN** 系統顯示對應數量的圖表面板
- **AND** 每個面板能載入所選商品與週期的 K 線及指標
- **AND** 若目前是 `view=single` 1 圖頁面且使用者切換至多圖，系統 MUST 先將 deep-link 商品換算到新圖表數量對應的分類頁，再以該頁的 canonical 商品切片建立所有 panel
- **AND** 切換至多圖後，第一個 panel MUST NOT 因舊 single-view state 重複顯示 deep-link 商品

#### Scenario: 台股市場指數與台股商品共存

- **WHEN** 「台股」頁籤的 visible symbol slice 同時包含 allowlist 內的 `^TWII` 與 `.TW`／`.TWO` 商品，且圖表數量為 1、2、3 或 4
- **THEN** 多層副圖選項 MUST 可選
- **AND** `^TWII` panel MUST 採單一技術副圖且不得建立籌碼 pane
- **AND** `.TW`／`.TWO` panel MUST 依使用者保存狀態採多層副圖

#### Scenario: 6／8 圖固定單一副圖

- **WHEN** 使用者選擇 6 或 8 張圖
- **THEN** 系統 MUST 使用單一副圖模式
- **AND** 主圖與多層副圖選項 MUST 不可選取
- **AND** 切換至 6／8 圖時不得啟用多層副圖的頁面捲動、controller 或資料生命週期
- **AND** 使用者切回 1、2、3 或 4 張圖後，系統 MUST 恢復切換前保存的主副圖偏好

#### Scenario: 多圖分類頁切換不重複第一個商品

- **WHEN** 使用者在 2、3、4、6 或 8 圖模式按下一頁或上一頁
- **THEN** 系統 MUST 依目前頁籤、圖表數量與頁碼切換完整的 visible symbol slice
- **AND** 每個 panel 的 canonical symbol MUST 與該 slice 的同位置商品一致
- **AND** 第一個 panel MUST NOT 固定保留先前單圖 URL 的商品

#### Scenario: 單圖商品正確換算多圖頁碼

- **WHEN** 有效 `view=single` URL 的商品位於頁籤商品清單中的 index N，且使用者切換至 page size S 的多圖模式
- **THEN** 系統 MUST 以 `floor(N / S)` 作為該商品所在的分類頁 index
- **AND** 該頁 MUST 顯示包含該商品的 canonical slice，不得把商品 index N 直接當成 page index

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

#### Scenario: 離開單圖 URL 後不殘留 single-view state

- **WHEN** 使用者在有效 `view=single` URL 中將圖表數量由 1 改為 2、3、4、6 或 8
- **THEN** 系統 MUST 清除只屬於單圖的 page-scoped 商品／週期鎖定
- **AND** 後續分類頁切換 MUST 使用一般多圖分頁狀態
- **AND** 目前網址 MUST 不再保留會讓重新載入回到單圖模式的 `view=single` query

#### Scenario: 新分頁與原分頁隔離

- **WHEN** 雙擊手勢成功觸發新分頁
- **THEN** 系統 MUST 使用 `noopener`，新分頁不得取得可操作原分頁的 `window.opener`
- **AND** 本次手勢 MUST NOT 同時觸發原分頁聚焦模式、圖表數量持久化或第二個新分頁
- **AND** 即使新分頁遭瀏覽器阻擋，原頁被暫停的即時串流 MUST 在有限時間內恢復
