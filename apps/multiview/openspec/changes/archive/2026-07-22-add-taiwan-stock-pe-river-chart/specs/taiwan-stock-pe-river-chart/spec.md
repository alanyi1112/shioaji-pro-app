## ADDED Requirements

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

系統 MUST 只以經確認可自動化使用的 TWSE／TPEx 官方歷史資料計算河流圖。每個 completed session 的交易所參考 EPS MUST 以相同市場、canonical symbol 與 `sessionDate` 的官方收盤價除以官方本益比；row MUST 保留財報年／季、實際來源、source date 與 fetched timestamp。

#### Scenario: 同日資料成功配對
- **WHEN** 官方資料對相同普通股與 `sessionDate` 提供有限正數收盤價及有限正數本益比
- **THEN** `referenceEps` MUST 等於 `officialClose / officialPeRatio`
- **AND** API MUST 回傳可追溯的 exchange、source、session date 與 fiscal year／quarter

#### Scenario: 不同日期不得混算
- **WHEN** 官方收盤價與官方本益比的股票、交易所或 `sessionDate` 任一不一致
- **THEN** 系統 MUST NOT 產生該日 `referenceEps`
- **AND** MUST 使用安全 reason code 表示無法同日配對，不得沿用另一交易日數值

#### Scenario: 本益比為零負數或空白
- **WHEN** 官方本益比為空、`-`、零、負數、非有限值，或官方因每股參考稅後純益非正數而不計算本益比
- **THEN** 該日 MUST 保留缺口且不得納入百分位樣本
- **AND** 系統 MUST NOT 將其轉成零、固定倍率、財報基本 EPS 或預估 EPS

#### Scenario: 歷史資料維持 point-in-time
- **WHEN** 公司後來公布新財報、重編資料或參考股數改變
- **THEN** 系統 MUST 使用每個歷史日期當時官方揭示的本益比與財報年／季
- **AND** MUST NOT 以較晚發布的財報回填較早日期或製造 look-ahead

### Requirement: 五年本益比百分位必須可重現

系統 MUST 以截至最新官方有效交易日往前五年的所有有限正數每日本益比，計算 `P10`、`P30`、`P50`、`P70`、`P90`。樣本 MUST 由小到大排序，並以 `rank = (n - 1) × p` 對相鄰樣本做線性插值；同一 API response 的五個倍率 MUST 固定，不得隨 visible range、縮放或 panel 尺寸改變。

#### Scenario: 五年資料完整
- **WHEN** D1 coverage 涵蓋完整五年且有效樣本數至少 252 筆
- **THEN** API MUST 回傳五個依規定算法計算的遞增 percentile multiplier
- **AND** coverage MUST 標示實際開始、結束日期、有效樣本數與 `lookbackYears: 5`

#### Scenario: 上市未滿五年但樣本足夠
- **WHEN** 普通股可取得的全部官方歷史少於五年但至少有 252 筆有效交易日
- **THEN** 系統 MUST 使用全部可用有效樣本計算五個 percentile
- **AND** API 與 UI MUST 明確標示實際 coverage，不得宣稱已涵蓋完整五年

#### Scenario: 有效歷史不足
- **WHEN** 可用正本益比樣本少於 252 筆
- **THEN** API MUST 回傳 `insufficient_history` 與實際樣本數
- **AND** 前端 MUST NOT 繪製固定倍數、部分樣本偽裝的河流帶或投資判斷文案

#### Scenario: 縮放不改變倍率
- **WHEN** 使用者在相同 response 上縮放或平移到不同 visible range
- **THEN** `P10`／`P30`／`P50`／`P70`／`P90` multiplier MUST 保持不變
- **AND** 只有各日期參考 EPS 對應的價格座標可以改變

### Requirement: 每日河流價格與缺口必須正確

系統 MUST 以每個有效日期的 `referenceEps × percentile multiplier` 產生五條價格界線。缺少有效 reference EPS 的 completed session MUST 保留 gap；不得跨越負獲利、官方缺值或未配對日期連線。

#### Scenario: 計算單日五條界線
- **WHEN** 某 completed session 的 `referenceEps` 為 10，五個 multiplier 分別為 12、16、20、25、32
- **THEN** 該日五條價格界線 MUST 分別為 120、160、200、250、320

#### Scenario: 官方資料中斷
- **WHEN** 相鄰有效日期之間存在一個或多個沒有有效 reference EPS 的 completed session
- **THEN** SVG path／polygon MUST 在缺口前後分段
- **AND** MUST NOT 以直線跨越缺口、forward-fill、插值或視為零

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

系統 MUST 在主 K 線後方繪製五條 percentile 邊界及 `P10–P30`、`P30–P50`、`P50–P70`、`P70–P90` 四個低透明度 SVG band。P10 以下與 P90 以上 MUST NOT 填滿整個 plot；overlay MUST `pointer-events: none`，不得遮蔽 K 線、價格軸、crosshair 或 chart 手勢。

#### Scenario: 完整資料首次繪製
- **WHEN** 合資格日 K panel 收到完整且樣本足夠的河流 response
- **THEN** 五條線與四個 band MUST 依共同 time／price 座標出現在主 K 線後方
- **AND** 由低至高 MUST 使用可區分但不壓過 K 線的綠至橘紅色語意

#### Scenario: 主圖縮放平移與 resize
- **WHEN** 使用者縮放、平移、切換圖數、調整視窗或進出單圖分頁
- **THEN** overlay MUST 以同一 rAF scheduler 重新計算 visible points 的座標
- **AND** 每個有效日期的線與 K 線絕對 X 座標差 MUST 小於或等於 1 CSS px

#### Scenario: dense 多圖保持可讀
- **WHEN** 使用者在 4／6／8 圖版型啟用本益比河流圖
- **THEN** overlay MUST 保持在各自 panel 內並裁切到 plot bounds
- **AND** MUST NOT 增加 panel 高度、形成水平／垂直捲動區或蓋住 toolbar

### Requirement: readout 必須揭示口徑且排除同業比較

作用中的河流圖 MUST 在 pointed date 顯示官方本益比或盤中估算本益比、交易所參考 EPS、財報年／季、五個 percentile multiplier、股價所在區帶、來源與資料日期。API、readout 與 overlay MUST NOT 包含同業平均、產業本益比、同業中位數、同業估值線、forward P/E 或目標價。

#### Scenario: 指向歷史 completed session
- **WHEN** crosshair 指向具有有效官方估值資料的 completed session
- **THEN** readout MUST 顯示該日官方 P/E、參考 EPS、fiscal year／quarter 與來源日期
- **AND** MUST 顯示相對歷史 percentile 區帶，不得稱為合理價、目標價或買賣訊號

#### Scenario: 當日尚未收盤
- **WHEN** 日 K 含當前未完成 session，且存在最近一筆有效官方 reference EPS
- **THEN** 系統 MUST 以目前價格除以最近 reference EPS 顯示「盤中估算本益比」並延伸當日河流價格
- **AND** 估算值 MUST NOT 寫入官方逐日估值 table、納入 percentile sample 或標示為官方本益比

#### Scenario: 使用者曾詢問但已排除同業比較
- **WHEN** 河流 API 或 readout 產生資料
- **THEN** response 與可見 UI MUST NOT 出現 peer／industry multiplier、同業平均或產業參考線

### Requirement: 快速切換與取消必須 latest-wins 且完整清理

每個 panel MUST 以 canonical symbol、interval 與 load token 驗證河流 response。取消勾選、切換商品／週期、重建或銷毀 panel 時，系統 MUST abort request／poll、取消待執行 rAF、移除 overlay／readout／status 及 listener；晚到 response MUST NOT 污染新的 panel 狀態。

#### Scenario: 載入中取消勾選
- **WHEN** 河流資料或 backfill 狀態仍在載入，使用者取消勾選
- **THEN** 前端 MUST 立即保留 K 線並移除河流載入狀態
- **AND** 後續晚到 response MUST NOT 重新建立 overlay

#### Scenario: 快速切換商品
- **WHEN** 使用者在 symbol A 的河流 request 完成前切到 symbol B
- **THEN** symbol A response MUST 被丟棄
- **AND** symbol B panel MUST 只顯示 B 的 coverage、readout 與河流圖

#### Scenario: 河流來源失敗
- **WHEN** 河流 API、background job 或來源暫時失敗
- **THEN** panel MUST 顯示安全且可診斷的河流狀態
- **AND** 主 K 線、其他主圖指標、副圖、即時連線與 panel 操作 MUST 維持可用

### Requirement: 完整 panel PNG 必須包含目前可見河流圖

啟用河流圖時，「儲存此商品所有線圖為圖片」MUST 擷取與畫面相同的五條界線、四個 band、主 K 線與目前可見 readout；匯出不得因 SVG clone、responsive viewport 或 overflow 計算遺失河流圖，也不得加入畫面上不存在的同業資料。

#### Scenario: 匯出啟用河流圖的單一 panel
- **WHEN** 河流圖已完成繪製且使用者匯出該商品所有線圖
- **THEN** PNG MUST 包含完整主圖河流帶、K 線與所有可見副圖
- **AND** 匯出圖中的河流線與 K 線時間／價格位置 MUST 與畫面一致

#### Scenario: 河流圖未啟用或無資料
- **WHEN** checkbox 未勾選、商品不適用或有效歷史不足
- **THEN** PNG MUST NOT 出現殘留河流 band／readout
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
