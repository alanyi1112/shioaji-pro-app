# taiwan-stock-pe-river-chart Specification

## Purpose
TBD - created by archiving change add-taiwan-stock-pe-river-chart. Update Purpose after archive.
## Requirements
### Requirement: 主圖提供按需的本益比河流圖選項

系統 MUST 在每個 chart panel 的「主圖」選單提供預設未勾選的「本益比河流圖」checkbox；只有使用者勾選時才能要求本益比河流資料，且不得改變均線、布林、成交量、FVG、Volume Profile 或副圖的既有選取狀態。

#### Scenario: 預設不載入河流資料
- **WHEN** 使用者開啟頁面且未勾選「本益比河流圖」
- **THEN** 主 K 線與其他指標 MUST 依既有行為載入
- **AND** 前端 MUST NOT 發出本益比河流圖 API request 或建立河流 overlay

#### Scenario: 勾選支援商品的日 K
- **WHEN** 使用者在符合資格的台灣普通股日 K panel 勾選「本益比河流圖」
- **THEN** 系統 MUST 按需讀取該 canonical symbol 的估值 coverage 與河流資料
- **AND** 一般 `/api/candles` request MUST NOT 因此被替換、阻塞或擴增為五年估值 payload

### Requirement: 商品與週期適用性必須保守判定

系統 MUST 只對 TWSE／TPEx 上市或上櫃普通股的 `1d` K 線提供本益比河流圖。`.TW`／`.TWO` suffix 只能作為市場候選，系統 MUST 再使用 canonical 商品 metadata 與官方資料存在性判定資格；ETF、ETN、TDR、指數、特別股、加密貨幣、其他非普通股及非日 K MUST 視為不適用。

#### Scenario: ETF 不得顯示河流圖
- **WHEN** 使用者查看 `0050.TW` 或其他識別為 ETF 的商品
- **THEN** 系統 MUST NOT 只因 symbol 以 `.TW` 結尾而將其判為普通股
- **AND** checkbox／狀態 MUST 顯示此商品不適用，且不得產生百分位價格帶

#### Scenario: 普通股切到非日 K
- **WHEN** 已勾選河流圖的普通股 panel 從 `1d` 切換為盤中、週 K 或月 K
- **THEN** 系統 MUST 暫停並清除河流 overlay、readout 與輪詢
- **AND** MUST 顯示 `unsupported_interval` 對應的安全說明，不得把日資料錯貼到其他週期

#### Scenario: 返回符合資格的日 K
- **WHEN** 使用者保留河流圖選取意圖並切回符合資格的普通股 `1d`
- **THEN** 系統 MUST 重新檢查 coverage 並載入正確 symbol 的河流資料
- **AND** 先前不適用商品的資料 MUST NOT 殘留

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

### Requirement: D1 coverage 與背景回補必須耐久且不阻塞

系統 MUST 使用 D1 保存逐日估值 row、fetch state 與可續跑的月份 checkpoint／job。首次或 partial coverage 查詢 MUST 立即回傳目前狀態並建立或重用限速背景回補；相同 symbol 的多 panel／重複勾選 MUST dedupe，且不得在單一 panel request 內無界並行完整五年上游呼叫。

#### Scenario: 完整 coverage 命中 D1
- **WHEN** D1 已涵蓋所需月份且最新官方資料仍新鮮
- **THEN** API MUST 從 D1 回傳河流資料
- **AND** MUST NOT 重抓已完成月份或建立重複 job

#### Scenario: 首次勾選尚無五年資料
- **WHEN** 合資格 symbol 的 D1 coverage 為空或不足
- **THEN** API MUST 回傳 `backfill.status`、requested／actual coverage 與目前進度
- **AND** MUST 建立或重用單一 durable job，前端 K 線 MUST 繼續可見且可互動

#### Scenario: partial coverage 只補缺月
- **WHEN** D1 已有部分月份且存在 missing months
- **THEN** job MUST 只排入缺少或需刷新月份
- **AND** completed checkpoint MUST 以冪等 upsert 保存，retry 不得重複或刪除既有有效 row

#### Scenario: 上游暫時限流
- **WHEN** 官方來源回應 429、retryable 5xx 或暫時連線失敗
- **THEN** job MUST 保存安全 reason code、attempt 與 bounded `retryAfter`
- **AND** 其他 symbol、K 線與已快取河流資料 MUST 繼續可用，前端不得看到秘密或原始上游錯誤內容

#### Scenario: 未確認自動化規範
- **WHEN** 官方來源的自動化、頻率、歷史範圍或再利用規範尚未取得可驗證依據
- **THEN** production backfill MUST 維持停用或 blocked
- **AND** 系統 MUST NOT 改以未授權 scraping 或第三方資料悄悄替代

### Requirement: 主圖必須繪製可讀且不攔截互動的河流帶

系統 MUST 在主 K 線後方繪製七條 percentile 邊界及 `P5–P20`、`P20–P35`、`P35–P50`、`P50–P65`、`P65–P80`、`P80–P95` 六個低透明度 SVG band。P5 以下與 P95 以上 MUST NOT 填滿整個 plot；overlay MUST `pointer-events: none`，不得遮蔽 K 線、價格軸、crosshair 或 chart 手勢。P50 邊界 MUST 使用 1.4 CSS px，其他六條邊界 MUST 使用 1 CSS px 彩色實線；provisional 尾端 MUST 維持相同線寬但使用虛線、較低透明度與既有狀態文字。七條線 MUST 在 plot 左側各顯示同色框線標籤，格式為 `—Pxx N.NNx—`；空間足夠時標籤 MUST 垂直置中於對應線條，線距不足時 MUST 依價格順序避讓且以同色 1px 短連接線維持對應關係。各區間 MUST 由低估端冷色、中央中性色至高估端暖色呈現，且不得暗示預測或投資建議。

#### Scenario: 完整 verified 資料首次繪製
- **WHEN** 合資格日 K panel 收到完整且樣本足夠的 verified 河流 response
- **THEN** 七條線與六個 band MUST 依共同 time／price 座標出現在主 K 線後方
- **AND** P50 MUST 為 1.4 CSS px，其他線 MUST 為 1 CSS px 彩色實線
- **AND** 七個 multiplier 標籤 MUST 使用對應線條顏色、1px 框線與 `—Pxx N.NNx—` 文字顯示在 plot 左側
- **AND** multiplier 接近時七個標籤框 MUST 不互相重疊，並以同色短連接線指出各自河流線

#### Scenario: provisional 尾端保持可辨識
- **WHEN** 河流圖含 `finmind_provisional_latest` 尾端
- **THEN** provisional P50 MUST 維持 1.4 CSS px，其他 provisional 線 MUST 維持 1 CSS px，且全部 MUST 使用虛線與較低透明度
- **AND** UI MUST 保留等待交易所確認的狀態文字，不得將 provisional 尾端呈現為 verified 實線

#### Scenario: 主圖縮放平移與 resize
- **WHEN** 使用者縮放、平移、切換圖數、調整視窗或進出單圖分頁
- **THEN** overlay MUST 以同一 rAF scheduler 重新計算 visible points 的座標
- **AND** 每個有效日期的線與 K 線絕對 X 座標差 MUST 小於或等於 1 CSS px
- **AND** 七個標籤 MUST 重新定位到目前顯示區左側；若需避碰 MUST 重算排列與各自短連接線

#### Scenario: dense 多圖保持可讀
- **WHEN** 使用者在 4／6／8 圖版型啟用本益比河流圖
- **THEN** overlay MUST 保持在各自 panel 內並裁切到 plot bounds
- **AND** MUST NOT 增加 panel 高度、形成水平／垂直捲動區或蓋住 toolbar

### Requirement: 快速切換與取消必須 latest-wins 且完整清理

每個 panel MUST 以 canonical symbol、interval 與 load token 驗證河流 response。取消勾選、切換商品／週期、重建或銷毀 panel 時，系統 MUST abort request／poll、取消待執行 rAF、移除 overlay／右鍵詳細說明／status 及 listener；晚到 response MUST NOT 污染新的 panel 狀態。

#### Scenario: 載入中取消勾選
- **WHEN** 河流資料或 backfill 狀態仍在載入，使用者取消勾選
- **THEN** 前端 MUST 立即保留 K 線並移除河流載入狀態與右鍵詳細說明資料
- **AND** 後續晚到 response MUST NOT 重新建立 overlay 或詳情

#### Scenario: 快速切換商品
- **WHEN** 使用者在 symbol A 的河流 request 完成前切到 symbol B
- **THEN** symbol A response MUST 被丟棄
- **AND** symbol B panel MUST 只顯示 B 的 coverage、右鍵詳情與河流圖

#### Scenario: 河流來源失敗
- **WHEN** 河流 API、background job 或來源暫時失敗
- **THEN** panel MUST 顯示安全且可診斷的河流狀態
- **AND** 主 K 線、其他主圖指標、副圖、即時連線與 panel 操作 MUST 維持可用

### Requirement: 完整 panel PNG 必須包含目前可見河流圖

啟用河流圖時，「儲存此商品所有線圖為圖片」MUST 擷取與畫面相同的 verified／provisional 七條界線、六個 band、七個同色框線標籤、主 K 線與目前可見的 provisional 狀態提示；匯出不得因 SVG clone、responsive viewport 或 overflow 計算遺失河流圖，也不得把 provisional 樣式改成官方或加入畫面上不存在的同業資料。右鍵選單及其中的詳細說明 MUST 維持 export-excluded，不得因匯出而自動展開。

#### Scenario: 匯出只有 verified 河流的單一 panel
- **WHEN** verified 河流圖已完成繪製且使用者匯出該商品所有線圖
- **THEN** PNG MUST 包含完整主圖河流帶、七條線、七個 multiplier 標籤、K 線與所有可見副圖
- **AND** 匯出圖中的河流線與 K 線時間／價格位置 MUST 與畫面一致

#### Scenario: 匯出包含 provisional 尾端的 panel
- **WHEN** 畫面顯示 FinMind provisional tail 與等待交易所確認警示
- **THEN** PNG MUST 保留相同 provisional 線型／透明度、七個線上標籤與可見狀態提示
- **AND** PNG MUST NOT 將暫代值標示為官方值或加入未展開的右鍵詳情

#### Scenario: 河流圖未啟用或無資料
- **WHEN** checkbox 未勾選、商品不適用或 verified 有效歷史不足
- **THEN** PNG MUST NOT 出現殘留 verified／provisional 河流 band、線上標籤或右鍵詳情
- **AND** 其他既有匯出內容與尺寸 MUST 維持正確

### Requirement: API 與資料攝取必須安全且可驗證

河流 API 與私有 ingest／workflow MUST 遵守既有 Sites 使用者與秘密邊界。前端只能讀取公開可揭示的來源 metadata 與安全 reason code；private ingest MUST 驗證授權、canonical symbol、單一月份／日期範圍、合理 row count、唯一交易日、有限正數欄位與 payload 大小，且不得記錄或回傳 token、cookie、憑證或原始秘密。

#### Scenario: 未授權 ingest
- **WHEN** request 未同時通過 Sites 身分／bypass 與估值 ingest 授權檢查
- **THEN** 系統 MUST fail closed 且不得寫入 D1
- **AND** response／log MUST NOT 洩漏期望 secret 或驗證細節

#### Scenario: 官方 payload schema 漂移
- **WHEN** 欄位名稱、日期、代號、財報年／季或數值格式無法通過 parser allowlist 與完整性檢查
- **THEN** 系統 MUST 拒絕該批寫入並保存安全 `schema_mismatch` 狀態
- **AND** MUST 保留既有有效 coverage，不得以 requested end date 偽造成功

#### Scenario: 健康狀態只揭示安全摘要
- **WHEN** health／debug 查詢回傳估值 coverage 或 job 狀態
- **THEN** response MUST 包含 target、ready、pending、blocked、retry waiting、coverage 與最後成功日期
- **AND** MUST NOT 包含帳號、token、cookie、完整上游錯誤 body 或內部秘密

### Requirement: 右鍵詳細說明必須揭示口徑且排除同業比較

作用中的河流圖 MUST 移除主圖左上角常駐詳情 readout，並在目前 pointed date 有可用估值詳情時，於 panel 滑鼠右鍵選單顯示「本益比河流圖詳細說明」。該項目 MUST 預設收合，只有使用者點擊後才展開官方本益比、FinMind 暫代本益比或盤中估算本益比，並依狀態顯示交易所參考 EPS 或暫定參考 EPS、財報年／季可得性、七個 percentile multiplier、股價所在區帶、provider、validation status、最後官方日期與顯示日期。API、詳細說明與 overlay MUST NOT 包含同業平均、產業本益比、同業中位數、同業估值線、forward P/E 或目標價。

#### Scenario: 指向 verified 歷史 completed session
- **WHEN** 使用者在具有有效官方估值資料的 completed session 開啟右鍵選單並點擊「本益比河流圖詳細說明」
- **THEN** 展開內容 MUST 顯示該日官方 P/E、交易所參考 EPS、fiscal year／quarter 與來源日期
- **AND** MUST 顯示七個 multiplier 與相對歷史 percentile 區帶，不得稱為合理價、目標價或買賣訊號

#### Scenario: 指向 provisional completed session
- **WHEN** 使用者在等待官方核對的 `finmind_provisional_latest` 日期展開詳細說明
- **THEN** 詳情 MUST 顯示「FinMind 暫代本益比」「暫定參考 EPS」「等待交易所確認」與最後官方驗證日期
- **AND** MUST NOT 顯示「官方本益比」、補造 fiscal year／quarter 或暗示交易所已追認

#### Scenario: 當日尚未收盤
- **WHEN** 日 K 含當前未完成 session，且存在最近一筆有效 verified reference EPS
- **THEN** 系統 MUST 以目前價格除以最近 verified reference EPS，在右鍵詳細說明顯示「盤中估算本益比」並延伸當日河流價格
- **AND** 估算值 MUST NOT 寫入 verified／provisional 逐日估值 table、納入 percentile sample 或標示為官方本益比

#### Scenario: 詳情預設不佔主圖空間
- **WHEN** 河流圖已啟用但使用者尚未點擊右鍵詳細說明
- **THEN** 主圖左上角 MUST NOT 顯示本益比、參考 EPS、財報、multiplier、區帶、來源、授權或 coverage 常駐文字
- **AND** 右鍵選單中的詳細內容 MUST 維持收合

#### Scenario: 使用者曾詢問但已排除同業比較
- **WHEN** 河流 API、詳細說明或 overlay 產生資料
- **THEN** response 與可見 UI MUST NOT 出現 peer／industry multiplier、同業平均或產業參考線
