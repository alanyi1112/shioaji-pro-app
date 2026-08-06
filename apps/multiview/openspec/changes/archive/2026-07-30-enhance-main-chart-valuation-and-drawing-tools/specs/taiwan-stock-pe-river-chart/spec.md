## MODIFIED Requirements

### Requirement: 五年本益比百分位必須可重現

系統 MUST 以截至最新 verified 有效交易日往前五年的所有有限正數 verified 每日本益比，計算 `P5`、`P20`、`P35`、`P50`、`P65`、`P80`、`P95`。樣本 MUST 由小到大排序，並以 `rank = (n - 1) × p` 對相鄰樣本做線性插值；同一 API response 的七個倍率 MUST 固定，不得因 provisional latest row、visible range、縮放或 panel 尺寸改變。

#### Scenario: 五年資料完整
- **WHEN** D1 verified coverage 涵蓋完整五年且有效樣本數至少 252 筆
- **THEN** API MUST 回傳七個依規定算法計算的遞增 percentile multiplier
- **AND** coverage MUST 分別標示 verified 與 display 的實際開始／結束日期、有效樣本數與 `lookbackYears: 5`

#### Scenario: 上市未滿五年但樣本足夠
- **WHEN** 普通股可取得的全部 verified 歷史少於五年但至少有 252 筆有效交易日
- **THEN** 系統 MUST 使用全部可用 verified 樣本計算七個 percentile
- **AND** API 與 UI MUST 明確標示實際 coverage，不得宣稱已涵蓋完整五年

#### Scenario: 有效歷史不足
- **WHEN** verified 正本益比樣本少於 252 筆
- **THEN** API MUST 回傳 `insufficient_history` 與實際樣本數
- **AND** 前端 MUST NOT 以 provisional row 補足門檻或繪製固定倍數河流帶

#### Scenario: provisional P/E 不改變倍率
- **WHEN** response 包含一個或多個 `finmind_provisional_latest` row
- **THEN** P5／P20／P35／P50／P65／P80／P95 MUST 完全排除 provisional P/E
- **AND** provisional tail 只能套用既有 verified multiplier 計算價格座標

#### Scenario: 縮放不改變倍率
- **WHEN** 使用者在相同 response 上縮放或平移到不同 visible range
- **THEN** `P5`／`P20`／`P35`／`P50`／`P65`／`P80`／`P95` multiplier MUST 保持不變
- **AND** 只有各日期 reference EPS 對應的價格座標可以改變

### Requirement: 每日河流價格與缺口必須正確

系統 MUST 以每個有效日期的 verified 或明確標示的 provisional reference EPS 乘以同一組 verified percentile multiplier，產生七條價格界線。缺少有效 reference EPS 的 completed session MUST 保留 gap；不得跨越負獲利、官方缺值、未配對日期或被隔離的 provisional 日期連線。

#### Scenario: 計算單日七條界線
- **WHEN** 某 verified completed session 的 `referenceEps` 為 10，七個 multiplier 分別為 10、12、16、20、25、32、40
- **THEN** 該日七條價格界線 MUST 分別為 100、120、160、200、250、320、400

#### Scenario: 計算 provisional 尾端七條界線
- **WHEN** 某 provisional completed session 的暫定 reference EPS 為 10，verified multiplier 分別為 10、12、16、20、25、32、40
- **THEN** 該日七條價格界線 MUST 同樣為 100、120、160、200、250、320、400
- **AND** overlay MUST 以可辨識的 provisional 樣式與等待確認狀態呈現

#### Scenario: 官方資料中斷
- **WHEN** 相鄰有效日期之間存在一個或多個沒有有效 reference EPS 的 completed session
- **THEN** SVG path／polygon MUST 在缺口前後分段
- **AND** MUST NOT 以直線跨越缺口、forward-fill、插值或視為零

#### Scenario: provisional 發生來源錯配
- **WHEN** 官方到齊後確認 provisional P/E 或 close 超過 `0.01` 容許差
- **THEN** 前端 MUST 移除 provisional 樣式並改用有效官方 row；官方無有效 P/E 時 MUST 顯示 gap
- **AND** MUST NOT 保留錯誤的 provisional 線段或 band

### Requirement: 主圖必須繪製可讀且不攔截互動的河流帶

系統 MUST 在主 K 線後方繪製七條 percentile 邊界及 `P5–P20`、`P20–P35`、`P35–P50`、`P50–P65`、`P65–P80`、`P80–P95` 六個低透明度 SVG band。P5 以下與 P95 以上 MUST NOT 填滿整個 plot；overlay MUST `pointer-events: none`，不得遮蔽 K 線、價格軸、crosshair 或 chart 手勢。各區間 MUST 由低估端冷色、中央中性色至高估端暖色呈現，且不得暗示預測或投資建議。

#### Scenario: 完整資料首次繪製
- **WHEN** 合資格日 K panel 收到完整且樣本足夠的河流 response
- **THEN** 七條線與六個 band MUST 依共同 time／price 座標出現在主 K 線後方
- **AND** 由低至高 MUST 使用可區分但不壓過 K 線的冷色至暖色歷史百分位語意

#### Scenario: 主圖縮放平移與 resize
- **WHEN** 使用者縮放、平移、切換圖數、調整視窗或進出單圖分頁
- **THEN** overlay MUST 以同一 rAF scheduler 重新計算 visible points 的座標
- **AND** 每個有效日期的線與 K 線絕對 X 座標差 MUST 小於或等於 1 CSS px

#### Scenario: dense 多圖保持可讀
- **WHEN** 使用者在 4／6／8 圖版型啟用本益比河流圖
- **THEN** overlay MUST 保持在各自 panel 內並裁切到 plot bounds
- **AND** MUST NOT 增加 panel 高度、形成水平／垂直捲動區或蓋住 toolbar

### Requirement: readout 必須揭示口徑且排除同業比較

作用中的河流圖 MUST 在 pointed date 顯示官方本益比、FinMind 暫代本益比或盤中估算本益比，並依狀態顯示交易所參考 EPS 或暫定參考 EPS、財報年／季可得性、七個 percentile multiplier、股價所在的相鄰歷史百分位區帶、provider、validation status、最後官方日期與顯示日期。API、readout 與 overlay MUST NOT 包含同業平均、產業本益比、同業中位數、同業估值線、forward P/E 或目標價。

#### Scenario: 指向 verified 歷史 completed session
- **WHEN** crosshair 指向具有有效官方估值資料的 completed session
- **THEN** readout MUST 顯示該日官方 P/E、交易所參考 EPS、fiscal year／quarter 與來源日期
- **AND** MUST 顯示相對歷史 percentile 區帶，不得稱為合理價、目標價或買賣訊號

#### Scenario: 指向 provisional completed session
- **WHEN** crosshair 指向等待官方核對的 `finmind_provisional_latest` 日期
- **THEN** readout MUST 顯示「FinMind 暫代本益比」「暫定參考 EPS」「等待交易所確認」與最後官方驗證日期
- **AND** MUST NOT 顯示「官方本益比」、補造 fiscal year／quarter 或暗示交易所已追認

#### Scenario: 當日尚未收盤
- **WHEN** 日 K 含當前未完成 session，且存在最近一筆有效 verified reference EPS
- **THEN** 系統 MUST 以目前價格除以最近 verified reference EPS顯示「盤中估算本益比」並延伸當日河流價格
- **AND** 估算值 MUST NOT 寫入 verified／provisional 逐日估值 table、納入 percentile sample 或標示為官方本益比

#### Scenario: 使用者曾詢問但已排除同業比較
- **WHEN** 河流 API 或 readout 產生資料
- **THEN** response 與可見 UI MUST NOT 出現 peer／industry multiplier、同業平均或產業參考線

### Requirement: 完整 panel PNG 必須包含目前可見河流圖

啟用河流圖時，「儲存此商品所有線圖為圖片」MUST 擷取與畫面相同的 verified／provisional 七條界線、六個 band、主 K 線、目前可見 readout、來源與 provisional 警示；匯出不得因 SVG clone、responsive viewport 或 overflow 計算遺失河流圖，也不得把 provisional 樣式改成官方或加入畫面上不存在的同業資料。

#### Scenario: 匯出只有 verified 河流的單一 panel
- **WHEN** verified 河流圖已完成繪製且使用者匯出該商品所有線圖
- **THEN** PNG MUST 包含完整主圖河流帶、K 線與所有可見副圖
- **AND** 匯出圖中的河流線與 K 線時間／價格位置 MUST 與畫面一致

#### Scenario: 匯出包含 provisional 尾端的 panel
- **WHEN** 畫面顯示 FinMind provisional tail 與等待交易所確認警示
- **THEN** PNG MUST 保留相同 provisional 線型／透明度、暫代 readout、來源與最後官方日期
- **AND** PNG MUST NOT 將暫代值標示為官方值

#### Scenario: 河流圖未啟用或無資料
- **WHEN** checkbox 未勾選、商品不適用或 verified 有效歷史不足
- **THEN** PNG MUST NOT 出現殘留 verified／provisional 河流 band 或 readout
- **AND** 其他既有匯出內容與尺寸 MUST 維持正確
