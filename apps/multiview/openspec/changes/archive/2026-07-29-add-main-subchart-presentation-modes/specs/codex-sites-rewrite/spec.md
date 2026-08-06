## MODIFIED Requirements

### Requirement: 台股個股籌碼正式部署驗收

系統 MUST 在 build、測試、migration 檢查與 OpenSpec strict validation 通過後才部署籌碼與主副圖模式功能，並 MUST 以已登入 Codex Sites 正式站驗證三模式、上市／上櫃代表普通股與 ETF 的可見副圖及 API。正式 HTML MUST 引用本次發布的最新 `app.js` 與 `styles.css` cache-buster，不得以瀏覽器舊資產作為驗收結果。

#### Scenario: 正式站普通股與三模式驗收
- **WHEN** 新版本成功部署至 owner-only Codex Site
- **THEN** 驗收至少涵蓋一檔 `.TW` 與一檔 `.TWO` 普通股的法人、外資持股、融資融券、可用借券及大戶／散戶資料
- **AND** 確認 1／2／3／4／6／8 圖的主圖、方式 A、方式 B，主圖模式副圖列收合且無不可見籌碼 request，方式 B 使用 document scroll
- **AND** 確認三模式切換不重新請求主 candles，並保留技術副圖、籌碼選取、series 與群組順序
- **AND** 確認多圖 panel 雙擊會在新分頁顯示正確商品的 1 圖，且原分頁狀態不變
- **AND** 確認台股單一商品頁三模式皆可用，資格只依目標商品判斷

#### Scenario: 正式站非台股與混合頁籤驗收
- **WHEN** 正式站載入非台股單一商品、非台股頁籤或台股與非台股混合頁籤
- **THEN** 主副圖下拉選單 MUST 保持可操作，主圖與單一副圖 MUST 可切換，多層副圖 MUST disabled
- **AND** 主圖模式 MUST 收合副圖並停止不可見副圖 lifecycle，單一副圖 MUST 保留既有技術副圖行為
- **AND** 返回 eligible 台股後 MUST 恢復先前保存的 multi 偏好與 pane 狀態

#### Scenario: 正式站 ETF 驗收
- **WHEN** 正式站載入至少一檔上市 ETF 及一檔可用的上櫃 ETF
- **THEN** 每個可用 dataset MUST 顯示真實資料，不可用 dataset MUST 顯示獨立原因
- **AND** 大戶／散戶 MUST 標示 TDCC 週資料、比例線、週變化柱與實際資料日期

#### Scenario: 正式站不適用與容錯驗收
- **WHEN** 驗收人員切換到主圖模式、非日 K、非台股商品、缺欄位或模擬來源失敗
- **THEN** 畫面 MUST 顯示正確的主圖-only／不適用／部分／過期狀態
- **AND** K 線、既有主圖工具、其他 panel 與保存副圖偏好 MUST 不受影響
- **AND** console MUST 沒有未處理錯誤，頁面與 panel MUST 沒有非預期水平或內層垂直捲動
