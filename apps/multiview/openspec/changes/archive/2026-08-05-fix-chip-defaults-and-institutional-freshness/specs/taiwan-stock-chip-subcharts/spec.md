## ADDED Requirements

### Requirement: 多層籌碼副圖首次預設不勾選集保戶數

系統 MUST 在尚無該頁籤與商品保存選擇的多層副圖首次狀態，預設選取既有籌碼 pane，但 MUST 將 `tdcc-holder-count`「集保戶數」保持未勾選。系統 MUST 保留使用者手動勾選、持股比群組全選及既有已保存選擇，不得以預設調整強制清除客製狀態。

#### Scenario: 新商品首次進入多層副圖
- **WHEN** 使用者首次在 eligible 台股商品進入多層副圖，且該頁籤與商品沒有保存 pane 選擇
- **THEN** 「集保戶數」checkbox MUST 未勾選，且畫面 MUST NOT 建立集保戶數 pane
- **AND** 大戶持股與散戶持股 MUST 維持既有預設選取

#### Scenario: 既有使用者已勾選集保戶數
- **WHEN** 該頁籤與商品的保存選擇已包含 `tdcc-holder-count`
- **THEN** 系統 MUST 保留該選擇並建立集保戶數 pane

#### Scenario: 使用持股比群組全選
- **WHEN** 使用者明確勾選持股比群組主項
- **THEN** 系統 MUST 同時選取大戶持股、散戶持股與集保戶數

## MODIFIED Requirements

### Requirement: 籌碼資料不得超前於最近已完成交易日

籌碼 API MUST 只以資料來源 payload 內可驗證的實際日期決定 row 日期與最新 coverage；三大法人、融資券及其他日籌碼資料只要取得合法 requested end row 就 MUST 立即顯示，不得等待固定發布時間。來源尚未發布 requested end 時，服務 MUST 保留前一筆實際 source date 與 availability 狀態，不得以 K 棒日期、requested end、無日期快照或前一日數值補造任何籌碼資料。

#### Scenario: 任一時間取得今日融資券資料
- **WHEN** requested end 是今日，且來源回傳可驗證日期為今日的 `margin-short` row
- **THEN** API 與副圖 MUST 立即顯示今日融資券資料，不得等待 22:00 或其他固定時間

#### Scenario: 今日融資券尚未發布
- **WHEN** requested end 是今日，但來源最新可驗證融資券日期仍為前一交易日
- **THEN** 副圖 MUST 只將前一交易日資料標示為前一交易日，今日位置 MUST 顯示「當日無資料」
- **AND** MUST NOT 複製前一交易日數值形成今日 row，或讓連續兩日顯示相同的偽造資料

#### Scenario: 官方已發布今日三大法人資料
- **WHEN** requested end 是今日，且 TWSE 或 TPEx 官方來源已發布可驗證日期為今日的資料
- **THEN** API MUST 保存並回傳今日 `institutional-flow`，三大法人副圖 MUST 顯示今日實際數值與來源日期
- **AND** 顯示時機 MUST 不受融資券或其他資料集狀態影響

#### Scenario: 游標落在尚未發布的今日 K 棒
- **WHEN** K 線已有今日盤中資料，但某籌碼資料集尚未有今日 row
- **THEN** 該資料集 readout 顯示游標日期的「當日無資料」狀態，最近一筆資料若存在則另標示其真實日期，不將最近一筆數值標成今日
