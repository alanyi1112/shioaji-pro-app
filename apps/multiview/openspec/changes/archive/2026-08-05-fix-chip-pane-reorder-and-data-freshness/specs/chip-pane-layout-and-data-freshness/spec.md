## ADDED Requirements

### Requirement: 副圖群組重排後保留圖表 viewport 與游標座標

系統 MUST 在副圖資料群組執行「置頂」、「置底」或拖曳排序前保存時間錨點式 viewport snapshot，並在 DOM 重排及 chart resize 完成後還原同一個資料時間範圍與右側貼齊狀態。重排後共用游標對同一根 K 棒的 X 座標偏差 MUST 不超過 1 CSS px。

#### Scenario: 副圖置頂不產生左側空白

- **WHEN** 使用者在多層副圖以右鍵將非第一個資料群組「置頂」
- **THEN** 主圖與所有資料副圖仍顯示原本的時間範圍，不因暫時 logical range 或 canvas 尺寸變化在左側產生額外空白

#### Scenario: 副圖置頂後游標維持對齊

- **WHEN** 使用者在重排前已將游標放在一根可見 K 棒，且完成群組置頂
- **THEN** 主圖、技術副圖與籌碼副圖的共用游標仍指向同一根 K 棒，任兩個可見 plot 的 X 座標差異不超過 1 CSS px

### Requirement: 籌碼資料提示依資料集使用可辨識色彩

系統 MUST 保留 API `warnings[]` 的逐筆邊界，並將已知資料集的提示以穩定且互不混淆的色彩呈現；跨資料集或未知 warning MUST 使用中性色。提示文字 MUST 以純文字渲染，且關閉按鈕 MUST 只關閉目前相同內容與 context 的提示。

#### Scenario: 多筆資料集提示不再全部使用橘黃色

- **WHEN** API 回傳外資持股、融資融券及借券等兩筆以上 warning
- **THEN** 畫面以多個獨立文字片段呈現，已知資料集片段具有不同的資料集色彩，且每筆完整說明仍可閱讀

#### Scenario: 使用者關閉提示後不影響其他資料集

- **WHEN** 使用者關閉目前 warning 提示，之後資料內容或 symbol context 改變
- **THEN** 新的 warning signature 仍可重新顯示，且關閉不會刪除或改寫任何資料列

### Requirement: 籌碼資料不得超前於最近已完成交易日

籌碼 API MUST 以台北時間最近已完成交易日封頂 requested end；在既有發布截止時間前，今日信用交易來源資料 MUST NOT 進入 response rows、coverage end、D1 refresh 或副圖 series。服務 MUST 保留實際 source date 與 availability 狀態，不得以 K 棒日期補造信用交易資料。

#### Scenario: 交易日上午或盤中請求今日信用交易資料

- **WHEN** requested end 是今日且台北時間尚未到籌碼資料發布截止時間
- **THEN** API 的有效查詢終點回退至最近已完成交易日，response 不含今日 `margin-short` row，副圖今日位置顯示缺值或最近一筆而非今日數值

#### Scenario: 發布截止後請求今日信用交易資料

- **WHEN** requested end 是今日且台北時間已到發布截止時間，來源回傳今日資料
- **THEN** API 可以保存並回傳今日資料，且 `sessionDate`、`sourceDate`、coverage end 與 readout 日期均為今日

#### Scenario: 游標落在尚未發布的今日 K 棒

- **WHEN** K 線已有今日盤中資料，但信用交易資料尚未有今日 row
- **THEN** 信用交易 readout 顯示游標日期的「當日無資料」狀態，最近一筆資料若存在則另標示其真實日期，不將最近一筆數值標成今日

### Requirement: 修正維持既有資料與部署邊界

本變更 MUST 不新增 D1 schema、不改變資料來源授權、不提交秘密資料，並 MUST 維持 6／8 圖單一副圖與既有多層副圖 eligible context 政策。

#### Scenario: 修正不改變未相關的圖表政策

- **WHEN** 使用者在非台股、非日 K、6 圖或 8 圖模式載入頁面
- **THEN** 系統維持既有不可用或單一副圖行為，且不啟用本變更的多層重排協調
