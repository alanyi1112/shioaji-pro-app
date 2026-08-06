## ADDED Requirements

### Requirement: 費波那契選點必須顯示游標實際價位導引

系統 MUST 在費波那契回撤或拓展等待下一個錨點時，於有效主圖游標位置繪製獨立的水平價格導引線。導引線的 Y 座標 MUST 對應即將保存之錨點的實際價格，不得以該根 K 棒的開盤、最高、最低或收盤價取代，並 MUST 從主圖 plot 左緣延伸至右側價格軸前的安全邊界。

#### Scenario: 尚未選取第一點
- **WHEN** 使用者啟動費波那契回撤或拓展並將游標移至有效主圖位置
- **THEN** 系統 MUST 在游標 Y 座標顯示水平價格導引線
- **AND** 導引線右端 MUST 顯示 `待選 A` 與該位置的格式化價格

#### Scenario: 預覽後續錨點
- **WHEN** 回撤已固定 A 或拓展已固定 A、B，且使用者移動游標預覽下一點
- **THEN** 系統 MUST 分別顯示 `待選 B` 或 `待選 C` 與該位置的格式化價格
- **AND** 導引線 MUST 跟隨 preview price 即時移動，不得吸附至 K 棒收盤價

#### Scenario: 游標位置無效
- **WHEN** 游標位於主圖 plot 外、價格軸內或無法轉換成有限時間及價格的位置
- **THEN** 系統 MUST NOT 顯示或保存價格導引及無效錨點

### Requirement: 顯示價格必須與實際錨點一致

系統 MUST 讓價格導引與費波那契 preview、點選保存共用同一個圖表座標轉換結果。使用者點選前看到的價格以商品既有 formatter 顯示後，MUST 與該次點選保存錨點再以相同 formatter 顯示的結果一致；導引功能不得改變既有錨點數值、費波那契公式或水準計算。

#### Scenario: 點選目前預覽位置
- **WHEN** 使用者在價格導引顯示 `待選 B｜123.50` 的位置點選 B
- **THEN** 系統保存的 B 錨點以相同 formatter 顯示時 MUST 為 `123.50`
- **AND** 後續回撤或拓展水準 MUST 使用該保存錨點計算

#### Scenario: 商品價格格式不同
- **WHEN** 使用者在具有不同價格小數格式的商品上選取費波那契錨點
- **THEN** 導引標籤 MUST 沿用該商品既有價格 formatter
- **AND** 系統 MUST NOT 以固定小數位文字取代既有格式規則

### Requirement: 錨點價格導引必須與既有十字線保持可辨識且互不干擾

系統 MUST 保留既有 K 棒日期垂直十字線、收盤價水平虛線、價格標籤、主副圖共用日期同步及逐日讀值。錨點價格導引 MUST 以不同顏色的高對比實線及含 `待選 A／B／C` 的價格標籤呈現，不得只靠顏色區分，也不得呼叫或改寫共用十字線的價格同步狀態。

#### Scenario: 游標價位不同於收盤價
- **WHEN** 費波那契選點游標的 Y 對應價格與所指 K 棒收盤價不同
- **THEN** 主圖 MUST 同時保留收盤價水平虛線與錨點價格水平實線
- **AND** 使用者 MUST 可由線型、顏色及 `待選 A／B／C` 標籤辨認兩者語意

#### Scenario: 跨 pane 共用日期同步
- **WHEN** 使用者在費波那契選點期間沿主圖水平移動游標
- **THEN** 主圖、可見技術副圖及籌碼 pane MUST 繼續依既有日期十字線同步
- **AND** 錨點價格導引 MUST 僅顯示於目前主圖，不得在副圖產生價格線或改寫其讀值

#### Scenario: 圖表手勢與可存取辨識
- **WHEN** 錨點價格導引顯示於主圖
- **THEN** 導引群組 MUST 維持 `pointer-events: none`，不得攔截縮放、平移、點選、右鍵或 Escape
- **AND** 可見標籤 MUST 以文字同時表達下一個錨點名稱與價格

### Requirement: 錨點價格導引必須維持純暫態生命週期

錨點價格導引 MUST 只在費波那契工具具有有效 pending preview 時存在。它 MUST NOT 寫入瀏覽器本機、完成註記、API 或 D1，也 MUST NOT 出現在完整 panel PNG；取消、完成或身份切換後不得殘留。

#### Scenario: 滑鼠離開或 Escape 取消
- **WHEN** 使用者將滑鼠移出主圖或在未完成選點時按 Escape
- **THEN** 系統 MUST 立即移除錨點價格導引線及標籤
- **AND** MUST NOT 保存暫態 preview 或不完整錨點

#### Scenario: 完成最後一個錨點
- **WHEN** 使用者完成回撤的 B 或拓展的 C
- **THEN** 系統 MUST 移除 `待選` 價格導引
- **AND** 已完成費波那契錨點、水準、色帶與標籤 MUST 依既有行為保留

#### Scenario: 切換工具或圖表身份
- **WHEN** 使用者重新啟動其他繪圖工具、切換商品或週期，或 panel 被重設或銷毀
- **THEN** 系統 MUST 清除前一費波那契 pending preview 與價格導引
- **AND** 新身份 MUST NOT 顯示前一身份的待選價格

#### Scenario: 選點期間匯出 PNG
- **WHEN** 使用者在錨點價格導引可見時執行完整 panel PNG 匯出
- **THEN** PNG MUST 排除暫態導引線及 `待選 A／B／C` 價格標籤
- **AND** 既有完成費波那契註記及其他可匯出圖層 MUST 維持可見

### Requirement: 費波那契選點標記不得遮蔽目標價位

系統 MUST 在費波那契回撤或拓展選點期間暫時隱藏主圖均線、布林線及其他價格折線的原生實心 crosshair marker，避免同一垂直線堆疊多個大型圓點。尚未固定的 preview 錨點 MUST 以置中於實際游標時間與價格、可見線條粗細為 1 CSS px 的小型十字呈現；只有已固定或完成的錨點 MAY 使用小型、內部透明的空心圓。

#### Scenario: 游標預覽下一個錨點
- **WHEN** 費波那契工具具有有效 pending preview
- **THEN** 游標時間垂直線與待選價格水平線交叉處 MUST 顯示小型十字
- **AND** 十字的水平與垂直可見線條 MUST 均為 1 CSS px，不得以較粗 halo 擴張成實心交叉塊
- **AND** 主圖各價格折線 MUST NOT 在該垂直線顯示大型實心 crosshair marker
- **AND** preview MUST NOT 同時顯示圓形錨點

#### Scenario: 固定錨點
- **WHEN** 使用者點選並固定 A、B 或 C
- **THEN** 該固定點 MUST 以半徑不超過 4 CSS px 的透明空心圓呈現
- **AND** 圓點 MUST NOT 遮蔽圓心所對應的 K 棒與價位

#### Scenario: 結束費波那契選點
- **WHEN** 使用者完成、取消、清除或切換離開費波那契工具
- **THEN** 主圖價格折線的既有 crosshair marker 設定 MUST 恢復
- **AND** 暫態十字 MUST 立即移除

### Requirement: 拓展預覽不得改變主圖價格尺度

系統 MUST 將費波那契拓展的 pending preview 視為純 SVG 暫態內容，不得把預覽 C 點衍生的最低或最高拓展水準寫入 Lightweight Charts 的 autoscale 輔助 series。選點期間游標移動 MUST 保持既有 K 線價格尺度穩定；完成拓展後，正式水準 MAY 依既有規則一次納入價格軸。

#### Scenario: 移動拓展 C 點預覽
- **WHEN** 使用者已固定拓展 A、B 並上下或左右移動待選 C
- **THEN** 系統 MUST 即時計算與繪製可見範圍內的預覽水準
- **AND** 隱形 autoscale series 的資料 MUST NOT 隨 pending preview 變動
- **AND** 主圖 K 線不得因 preview 水準超出目前範圍而反覆壓縮或展開

#### Scenario: 完成拓展
- **WHEN** 使用者點選並完成 C
- **THEN** 系統 MAY 將完成拓展的最低及最高正式水準納入價格軸
- **AND** 這次正式更新 MUST NOT 保留或混入先前 pending preview 的尺度資料
