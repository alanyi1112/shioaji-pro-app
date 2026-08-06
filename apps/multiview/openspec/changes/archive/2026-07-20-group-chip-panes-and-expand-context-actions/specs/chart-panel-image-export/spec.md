## ADDED Requirements

### Requirement: 商品 panel 全區右鍵匯出入口

系統 MUST 讓使用者在任一商品 `.chart-panel` 的主圖、工具列、技術副圖、籌碼副圖或 panel 其他可見位置按滑鼠右鍵後，從當前位置適用的單一功能表選擇「儲存此商品所有線圖為圖片」。籌碼副圖既有右鍵功能表 MUST 整合相同操作並阻止 panel 功能表重複開啟；技術副圖 MUST 另提供「移除副圖」，但不得因本能力新增技術詳細資料。

#### Scenario: 從主圖或技術副圖開啟匯出
- **WHEN** 使用者在某商品的主圖、技術副圖或 panel 其他非籌碼位置按滑鼠右鍵
- **THEN** 系統 MUST 開啟該商品 panel 的功能表並提供「儲存此商品所有線圖為圖片」
- **AND** MUST NOT 同時開啟籌碼 pane 功能表或其他商品的功能表

#### Scenario: 從籌碼副圖開啟匯出
- **WHEN** 使用者在任一籌碼副圖按滑鼠右鍵
- **THEN** 該 pane 既有功能表 MUST 同時保留線圖項目、詳細資料、回補、排序、移除等適用操作，並加入「儲存此商品所有線圖為圖片」
- **AND** panel 級功能表 MUST NOT 重複出現

#### Scenario: 技術副圖不新增詳細資料
- **WHEN** 使用者在 RSI、KD、MACD 或 ATR 技術副圖開啟右鍵功能表
- **THEN** 系統 MUST 提供商品 panel 圖片匯出
- **AND** MUST 提供「移除副圖」
- **AND** MUST NOT 顯示技術指標「詳細資料」操作或前期比較表

#### Scenario: 從右鍵功能表移除技術副圖
- **WHEN** 使用者在可見技術副圖開啟右鍵功能表並選擇「移除副圖」
- **THEN** 系統 MUST 一次取消該商品 panel 目前勾選的 RSI、KD、MACD、ATR 並收起技術副圖區
- **AND** MUST NOT 變更任何籌碼副圖、資料群組順序或其他商品 panel
- **AND** 主圖或 panel 空白位置開啟的功能表 MUST NOT 顯示「移除副圖」

### Requirement: 完整商品線圖 PNG 內容

系統 MUST 將右鍵所在的單一商品 panel 以 PNG 匯出，內容 MUST 包含當下商品名稱、代號、週期、報價資訊、K 線主圖、目前實際可見的技術副圖、全部可見籌碼副圖、已繪製 series、overlay、右側數值軸及已固定的指向日期讀值。輸出 MUST 使用 panel 完整內容高度而非 viewport 裁切，並 MUST 排除功能表、dialog、拖曳預覽、其他商品 panel、網站外框及瀏覽器 chrome。

#### Scenario: 匯出具有多層副圖的長 panel
- **WHEN** 方式 B 的商品 panel 具有多個籌碼群組且完整高度超過目前 viewport
- **THEN** PNG MUST 從該 panel 頂端完整包含至最後一個可見副圖底端
- **AND** 完整高度 MUST 涵蓋使用 `overflow: visible` 且超出 panel `scrollHeight` 的最底層可見後代內容
- **AND** 匯出 clone MUST 保留當下瀏覽器 viewport 尺寸，使 `vh`／responsive CSS 不得在匯出期間改變主副圖版面高度
- **AND** 「大戶持股」群組部分或全部勾選時 MUST 完整包含大戶與散戶持股比中所有可見 pane
- **AND** MUST NOT 只截取目前螢幕可見區、截斷群組或加入其他商品內容

#### Scenario: 匯出當下指向日期
- **WHEN** 使用者在某交易日位置按右鍵並選擇匯出
- **THEN** PNG MUST 保留該交易日的共用日期線與目前主副圖讀值
- **AND** 關閉右鍵功能表後 MUST NOT 在擷取前把讀值恢復成最新日期

#### Scenario: 只有主圖或單一副圖
- **WHEN** 商品 panel 沒有技術副圖、沒有籌碼副圖，或因方式 A 只顯示一個副圖
- **THEN** PNG MUST 只包含當時實際可見的圖表與控制資訊
- **AND** MUST NOT 建立空白副圖、隱藏 pane 或額外高度

### Requirement: 本機匯出安全與失敗回復

系統 MUST 完全在瀏覽器本機把 panel DOM 與 Canvas 轉成 PNG Blob 並觸發下載，MUST NOT 將畫面、行情、籌碼資料、cookie、token 或其他使用者資料送至 Worker API、外部截圖服務、CDN 執行時服務或 AI Agent。檔名 MUST 包含 canonical symbol、interval 與匯出時間，且 MUST 移除檔名不安全字元。匯出完成或失敗後 MUST 清除暫存 object URL、離屏 DOM 與匯出狀態。

#### Scenario: 成功下載本機 PNG
- **WHEN** 瀏覽器成功完成 panel 序列化
- **THEN** 系統 MUST 下載 MIME type 為 `image/png` 的圖檔，檔名可辨識商品、週期與時間
- **AND** 匯出流程 MUST NOT 產生任何影像或行情資料上傳請求

#### Scenario: 瀏覽器不支援或 Canvas 序列化失敗
- **WHEN** 輸出尺寸超過安全上限、Canvas 被污染或瀏覽器無法完成序列化
- **THEN** 系統 MUST 顯示可理解的失敗訊息並保留原 panel、圖表、指向日期及選取狀態
- **AND** 若可在安全像素與邊長內等比例降低解析度，MUST 完整縮放所有內容而非裁切底部
- **AND** MUST 清除暫存資源，不得下載空白、截斷或非 PNG 檔案

#### Scenario: 匯出期間切換商品或銷毀 panel
- **WHEN** 圖片建立期間使用者切換頁籤、商品、圖數或 panel 被銷毀
- **THEN** 系統 MUST 取消或安全結束舊 panel 的匯出並清除暫存資源
- **AND** MUST NOT 把新商品資訊與舊商品 Canvas 混在同一圖檔
