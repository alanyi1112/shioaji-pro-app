## MODIFIED Requirements

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

## RENAMED Requirements

- FROM: `### Requirement: readout 必須揭示口徑且排除同業比較`
- TO: `### Requirement: 右鍵詳細說明必須揭示口徑且排除同業比較`
