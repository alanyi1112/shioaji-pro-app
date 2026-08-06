## MODIFIED Requirements

### Requirement: 參考 EPS 必須使用同日官方資料

系統 MUST 對 verified completed session 使用經確認可自動化的 TWSE／TPEx 官方同日資料計算交易所參考 EPS。只有官方 OpenAPI 暫時落後且 `provisional-pe-river-latest-fallback` 全部安全條件成立時，才能以相同市場、canonical symbol 與 `sessionDate` 的 FinMind P/E／close 計算明確標示的暫定參考 EPS；provisional row MUST 保留實際 provider、validation status、source date 與 fetched timestamp，且不得冒充官方資料。

#### Scenario: 同日官方資料成功配對
- **WHEN** 官方資料對相同普通股與 `sessionDate` 提供有限正數收盤價及有限正數本益比
- **THEN** `referenceEps` MUST 等於 `officialClose / officialPeRatio`
- **AND** API MUST 回傳可追溯的 exchange、source、session date 與 fiscal year／quarter

#### Scenario: 官方延遲且同日 FinMind 暫代資料有效
- **WHEN** 官方 OpenAPI 落後，且相同普通股與 completed `sessionDate` 的 FinMind P/E／close 通過 provisional 規則
- **THEN** `provisionalReferenceEps` MUST 等於 `finmindClose / finmindPeRatio`
- **AND** API／UI MUST 標示為「暫定參考 EPS」與等待交易所確認，不得標示為交易所已驗證 EPS

#### Scenario: 不同日期不得混算
- **WHEN** 收盤價與本益比的股票、交易所或 `sessionDate` 任一不一致
- **THEN** 系統 MUST NOT 產生該日 verified 或 provisional `referenceEps`
- **AND** MUST 使用安全 reason code 表示無法同日配對，不得沿用另一交易日數值

#### Scenario: 本益比為零負數或空白
- **WHEN** 本益比為空、`-`、零、負數、非有限值，或官方因每股參考稅後純益非正數而不計算本益比
- **THEN** 該日 MUST 保留缺口且不得納入百分位樣本
- **AND** 系統 MUST NOT 將其轉成零、固定倍率、財報基本 EPS 或預估 EPS

#### Scenario: 歷史資料維持 point-in-time
- **WHEN** 公司後來公布新財報、重編資料或參考股數改變
- **THEN** 系統 MUST 使用每個 verified 歷史日期當時官方揭示的本益比與財報年／季
- **AND** MUST NOT 以較晚發布的財報回填較早日期或製造 look-ahead

### Requirement: 五年本益比百分位必須可重現

系統 MUST 以截至最新 verified 有效交易日往前五年的所有有限正數 verified 每日本益比，計算 `P10`、`P30`、`P50`、`P70`、`P90`。樣本 MUST 由小到大排序，並以 `rank = (n - 1) × p` 對相鄰樣本做線性插值；同一 API response 的五個倍率 MUST 固定，不得因 provisional latest row、visible range、縮放或 panel 尺寸改變。

#### Scenario: 五年資料完整
- **WHEN** D1 verified coverage 涵蓋完整五年且有效樣本數至少 252 筆
- **THEN** API MUST 回傳五個依規定算法計算的遞增 percentile multiplier
- **AND** coverage MUST 分別標示 verified 與 display 的實際開始／結束日期、有效樣本數與 `lookbackYears: 5`

#### Scenario: 上市未滿五年但樣本足夠
- **WHEN** 普通股可取得的全部 verified 歷史少於五年但至少有 252 筆有效交易日
- **THEN** 系統 MUST 使用全部可用 verified 樣本計算五個 percentile
- **AND** API 與 UI MUST 明確標示實際 coverage，不得宣稱已涵蓋完整五年

#### Scenario: 有效歷史不足
- **WHEN** verified 正本益比樣本少於 252 筆
- **THEN** API MUST 回傳 `insufficient_history` 與實際樣本數
- **AND** 前端 MUST NOT 以 provisional row 補足門檻或繪製固定倍數河流帶

#### Scenario: provisional P/E 不改變倍率
- **WHEN** response 包含一個或多個 `finmind_provisional_latest` row
- **THEN** P10／P30／P50／P70／P90 MUST 完全排除 provisional P/E
- **AND** provisional tail 只能套用既有 verified multiplier 計算價格座標

#### Scenario: 縮放不改變倍率
- **WHEN** 使用者在相同 response 上縮放或平移到不同 visible range
- **THEN** `P10`／`P30`／`P50`／`P70`／`P90` multiplier MUST 保持不變
- **AND** 只有各日期 reference EPS 對應的價格座標可以改變

### Requirement: 每日河流價格與缺口必須正確

系統 MUST 以每個有效日期的 verified 或明確標示的 provisional reference EPS 乘以同一組 verified percentile multiplier，產生五條價格界線。缺少有效 reference EPS 的 completed session MUST 保留 gap；不得跨越負獲利、官方缺值、未配對日期或被隔離的 provisional 日期連線。

#### Scenario: 計算單日五條界線
- **WHEN** 某 verified completed session 的 `referenceEps` 為 10，五個 multiplier 分別為 12、16、20、25、32
- **THEN** 該日五條價格界線 MUST 分別為 120、160、200、250、320

#### Scenario: 計算 provisional 尾端五條界線
- **WHEN** 某 provisional completed session 的暫定 reference EPS 為 10，verified multiplier 分別為 12、16、20、25、32
- **THEN** 該日五條價格界線 MUST 同樣為 120、160、200、250、320
- **AND** overlay MUST 以可辨識的 provisional 樣式與等待確認狀態呈現

#### Scenario: 官方資料中斷
- **WHEN** 相鄰有效日期之間存在一個或多個沒有有效 reference EPS 的 completed session
- **THEN** SVG path／polygon MUST 在缺口前後分段
- **AND** MUST NOT 以直線跨越缺口、forward-fill、插值或視為零

#### Scenario: provisional 發生來源錯配
- **WHEN** 官方到齊後確認 provisional P/E 或 close 超過 `0.01` 容許差
- **THEN** 前端 MUST 移除 provisional 樣式並改用有效官方 row；官方無有效 P/E 時 MUST 顯示 gap
- **AND** MUST NOT 保留錯誤的 provisional 線段或 band

### Requirement: readout 必須揭示口徑且排除同業比較

作用中的河流圖 MUST 在 pointed date 顯示官方本益比、FinMind 暫代本益比或盤中估算本益比，並依狀態顯示交易所參考 EPS 或暫定參考 EPS、財報年／季可得性、五個 percentile multiplier、股價所在區帶、provider、validation status、最後官方日期與顯示日期。API、readout 與 overlay MUST NOT 包含同業平均、產業本益比、同業中位數、同業估值線、forward P/E 或目標價。

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

啟用河流圖時，「儲存此商品所有線圖為圖片」MUST 擷取與畫面相同的 verified／provisional 五條界線、四個 band、主 K 線、目前可見 readout、來源與 provisional 警示；匯出不得因 SVG clone、responsive viewport 或 overflow 計算遺失河流圖，也不得把 provisional 樣式改成官方或加入畫面上不存在的同業資料。

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
