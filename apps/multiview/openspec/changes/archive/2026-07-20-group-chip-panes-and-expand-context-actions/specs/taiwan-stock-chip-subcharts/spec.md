## ADDED Requirements

### Requirement: 籌碼資料群組階層選取

系統 MUST 在方式 B 的「籌碼資料」選單把十個籌碼副圖整理為三個具有大項目與子項目的資料群組：「法人」包含外資買賣超＋持股、投信買賣超、自營商買賣超、三大法人合計；「融資券」包含融資、融券、借券、券資比；「大戶持股」包含大戶持股與散戶持股。大項目 MUST 依子項目呈現 checked、unchecked 或 indeterminate，子項目 MUST 可獨立勾選或取消。

#### Scenario: 勾選未全選的大項目
- **WHEN** 方式 B 的某群組目前為 unchecked 或 indeterminate，使用者勾選大項目
- **THEN** 系統 MUST 一次勾選該群組全部子項目並建立各自獨立 pane
- **AND** 同群組 panes MUST 依群組 canonical child order 相鄰排列，共用相同 dataset response 時不得重複請求

#### Scenario: 取消已全選的大項目
- **WHEN** 方式 B 的某群組全部子項目均已勾選，使用者取消大項目
- **THEN** 系統 MUST 一次取消該群組全部子項目並銷毀對應 controllers
- **AND** 其他群組、技術副圖、主圖與 candles MUST 保持作用

#### Scenario: 個別取消子項目
- **WHEN** 使用者取消已全選群組中的一個子項目
- **THEN** 系統 MUST 只移除該 pane，並將大項目設為 indeterminate
- **AND** 其餘可見子項目 MUST 保持相鄰且依 canonical child order 排列

#### Scenario: 方式 A 與強制單一模式
- **WHEN** panel 使用方式 A，或因 4／6／8 圖或聚焦模式強制為單一副圖
- **THEN** 使用者 MUST 仍可在群組結構中選取一個子項目作為單一籌碼 pane
- **AND** 大項目整組選取 MUST 不可操作並以可存取狀態說明只有多層副圖可整組顯示

#### Scenario: 保留既有預設與使用者選擇
- **WHEN** 使用者首次進入方式 B，或既有偏好尚未包含群組欄位
- **THEN** 系統 MUST 保留既有首次預設 panes 或既有 `modeBSelectedPaneIds`，再由子項目推導群組三態
- **AND** 升級 MUST NOT 自動開啟原本未選的全部十個籌碼副圖

## MODIFIED Requirements

### Requirement: TDCC holder 右鍵詳細資料表

全部十個籌碼 pane MUST 在既有滑鼠右鍵與鍵盤功能表顯示「詳細資料」，且 MUST NOT 在標題列新增詳細資料按鈕。點選後 MUST 以結構化比較表顯示右鍵指向日期的資料；欄序 MUST 為「項目」、「前一交易日／前一筆有效資料」、「指向交易日」、「變化」。RSI、KD、MACD、ATR 技術副圖 MUST NOT 顯示本詳細資料功能。

#### Scenario: daily pane 顯示指向交易日比較
- **WHEN** 使用者在法人、融資、融券、借券或券資比 pane 的某交易日位置按滑鼠右鍵並選擇「詳細資料」
- **THEN** 系統 MUST 以該 pane 的 X 座標解析指向交易日，並在指向交易日前尋找最近一筆有效資料
- **AND** 每個適用資料項目 MUST 依序顯示前一筆值、指向值及 `指向值 - 前一筆值`
- **AND** 增加 MUST 為紅色、減少 MUST 為綠色、持平 MUST 為中性色

#### Scenario: 詳細資料項目沿用 series 色票
- **WHEN** 詳細資料表列出線圖已定義的資料項目
- **THEN** 項目標題 MUST 與該 pane 圖形、標題列讀值及右鍵「線圖項目」共用相同 canonical series 色票
- **AND** 來源、頻率、官方級距與提醒等非數值 metadata MUST 使用中性色且不得製造變化值

#### Scenario: TDCC holder 比較前一期與當期
- **WHEN** 使用者在大戶或散戶 pane 的某個 candle 日期開啟詳細資料
- **THEN** 系統 MUST 顯示指向日期、小於或等於該日的最近當期 TDCC `dataDate`，以及該當期前一筆實際發布 `dataDate`
- **AND** 表格 MUST 先列前一期值，再列指向日期對應的當期值，並以當期減前一期計算變化
- **AND** MUST NOT 將週資料 forward-fill 成指向交易日的每日資料

#### Scenario: 沒有前一筆有效資料
- **WHEN** 指向資料是首筆合法資料，或某項目前一筆值缺漏
- **THEN** 前一筆與變化欄 MUST 顯示「首筆／無前期比較」或「無資料」
- **AND** MUST NOT 以 0、日曆前一天或其他欄位補值

#### Scenario: 以鍵盤開啟詳細資料
- **WHEN** 使用者在籌碼 pane 以 `ContextMenu` 鍵或 `Shift+F10` 開啟功能表後選取「詳細資料」
- **THEN** 系統 MUST 優先使用目前共用游標日期，沒有游標時使用最新合法日期，並將焦點移入同一份比較表
- **AND** Escape 或點擊表格外 MUST 關閉表格並保留副圖可操作性

#### Scenario: 技術副圖不顯示詳細資料
- **WHEN** 使用者在 RSI、KD、MACD 或 ATR 技術副圖開啟右鍵功能表
- **THEN** 系統 MUST NOT 顯示籌碼「詳細資料」項目或前期比較表
- **AND** 技術副圖既有計算、讀值、同步與 panel 截圖操作 MUST 維持不變

#### Scenario: pane 移除或切換商品
- **WHEN** 詳細資料開啟期間移除 pane、切換商品、切換模式或銷毀 controller
- **THEN** 系統 MUST 關閉並清理詳細資料 DOM、固定日期與事件 listener
- **AND** MUST NOT 留下浮層、舊商品明細或失效焦點

### Requirement: 多層籌碼副圖自訂排序

方式 B 的作用中籌碼 panes MUST 依「法人」、「融資券」與「大戶持股」資料群組形成相鄰 group wrapper，並透過群組專用拖曳把手整組調整上下順序；群組內目前可見 panes MUST 使用 canonical child order，不得拆散排序。群組順序 MUST 依 `tabId + canonical symbol` 持久化；方式 A MUST NOT 顯示或接受群組排序。系統 MUST 提供右鍵「上移資料群組」與「下移資料群組」作為鍵盤及非拖曳替代方式。

#### Scenario: 拖曳中間群組到最上方
- **WHEN** 使用者在方式 B 從群組專用把手將一個中間資料群組拖到第一個群組之前並放開
- **THEN** 系統 MUST 顯示涵蓋完整群組的選取外框、輕量 ghost 與等高放置框，讓拖曳範圍與目標位置可清楚辨識
- **AND** 放開後 group wrapper DOM、共用十字線 plot 順序與保存順序 MUST 一致更新
- **AND** 系統 MUST 只寫入一次偏好、執行一次必要 layout refresh，且不得重新請求 pane 資料

#### Scenario: 拖曳移動期間不搬動 Canvas
- **WHEN** 使用者持續移動群組拖曳 pointer 並跨越其他群組
- **THEN** 系統 MUST 以 `requestAnimationFrame` 更新 ghost 與 placeholder
- **AND** 在合法 drop 前 MUST NOT 搬動實際 pane／Canvas DOM、執行 chart resize、量測右側軸、寫入偏好或呼叫資料 load

#### Scenario: 部分選取群組整組拖曳
- **WHEN** 某群組只有部分子項目可見且使用者拖曳該群組
- **THEN** 所有目前可見的同群組 panes MUST 作為一個單位移動
- **AND** 未選子項目 MUST NOT 因拖曳被建立或改變勾選狀態

#### Scenario: 從右鍵功能表移動群組
- **WHEN** 使用者在任一籌碼 pane 以滑鼠右鍵、`ContextMenu` 鍵或 `Shift+F10` 選擇「上移資料群組」或「下移資料群組」
- **THEN** 該 pane 所在群組 MUST 移動一個有效群組位置並保存與拖曳相同的順序
- **AND** 已在最上方或最下方群組的對應操作 MUST 顯示 disabled

#### Scenario: 取消進行中的群組拖曳
- **WHEN** 使用者按下 Escape、發生 `pointercancel`、視窗失焦、document 隱藏、切換商品／模式，或系統偵測按鍵已釋放而沒有合法 drop
- **THEN** 系統 MUST 移除 ghost、放置框與拖曳樣式，保留拖曳開始前的實際 DOM 與順序
- **AND** MUST NOT 寫入偏好或觸發資料重新載入

#### Scenario: 遷移既有單 pane 順序
- **WHEN** 既有偏好只有 `modeBPaneOrder` 而沒有群組順序
- **THEN** 系統 MUST 以每個群組第一個已選 pane 在舊順序的位置決定群組相對順序，再以 canonical child order 排列群組內 panes
- **AND** 重複、未知或未選 pane IDs MUST 安全忽略，未出現群組 MUST 依 registry 順序補入

#### Scenario: 切換商品後恢復各自群組順序
- **WHEN** 使用者在一個商品完成群組排序後切換至另一個商品，再返回原商品
- **THEN** 每個商品 MUST 依自己的 `tabId + canonical symbol` 恢復子項目勾選及群組順序
- **AND** A 模式的單一作用 pane MUST NOT 覆寫 B 模式的群組選擇與順序
