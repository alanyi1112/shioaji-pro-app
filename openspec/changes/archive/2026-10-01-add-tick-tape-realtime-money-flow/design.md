## Context

成交明細目前已將 `/api/v1/data/ticks` 歷史資料、`/api/v1/stream/data` 即時成交、IndexedDB 快取、跨來源去重、交易日／generation 隔離、coverage 與可設定大單分類收斂到同一個 `useTickTapeSession`／`SessionTapeClassifier`。分價量表也已證明同一份逐筆成交可以用增量 accumulator 產生衍生檢視，不必新增行情來源。

參考畫面把成交分成「大戶／散戶」，但 Shioaji tick 只有成交價、common lot、成交方向等市場資料，不能證明交易帳戶身分。本功能因此以目前設定 revision 的 `isLarge` 分成「大單／非大單」，並把每筆主動買進成交金額視為正、主動賣出視為負，產生從 09:00 起的分鐘累積淨額。

目前 `add-tick-tape-price-volume-distribution` 仍有 simulation 真實盤中驗收未完成。本 change 可獨立規格化與實作，但不得用 mock 或離線測試替代相同 history／SSE session 的最終盤中證據。

## Goals / Non-Goals

**Goals:**

- 在成交明細面板提供「資金流向」第三種衍生檢視，呈現整體、大單與非大單的即時累積淨額。
- 使用同一份已去重成交與相同 coverage，不增加 REST、SSE、login、cache 或交易副作用。
- 以整數新台幣增量計算、按分鐘聚合，保持等式 `整體 = 大單 + 非大單` 在顯示前精確成立。
- 沿用既有大單設定、重播、取消、generation 與原子切換語意。
- 在主面板、窄面板與獨立視窗提供可讀的三線圖、圖例、分鐘表格及狀態說明。

**Non-Goals:**

- 不提供「月」、近月、跨日比較或歷史資金流向查詢。
- 不將大單推論為「大戶」，也不將非大單推論為「散戶」。
- 不推估法人、主力、帳戶別或委託簿資金。
- 不改變既有大單資格、成交方向契約、完整日成交來源或快取格式。
- 不支援期貨、選擇權、指數、權證、零股、試撮或 14:00 定價交易。

## Decisions

### 1. 資金流向是同一成交 session 的第三個衍生檢視

`TickTape` 的 view state 擴充為「成交明細／分價量表／資金流向」。切換檢視只切換本機呈現，不得重新呼叫 history loader、重建 SSE subscription、改寫 IndexedDB 或影響交易狀態。主面板與獨立視窗繼續使用相同元件與清理生命週期。

不把資金流向做成獨立面板或另開 hook，避免同商品同交易日產生第二份完整日資料、額外 refcount 與不同 coverage 真相。

### 2. 每筆淨額使用既有整數成交金額與 Shioaji 方向

沿用 `tradeAmountTwd`：`round(price × 100) × common_lot × 10`，結果為整數新台幣。每筆方向值定義為：

- `tickType=1`：`+tradeAmountTwd`。
- `tickType=2`：`-tradeAmountTwd`。
- 其他方向：`0`，另累計未知方向成交金額與筆數供狀態揭露，不得猜測正負。

整體淨額累加所有合法一般整股成交的 signed amount；大單淨額只累加 `isLarge=true`；非大單淨額以 `overallNetTwd - largeNetTwd` 取得，避免三份各自運算後漂移。所有除以一百萬及小數格式化只在顯示層發生。

### 3. 「非大單」是分類補集，不宣稱交易者身分

介面與可及性文字固定使用「整體／大單／非大單」。合法成交只要 `isLarge=false` 即屬非大單，包括現行大單規則排除的 09:00 開盤瞬間與 13:25 起成交；它們仍依 `tickType` 影響整體及非大單淨額。未知方向成交雖屬大單或非大單分類之一，但 signed amount 為零，不改變任何淨額。

此設計選擇與既有大單頁籤一致，而不是為模仿參考畫面另建「大戶」模型。若未來要修改 13:25 後分類，應另行修改 `tick-tape-large-trade-tab` 正式規格，不在本 change 偷渡不同定義。

### 4. accumulator 依時間順序增量維護分鐘累積快照

新增純 domain `MoneyFlowAccumulator`，在 `SessionTapeClassifier.append` 完成 `isLarge` 判定後接收同一筆 `SessionTapeRow`。accumulator 保存目前整體、大單、未知方向金額／筆數與分鐘節點；同一分鐘的新成交只更新最後節點，跨分鐘才新增節點，因此一般交易日最多約 300 個節點。

分鐘 key 使用 `HH:mm`。只為實際出現合法成交的分鐘建立表格列；圖表 X 座標仍按真實分鐘位置配置，不把無成交間隔壓縮。X 軸範圍從 09:00 至至少 13:30，若延後收盤成交更晚則延伸至最新合法分鐘。歷史亂序或補齊後沿用既有排序與 replay 重建，不在 accumulator 內自行修補順序。

snapshot 提供 chronological points、latest-first table view 所需資料、最新累積值、未知方向摘要與 revision。不得在每次 React render 對最多 500,000 筆成交重新 `reduce`。

### 5. 大單設定重算與新成交採既有原子切換

設定變更時，由既有 `replaySessionTape` 按時間順序建立新的 classifier、分價量表與資金流向；yield 期間到達的新成交在新 classifier 完成前補入。畫面保留上一版一致結果並顯示「大單設定重新計算中」，完成後同時原子切換大單頁籤、分價量表與資金流向。

整體淨額不因設定改變，但仍跟著同一 snapshot 切換，避免整體、大單、非大單來自不同 revision。

### 6. 圖表使用輕量 SVG，表格最新分鐘在前

三線圖使用專案既有的響應式 SVG 模式，不新增圖表依賴或另一個 `lightweight-charts` instance。圖表固定三種可辨識色彩，Y domain 必須包含零與三序列全部極值，X 軸顯示交易時段刻度；圖例與可及性摘要必須提供顏色以外的識別。

表格欄位為「時間／整體淨額／大單淨額／非大單淨額」，最新分鐘在上，正值採台股上漲色、負值採下跌色、零值採中性色。單位固定為百萬元、顯示兩位小數；內部計算不得先換單位或四捨五入。

窄面板使用縮短間距、較小字級與響應式圖高，但四欄與圖例不可因水平 overflow 被裁掉；垂直空間不足時仍保留圖表與至少一列資料，不顯示多餘水平捲軸。最多約 300 列仍採視窗化或等效有界 DOM。

### 7. coverage 與來源限制直接約束資金流向宣稱

資金流向沿用 `loading`、`partial`、`verified`、`confirmed_empty`、`failed` 與已載入範圍。只有 `verified` 可顯示「截至目前已核實」；其他狀態可保留既有點位，但必須明示只代表已載入資料。`confirmed_empty` 不產生零值假曲線；`failed` 且無資料時顯示失敗空狀態。

未知方向成交不得因 coverage verified 而被臆測方向，介面資訊區需揭露其成交金額或筆數未納入淨額。

## Risks / Trade-offs

### 共用串流驗收的唯讀可觀測性

沿用分價量表 change 的 SharedWorker 診斷：僅透過頁面原有 port 手動讀取 refcount、來源實例生命週期及事件計數；指定商品觀察有 5 分鐘／32 筆上限，只保留成交對照所需欄位。診斷沒有第二條 SSE、history 查詢、broker subscription、登入或交易副作用。若真實來源送出未知方向成交，介面列出最近 100 筆的交易日、時間、價、量、方向碼、金額及歷史／即時來源，並保留全部合格未知方向的摘要；驗收需核對它們未改變三種淨額。若驗收時來源沒有送出，記錄觀測母體與未知方向 0 筆，以自動化 domain／browser 測試驗證該分支，標明「真實事件未觀察」但不因此阻擋其他實盤證據齊備後結案。不得注入假成交或把 fixture 寫成當日實盤證據。

共用 worker 的 60 秒無事件 watchdog 同樣涵蓋資金流向。重連訊號先將既有分鐘點保留並標示 partial；新成交與歷史補齊須沿用既有 continuity／去重，不能以 EventSource `readyState=OPEN` 或單純重連開啟作為已核實依據。

同一 simulation 盤中可由本機開發診斷發起一次受控靜默：只暫停既有成交 EventSource 的事件轉發，保留其 `OPEN` 狀態，讓原 watchdog 自行觸發；75 秒保險解除且真實傳輸錯誤會提前取消演練。驗收需分別保存觸發前、靜默未達門檻、watchdog 觸發後 partial 與缺口核實後 verified 的點位與診斷，不得將受控故障注入稱為自然發生的來源斷流。

- [使用「資金流向」可能被誤解為真實帳戶資金] → 常駐使用「主動買賣成交淨額」說明，分類只稱大單／非大單，不使用法人、主力、大戶或散戶。
- [未知方向造成淨額低估] → signed amount 設為零並揭露未知方向金額／筆數，不強制分派。
- [13:25 後大單線停止或只因先前累積而持平] → 沿用既有大單資格並在資訊對話框說明，保持跨檢視一致。
- [設定 replay 期間三序列 revision 不一致] → classifier 內同時建立全部 accumulator，完成後原子替換。
- [窄面板三線與四欄擁擠] → SVG 響應式縮放、共同 Y 軸、緊湊圖例與無水平 overflow 的 browser regression。
- [部分資料看似完整當日趨勢] → coverage 與載入範圍常駐或在 compact 狀態明確可見，真實 SSE 未驗收前不得結案。
- [每筆 live tick 重新產生整份 SVG points] → domain append 為 O(1)，points 上限約 300；必要時 memoize path 字串，不掃描完整成交 rows。

## Migration Plan

1. 建立純 domain accumulator 與 oracle fixtures，先固定方向、金額、分鐘、未知方向及大單補集公式。
2. 將 accumulator 接入 `SessionTapeClassifier`，由 `useTickTapeSession` 暴露同 revision snapshot，不修改 cache schema。
3. 加入第三個檢視、SVG、圖例、表格、coverage 與 compact layout。
4. 加入 session、component、browser、壓力與生命週期測試，確認切換檢視不新增 REST／SSE。
5. 在 Shioaji simulation 以真實盤中 history＋SSE 驗證至少一個分鐘點增量更新且不重複。
6. 回滾時只移除資金流向 accumulator 與 UI；既有逐筆成交、分價量表、IndexedDB 與大單設定不需遷移或刪除。

## Open Questions

無。首版採既有大單定義、固定百萬元、兩位小數、只顯示即時當日資料，且不加入「即時／月」切換。
