## ADDED Requirements

### Requirement: Sites 台股個股籌碼資料鏈

系統 MUST 在 Codex Sites／Cloudflare Workers 相容 runtime 中提供台股普通股日頻籌碼、TDCC 週頻股權分散、D1 快取與副圖資料，不得把既有 Render 站作正式依賴，也不得由瀏覽器直接攜帶上游 token。

#### Scenario: Sites Worker 取得個股籌碼
- **WHEN** 正式站請求 eligible `.TW` 或 `.TWO` 普通股的日頻籌碼
- **THEN** 同源 Worker API 從 D1 或允許介接的上游回傳正規化資料
- **AND** response 不導向 Render、不暴露 token 或內部錯誤

#### Scenario: D1 或特定來源暫時不可用
- **WHEN** 某資料族群無法讀取或更新
- **THEN** 其他 K 線、技術指標、清單及可用籌碼族群 MUST 繼續運作
- **AND** 籌碼 API 回傳安全的局部失敗狀態

### Requirement: 多圖籌碼請求必須受快取與併發保護

系統 MUST 讓多個 panel 與同一 panel 的多個籌碼 pane 共用相同 symbol、dataset 與日期範圍的 D1 資料及 single-flight，不得因 1／2／3／4／6／8 圖或方式 B 同時顯示而逐 panel、逐 pane 重複抓取相同上游資料。

#### Scenario: 八個 panel 含重複台股 symbol
- **WHEN** 八圖模式中多個 panel 同時選取相同普通股與籌碼族群
- **THEN** 相同缺口最多產生一個上游請求
- **AND** 各 panel 取得一致的 rows、來源與資料日期

#### Scenario: 背景預取其他商品
- **WHEN** 現有 K 線背景預取排入相鄰商品
- **THEN** 未顯示或未選取籌碼副圖的商品 MUST NOT 自動觸發籌碼歷史回補

#### Scenario: 多個 panel 使用同一 TDCC 週快照
- **WHEN** 多個 panel 同時顯示相同或不同個股的大戶／散戶副圖
- **THEN** Worker MUST 從同一份 D1 全市場週快照提供各 symbol 資料
- **AND** MUST NOT 逐 panel、逐 symbol 重複下載 TDCC 全市場資料

#### Scenario: 同一 panel 的多個 pane 共用 dataset
- **WHEN** 方式 B 同時顯示外資、投信、自營商及三大法人合計四個 pane
- **THEN** 四個 pane MUST 共用同一份 `institutional-flow` response 與 D1 查詢結果
- **AND** MUST NOT 為每個 pane 分別呼叫相同上游

### Requirement: 台股個股籌碼正式部署驗收

系統 MUST 在 build、測試、migration 檢查與 OpenSpec strict validation 通過後才部署籌碼功能，並 MUST 以已登入 Codex Sites 正式站驗證上市與上櫃代表個股的可見副圖及 API。

#### Scenario: 正式站上市與上櫃驗收
- **WHEN** 新版本成功部署至 owner-only Codex Site
- **THEN** 驗收至少涵蓋一檔 `.TW` 與一檔 `.TWO` 普通股的法人、外資持股、融資融券、可用借券及大戶／散戶資料
- **AND** 確認 1／2／3 圖 A／B、4／6／8 圖強制 A、3 圖版面、實際資料日期、單位、來源、時間同步與 hover 讀值

#### Scenario: 正式站不適用與容錯驗收
- **WHEN** 驗收人員切換到非日 K、非台股商品、缺欄位或模擬來源失敗
- **THEN** 畫面顯示正確的不適用／部分／過期狀態
- **AND** K 線、既有技術副圖與其他 panel 不受影響
