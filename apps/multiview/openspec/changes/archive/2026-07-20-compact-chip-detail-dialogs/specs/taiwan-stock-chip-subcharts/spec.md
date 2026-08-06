## MODIFIED Requirements

### Requirement: TDCC holder 右鍵詳細資料表

全部十個籌碼 pane MUST 在既有滑鼠右鍵與鍵盤功能表顯示「詳細資料」，且 MUST NOT 在標題列新增詳細資料按鈕。點選後 MUST 以結構化比較表顯示右鍵指向日期的資料；欄序 MUST 為「項目」、「前一期日期」、「當期日期」、「變化」，其中前一期與當期的欄位標題 MUST 只顯示實際日期，不得加上「前一筆」或「指向值」前綴。詳細資料浮層與表格 MUST 依實際內容寬度收縮，不得以固定桌面寬度、`width: 100%` 或表格最小寬度製造空白欄距；同時 MUST 保持項目靠左、數值靠右、長數字與單位可讀。viewport 寬度不足時 MUST 可捲動而不得截斷內容。RSI、KD、MACD、ATR 技術副圖 MUST NOT 顯示本詳細資料功能。

#### Scenario: daily pane 顯示指向交易日比較
- **WHEN** 使用者在法人、融資、融券、借券或券資比 pane 的某交易日位置按滑鼠右鍵並選擇「詳細資料」
- **THEN** 系統 MUST 以該 pane 的 X 座標解析指向交易日，並在指向交易日前尋找最近一筆有效資料
- **AND** 每個適用資料項目 MUST 依序顯示前一筆值、指向值及 `指向值 - 前一筆值`
- **AND** 前一期與當期欄位標題 MUST 只顯示對應的 ISO 日期，不得顯示「前一筆」或「指向值」文字
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

#### Scenario: 首筆或缺值
- **WHEN** 指向資料是首筆合法資料，或某項目前一筆值缺漏
- **THEN** 前一筆與變化欄 MUST 顯示「首筆／無前期比較」或「無資料」
- **AND** MUST NOT 以 0、日曆前一天或其他欄位補值

#### Scenario: 緊湊版面維持可讀
- **WHEN** 詳細資料表顯示法人合計、融資或 TDCC holder 的完整數值與 metadata
- **THEN** 浮層與四欄 MUST 依最長實際內容收縮，項目、前期、當期、變化及 metadata 標題後方不得保留固定欄寬造成的大面積空白
- **AND** 不同資料列數與內容長度 MUST 套用相同的內容收縮原則，不得為個別 pane 設定特例寬度
- **AND** 項目、兩期數值、變化、單位與 metadata MUST 完整可讀，不得因窄化被裁切

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
