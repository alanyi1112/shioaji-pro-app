# localized-instrument-search Specification

## Purpose
TBD - created by archiving change add-zh-tw-fuzzy-instrument-search. Update Purpose after archive.
## Requirements
### Requirement: 台股官方繁中商品目錄
系統 MUST 維護可由 Codex Sites 搜尋的上市及上櫃股票與 ETF 商品目錄，並保存官方繁體中文名稱、可供行情流程使用的 `.TW`／`.TWO` symbol、交易所、商品類型、來源及資料更新時間。

#### Scenario: 以台股中文名稱搜尋上櫃股票
- **WHEN** 使用者在「搜尋商品」輸入 `元太`
- **THEN** 系統回傳 `8069.TWO` 候選，主名稱為 `元太`
- **AND** 候選標示 TPEx、上櫃股票及官方目錄來源

#### Scenario: 以台股代號搜尋
- **WHEN** 使用者輸入 `8069` 或 `8069.TWO`
- **THEN** 系統優先回傳 `8069.TWO 元太`
- **AND** 不以 Yahoo 的 `E Ink Holdings Inc.` 取代繁中主名稱

#### Scenario: 搜尋上市股票與 ETF
- **WHEN** 使用者輸入上市股票或 ETF 的完整／部分繁中名稱或代號
- **THEN** 系統從完整上市目錄回傳相符的 `.TW` 候選
- **AND** 候選使用官方繁中名稱

### Requirement: 海外商品繁中名稱與別名
系統 MUST 為目前支援的海外股票、指數、期貨、外匯、債券及加密貨幣維護可審核的繁中主名稱、英文正式名稱及常用中文／英文別名，並以該目錄解析中文搜尋。

#### Scenario: 搜尋美股中文名稱
- **WHEN** 使用者輸入 `輝達`
- **THEN** 系統回傳 `NVDA` 候選
- **AND** 候選以 `輝達`為主名稱並以 `NVIDIA Corporation` 為英文輔助名稱

#### Scenario: 搜尋美股常見別名
- **WHEN** 使用者輸入 `蘋果`
- **THEN** 系統回傳 `AAPL` 候選
- **AND** 候選同時顯示繁中主名稱、英文正式名稱、代號與美股市場資訊

#### Scenario: 搜尋海外指數或商品
- **WHEN** 使用者輸入 `日經`、`布蘭特原油`、`那斯達克` 或其他已收錄別名
- **THEN** 系統回傳相符的 canonical symbol
- **AND** 候選以繁中主名稱呈現

#### Scenario: 未收錄繁中名稱的外部商品
- **WHEN** Yahoo 回傳一個目錄尚未收錄繁中名稱的有效外部候選
- **THEN** 系統保留可辨識的英文名稱與來源
- **AND** 系統不得自動產生或假稱存在已審核的繁中名稱

### Requirement: 正規化與模糊搜尋排序
系統 MUST 對中文、英文及代號查詢作 deterministic 正規化與評分，並依完整代號、繁中主名稱／別名 exact、代號／名稱 prefix、名稱 contains、中文 fuzzy、英文／外部候選的優先順序回傳結果。

#### Scenario: 輸入部分中文名稱
- **WHEN** 使用者輸入至少兩個中文字，且該字串是商品名稱或別名的一部分
- **THEN** 系統回傳依相似度及來源可信度排序的可能商品
- **AND** exact 或 prefix 相符項目排在較寬鬆的 fuzzy 項目前

#### Scenario: 正規化空白與大小寫
- **WHEN** 查詢只在英文大小寫、全半形、空白或常見標點上與名稱／代號不同
- **THEN** 系統仍視為相符查詢

#### Scenario: 單一中文字查詢
- **WHEN** 使用者只輸入一個中文字
- **THEN** 前端不發出寬鬆 fuzzy 搜尋
- **AND** 畫面提示使用者再多輸入一些字

#### Scenario: 代號查詢可少於兩字
- **WHEN** 使用者輸入可辨識為代號的英數字元
- **THEN** 系統允許依代號 exact 或 prefix 搜尋

### Requirement: 搜尋候選資訊與去重
系統 MUST 以 `symbol + exchange` 識別候選，並回傳 `symbol`、`name`、`provider`、`source`、`market`、`exchange`、`group`、`quoteType`；有繁中目錄資料時 MUST 另提供可用的繁中主名稱與英文正式名稱，且不得讓較低可信度的英文候選覆蓋同商品的繁中資料。

#### Scenario: 同一商品來自多個來源
- **WHEN** 本機清單、D1 目錄與 Yahoo 都回傳相同 `symbol + exchange`
- **THEN** 系統只顯示一個合併後候選
- **AND** 候選保留最高可信度的繁中名稱及必要的英文輔助名稱

#### Scenario: 同代號存在不同交易所
- **WHEN** 不同交易所存在相同 symbol 文字
- **THEN** 系統將它們保留為不同候選
- **AND** 前端清楚顯示各自交易所與市場

#### Scenario: 候選呈現
- **WHEN** 搜尋 API 回傳有繁中與英文名稱的候選
- **THEN** 前端以繁中名稱為主要文字
- **AND** 以英文名稱、symbol、exchange、market／商品類型作為輔助辨識資訊

### Requirement: 選取後明確確認儲存
系統 MUST 在使用者點選搜尋候選時只填入商品設定表單，不得自動寫入個人清單；只有使用者明確按下「儲存商品」後才可持久化。

#### Scenario: 點選搜尋候選
- **WHEN** 使用者點選一個候選商品
- **THEN** 系統填入代號、繁中名稱、分類及 provider
- **AND** 顯示「已填入，確認後再按儲存商品」
- **AND** 此時個人清單尚未變更

#### Scenario: 確認儲存候選
- **WHEN** 使用者檢查表單後按下「儲存商品」
- **THEN** 系統才將商品寫入個人清單

### Requirement: 搜尋來源獨立容錯
系統 MUST 分別處理本機 seed、D1 商品目錄、TWSE、TPEx 及 Yahoo 的錯誤；任何單一來源失敗不得清除其他來源已取得的候選，且 response MUST 提供不含敏感資訊的來源診斷。

#### Scenario: Sites runtime 無法直接連線 TPEx
- **WHEN** Codex Sites runtime 無法取得 TPEx 即時 OpenAPI
- **THEN** 系統仍從最近一次驗證成功的 D1 商品目錄回傳上櫃繁中候選
- **AND** 不依賴 Render 作為 fallback

#### Scenario: Yahoo 搜尋失敗
- **WHEN** Yahoo Search 暫時不可用
- **THEN** 系統仍回傳本機、D1 及官方台股目錄的候選
- **AND** response 提供非阻斷 warning，不覆蓋其他來源診斷

#### Scenario: 商品目錄同步失敗
- **WHEN** 新一輪官方商品目錄同步未通過筆數、代號、名稱或重複資料驗證
- **THEN** 系統拒絕以不完整資料取代目前可用目錄
- **AND** 搜尋繼續使用上一版成功目錄

### Requirement: 正式站搜尋驗收
系統 MUST 以 Codex Site 正式網址驗證繁中商品搜尋的 API 與可見互動，不能只以本機測試或 source code 判定完成。

#### Scenario: 正式站代表查詢
- **WHEN** 新版本部署至正式 Codex Site
- **THEN** 驗收至少涵蓋 `元太`、`8069`、`輝達`、`蘋果`、`日經`、`布蘭特原油`、一個上市 ETF 與一個英文／代號查詢
- **AND** 每個預期候選顯示正確繁中名稱、canonical symbol 與市場資訊

#### Scenario: 正式站確認流程
- **WHEN** 驗收人員在正式站點選候選
- **THEN** 表單正確填入但尚未儲存
- **AND** 按下「儲存商品」後才在個人清單出現
