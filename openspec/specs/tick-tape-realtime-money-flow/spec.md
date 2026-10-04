# tick-tape-realtime-money-flow Specification

## Purpose
TBD - created by archiving change add-tick-tape-realtime-money-flow. Update Purpose after archive.
## Requirements
### Requirement: 成交明細必須提供即時資金流向檢視
系統 MUST 在台灣上市／上櫃 `STK` 的成交明細面板提供「資金流向」檢視，並與「成交明細／分價量表」並列。資金流向 MUST 只提供目前交易日即時資料，不得提供「即時／月」切換、近月或跨日統計。切換 MUST 重用目前商品與交易日的同一份 history、SSE、去重資料、IndexedDB 快取及 coverage，不得新增行情 subscription、歷史查詢、輪詢、重複 login 或交易寫入。

#### Scenario: 開啟資金流向
- **WHEN** 使用者在支援的台股商品選擇「資金流向」
- **THEN** 系統 MUST 使用目前已載入成交 session 顯示即時當日資金流向
- **AND** MUST NOT 重新抓取歷史、重建 SSE、啟用 production 或呼叫下單 API

#### Scenario: 不支援商品
- **WHEN** 商品不是 `TSE`／`OTC` 的 `STK`
- **THEN** 系統 MUST 不提供可誤認為有效的完整資金流向
- **AND** 既有成交明細功能 MUST 維持可用

#### Scenario: 不提供月檢視
- **WHEN** 使用者開啟資金流向
- **THEN** 介面 MUST NOT 顯示「即時／月」切換或以當日成交推造月資料

### Requirement: 淨額必須使用可核對的成交方向與整數金額
系統 MUST 只使用成交明細已接納的合法一般整股成交計算資金流向。單筆成交金額 MUST 使用 `round(price × 100) × common_lot × 10` 的整數新台幣結果；`tickType=1` MUST 為正、`tickType=2` MUST 為負，其他方向 MUST 為零且列為未知方向。未知方向成交 MUST NOT 冒充買進或賣出，系統 MUST 揭露未納入淨額的未知方向筆數或金額；若有未知方向，MUST 可展開檢視最近 100 筆的交易日、時間、價、量、方向碼、金額與歷史／即時來源，並說明摘要仍涵蓋全部合格未知方向成交。

#### Scenario: 主動買進與主動賣出
- **WHEN** 同一分鐘有一筆 `tickType=1` 與一筆 `tickType=2` 的合法成交
- **THEN** 系統 MUST 以兩筆整數成交金額相減取得該分鐘對累積淨額的變化
- **AND** 顯示換算不得改變內部精確結果

#### Scenario: 未知方向成交
- **WHEN** 合法成交的 `tickType` 不是 1 或 2
- **THEN** 該筆 MUST 計入未知方向摘要但不得改變任何淨額
- **AND** 系統 MUST NOT 依價格漲跌或前一筆成交猜測方向
- **AND** 若來源實際送出，使用者 MUST 可檢視該筆成交資料；超過 100 筆時只截斷明細，不截斷摘要

#### Scenario: 驗收時來源沒有未知方向成交
- **WHEN** 真實盤中觀察期間沒有 `tickType` 非 1／2 的合法成交
- **THEN** 驗收 MUST 記錄實際觀測母體、未知方向 0 筆與「真實事件未觀察」
- **AND** MUST 以自動化 domain／browser 測試驗證未知方向不改變淨額及有資料時的明細顯示；不得要求來源必須產生該種成交、也不得把 fixture 冒充實盤事件

#### Scenario: 排除不合格成交
- **WHEN** tick 為零股、試撮、無效價格、`volume <= 0` 或 14:00 定價交易
- **THEN** 系統 MUST 沿用成交明細 fail-closed 規則排除該筆
- **AND** 該筆 MUST NOT 改變任何資金流向點位或未知方向摘要

### Requirement: 整體、大單與非大單必須形成同 revision 的精確分解
系統 MUST 顯示「整體／大單／非大單」三種累積淨額。整體淨額 MUST 為截至該時間全部合法成交的 signed amount 總和；大單淨額 MUST 只包含目前設定 revision 下 `isLarge=true` 的 signed amount；非大單淨額 MUST 為整體淨額減大單淨額。三者 MUST 來自相同資料與設定 revision，且顯示前 MUST 精確滿足 `整體 = 大單 + 非大單`。介面 MUST NOT 將大單稱為「大戶」或將非大單稱為「散戶」。

#### Scenario: 大單與非大單混合成交
- **WHEN** 已載入成交包含正負方向的大單與非大單
- **THEN** 每個分鐘點的整體淨額 MUST 等於同點大單淨額加非大單淨額
- **AND** 表格及圖表 MUST 使用同一組 snapshot

#### Scenario: 開盤與 13:25 起成交
- **WHEN** 09:00 開盤瞬間或 13:25 起存在合法一般整股成交
- **THEN** 該成交 MUST 依方向計入整體與非大單淨額
- **AND** MUST NOT 繞過既有大單資格進入大單淨額

#### Scenario: 修改大單設定
- **WHEN** 使用者套用新的大單設定
- **THEN** 系統 MUST 按時間順序重播當日成交並重算大單與非大單序列
- **AND** 重算期間 MUST 保留一致的上一版，完成後才原子切換三序列

### Requirement: 資金流向必須按真實分鐘建立累積序列
系統 MUST 以 `HH:mm` 聚合同一分鐘的合法成交，並為有成交的分鐘保存截至該分鐘的整體、大單與非大單累積淨額。同分鐘新成交 MUST 更新目前分鐘點，跨分鐘成交 MUST 新增點位；歷史補齊或亂序資料 MUST 經既有排序與 replay 後重建。無成交分鐘不得產生虛構流量，圖表的時間位置 MUST 保留實際間隔而非把有成交分鐘等距壓縮。

#### Scenario: 同分鐘多筆成交
- **WHEN** 同一分鐘依序到達多筆合法成交
- **THEN** 系統 MUST 只保留一個該分鐘累積點並更新其三種淨額
- **AND** 表格 MUST 不產生重複分鐘列

#### Scenario: 跨分鐘成交
- **WHEN** 下一個分鐘首次收到合法成交
- **THEN** 系統 MUST 新增一個分鐘點，其起始累積值承接前一分鐘並加入該筆變化

#### Scenario: 中間分鐘無成交
- **WHEN** 兩個有成交分鐘之間存在無成交分鐘
- **THEN** 系統 MUST 保留兩點的真實時間距離
- **AND** MUST NOT 產生看似有資金變化的虛構成交列

### Requirement: 圖表與分鐘表格必須共同呈現即時趨勢
資金流向檢視 MUST 顯示整體、大單與非大單三條累積淨額線、零軸、交易時段刻度、可辨識圖例，以及「時間／整體淨額／大單淨額／非大單淨額」表格。Y 軸範圍 MUST 包含零及三序列全部極值；表格 MUST 最新分鐘在前。金額 MUST 以百萬元顯示兩位小數，正值使用台股上漲色、負值使用下跌色、零值使用中性色，但資訊不得只靠顏色表達。

#### Scenario: 同時存在正負淨額
- **WHEN** 三序列包含正值與負值
- **THEN** 圖表 MUST 顯示零軸且不得裁掉任一序列極值
- **AND** 表格 MUST 以正負號或等價文字保留方向語意

#### Scenario: 最新分鐘更新
- **WHEN** 目前分鐘收到新的 SSE 成交
- **THEN** 圖表最後點與表格第一列 MUST 增量更新
- **AND** 其他分鐘列與使用者捲動位置 MUST 保持穩定

#### Scenario: 窄面板與獨立視窗
- **WHEN** 資金流向顯示於窄面板或成交明細獨立視窗
- **THEN** 三線圖、圖例與四欄表格 MUST 可讀且不得出現不必要的水平捲軸
- **AND** 主面板與獨立視窗 MUST 使用相同資料與語意

### Requirement: 完整性狀態必須約束資金流向宣稱
資金流向 MUST 顯示成交明細既有 `loading`、`partial`、`verified`、`confirmed_empty` 或 `failed` coverage 與已載入範圍。只有 `verified` 可宣稱「截至目前已核實」；其他有資料狀態可保留曲線與表格，但 MUST 明示只代表已載入範圍。`confirmed_empty` MUST 顯示當日已確認無成交而不建立零值假曲線；無資料的 `failed` MUST 顯示失敗原因。

#### Scenario: 歷史尚未補齊
- **WHEN** coverage 為 `partial` 或 `loading` 且已有部分成交
- **THEN** 系統 MUST 保留可用資金流向並標示部分資料與已載入範圍
- **AND** MUST NOT 宣稱為完整當日資金流向

#### Scenario: 已確認無成交
- **WHEN** coverage 為 `confirmed_empty`
- **THEN** 系統 MUST 顯示已確認無成交且不產生分鐘點、零值曲線或除以零結果

#### Scenario: 斷線後恢復
- **WHEN** SSE 斷線後重連且缺口尚未完成補齊
- **THEN** 系統 MUST 保留既有點位並維持 `partial`
- **AND** 完成去重與 continuity 驗證前 MUST NOT 改稱 `verified`

#### Scenario: EventSource 看似開啟但事件靜止
- **WHEN** 共用 SSE 連續 60 秒沒有心跳或其他事件，但 `readyState` 仍為 `OPEN`
- **THEN** 系統 MUST 在不增加平行串流的前提下重連，保留既有分鐘點並標示 partial
- **AND** 新成交或補齊經 continuity 與去重核實前 MUST NOT 宣稱截至目前完整

### Requirement: 大量成交必須以增量統計與有界 DOM 呈現
系統 MUST 在既有成交分類／replay 流程中增量維護分鐘資金流向，不得因每筆 live tick 或 React render 重新掃描完整日全部 rows。歷史 replay MUST 保留既有分批 yield、取消與 generation 防護；分鐘表格 MUST 使用視窗化或等效有界 DOM。切換資金流向不得淘汰成交、重設 session 或改寫 IndexedDB 原始 cache。

#### Scenario: 即時新增一筆成交
- **WHEN** 已有大量完整日成交且收到一筆合法新 tick
- **THEN** 系統 MUST 只更新目前分鐘 accumulator、snapshot revision 與必要圖表點
- **AND** MUST NOT 對完整成交 rows 執行重新彙總

#### Scenario: 500,000 筆 replay
- **WHEN** 使用 500,000 筆上限 fixture 建立資金流向
- **THEN** 三序列、未知方向摘要及分鐘點 MUST 與獨立 oracle 相同
- **AND** replay MUST 可取消、UI DOM MUST 維持有界，且不得靜默截斷

#### Scenario: 切換檢視
- **WHEN** 使用者在成交明細、分價量表與資金流向間切換
- **THEN** 系統 MUST 保留同一成交 session 與 subscription
- **AND** 關閉面板時 MUST 沿用既有 refcount 與 cleanup

### Requirement: 真實盤中驗收必須證明 history 與 SSE 共用且無交易副作用
功能完成宣告 MUST 包含 Shioaji simulation 真實盤中驗收，證明首次載入使用既有 `/api/v1/data/ticks`、後續點位由既有 `/api/v1/stream/data` 成交更新、同一成交只計算一次，且 coverage 與 network evidence 一致。單元測試、mock SSE、靜態畫面或 source inspection 不得單獨替代此驗收。驗收 MUST 保持 production 停止、不得送出委託或改變行情服務生命週期。

#### Scenario: 盤中首次載入與分鐘更新
- **WHEN** 在 simulation 模式開啟流動性足夠的台股資金流向並等待新成交
- **THEN** network evidence MUST 顯示有界歷史查詢與既有 SSE 成交事件
- **AND** 新成交 MUST 只更新一次正確分鐘、方向與分類淨額
- **AND** production 與交易寫入 MUST 維持停用

#### Scenario: 獨立視窗驗收
- **WHEN** 從成交明細獨立視窗開啟資金流向
- **THEN** 視窗 MUST 實際接收共用 SSE 並維持正確 refcount／cleanup
- **AND** 只有 REST 歷史結果而沒有 SSE event MUST 視為未通過
