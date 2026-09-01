## Context

既有收盤後選股以全市場普通股母體、官方日成交量／成交值與 TDCC 週資料建立本機 immutable snapshot，UI／GET 只讀 snapshot，不在互動路徑抓取市場資料。日底稿目前只保留成交量比較所需的兩個官方交易日，並未保存全市場 OHLC，因此不能可靠計算三 K／纏論分型或 BOLL(20,2) 首次穿越。

主圖已有 `src/lib/indicators.ts` 的 canonical BOLL 實作；MultiView 亦有官方 TWSE／TPEx OHLC 正規化責任鏈，但選股不能假設每個商品已有 `candle_history`、已在自選清單或已被 Shioaji 訂閱。本 change 必須建立選股專用、全市場、repo 外本機 D1 的 OHLC 滑動窗，同時保留前置 changes 的 v1／v2 live 驗收、版本與歸檔邊界。

## Goals / Non-Goals

**Goals:**

- 提供原始三 K 與含包含關係處理的纏論頂／底分型，且只回報截至最新完整交易日已確認的型態。
- 提供固定 canonical BOLL(20,2) 的下軌陽 K 下影與上軌陰 K 上影首次穿越條件。
- 讓兩個新技術條件加入既有 `all`／`any` 三態組合、穩定分頁、排序、偏好與圖表連動。
- 以官方全市場日批次資料建立至少 60 個市場交易日的本機 OHLC 滑動窗，背景有界補足升級與新商品資料。
- 保存足以重算與解釋結果的日期、OHLC、BOLL、分型合併及來源證據，不把畫面目測或浮點顯示值當判定依據。
- 維持 UI／GET 零 provider、零 Shioaji 訂閱、零回補 dispatch、零交易副作用。

**Non-Goals:**

- 不提供盤中、分鐘 K、任意歷史日期、策略回測、訊號通知或自動下單。
- 第一版不開放 BOLL period／multiplier、影線長度比例、分型回看天數或使用者自訂腳本。
- 不將分型解讀為必然反轉，不將布林穿越解讀為買賣建議。
- 不以 Yahoo、未驗證調整價、逐檔 Shioaji Kbars、自選清單或畫面已載入的 K 棒補足全市場資料。
- 不在本 change 內改寫或取消前置 `extend-after-market-stock-screener-with-turnover-and-holder-reversal` 的 live 驗收、排程或歸檔工作。

## Decisions

### 1. 一張分型條件卡提供算法與方向兩個互斥維度

`fractal.algorithm` 提供 `raw-three`、`chan-containment`、`any`；`fractal.direction` 提供 `bottom`、`top`、`any`。選擇 `any` 時在該維度內採三態 OR：任一子判定 pass 即 pass；全部 fail 才 fail；沒有 pass 且至少一個 unknown 則 unknown。這讓使用者能分別使用兩種算法，也不會因同時勾選互斥頂／底型態而產生永遠無結果的 AND。

原始三 K 使用最新三個相鄰官方市場交易日 A、B、C，C 為最新完整交易日：

- 頂分型：`B.high > A.high && B.high > C.high && B.low > A.low && B.low > C.low`。
- 底分型：`B.low < A.low && B.low < C.low && B.high < A.high && B.high < C.high`。

所有比較採嚴格不等號；相等不算分型。B 是型態中心，C 收盤後才是確認日，因此不得把 B 當成尚未確認的即時訊號。

替代方案是五 K Williams fractal，但使用者已選擇原始三 K與纏論兩種算法；混入第三套語意會讓結果名稱與確認延遲不清楚，因此不採用。

### 2. 纏論算法先形成可稽核的標準化 K 棒，再套用相同三 K 規則

相鄰 K 棒只要一根的高低區間完全包含另一根，即視為包含關係。合併方向由前兩根已無包含關係的有效 K 棒決定：高低點同步上移為向上，同步下移為向下；無法唯一決定方向時標記 `containment_direction_unknown`，不得以收盤漲跌或陣列順序猜測。

- 向上合併：`high=max(high1,high2)`、`low=max(low1,low2)`。
- 向下合併：`high=min(high1,high2)`、`low=min(low1,low2)`。

每根標準化 K 棒保存 `rawFrom`、`rawTo` 與原始交易日清單；開收價不參與分型高低點合併。完成包含關係處理後，對最後三根標準化 K 棒套用決策 1 的嚴格頂／底規則；最右標準化 K 棒必須涵蓋最新完整交易日，且中心棒後已有獨立右棒，才算已確認。60 個原始交易日仍不足以形成三根可判定標準化 K 棒時回 `insufficient_effective_bars`。

替代方案是在含糊方向使用最近一日收盤決定合併，但這會產生無法從高低結構重現的結果，因此採 fail closed。

### 3. 布林反轉 K 固定使用 canonical BOLL(20,2) 與首次穿越

BOLL 使用 `src/lib/indicators.ts` 相同的 20 期收盤平均、母體標準差與既有 deterministic rounding。P 為 D 前一個官方市場交易日；P 與 D 都須有完整合法 OHLC，並各自有完整 20 期計算窗，因此判定至少需要連續 21 個官方市場交易日資料。

前一日「在通道內」定義為 `lowerP <= closeP && closeP <= upperP`，碰軌仍算通道內。最新日使用嚴格穿越：

- 下軌陽 K 下影：`closeD < lowerD`、`closeD > openD`、`lowD < openD`。
- 上軌陰 K 上影：`closeD > upperD`、`closeD < openD`、`highD > openD`。

影線只要求大於零個合法價格差，不增加未經要求的影線／實體比例。十字線、碰軌、前一日已在任一通道外、缺一交易日或非法 OHLC 均不得 pass。`bollReversal.mode` 提供 `lower-bullish`、`upper-bearish`、`any`，`any` 同樣使用三態 OR。

### 4. 選股專用 OHLC 滑動窗與既有 candle history 分離

新增 additive `screener_daily_ohlcv`，以 `symbol + session_date` 唯一，保存 canonical OHLC、market、來源欄位、幣別／價格基礎、mapping version、payload hash、fetchedAt 與 validation。來源沿用 TWSE／TPEx 官方全市場日資料；實作前必須對最新 OpenAPI 與歷史日期報表逐市場核對實際 OHLC 欄位、日期、除權息／調整語意、交易範圍、授權與自動化限制。

底稿保留至少最新 60 個已驗證官方市場交易日及仍被兩版 immutable snapshot 引用的錨點。BOLL 不跳過中間官方交易日；某商品在必要 session 缺 K 棒即回 `missing_ohlcv`。纏論可使用完整 60 日視窗，但不得越過來源窗向 `candle_history`、Yahoo 或 Shioaji 偷補。

採市場日期批次而不是逐商品抓取：同一 market／session 的一次正式回應服務全母體，再以 universe revision 過濾。這比逐檔 Kbars 可控，也不會因商品未加入清單而缺資料。

### 5. Snapshot 只嵌入衍生證據，不複製 60 日原始列

publisher 在 staging 階段對每檔計算：原始三 K、纏論分型、BOLL P／D、兩種反轉 K 及逐原因 unknown。snapshot row 保存必要 OHLC、日期、標準化 K 棒映射、band 值、公式版本與來源摘要；60 日原始底稿留在 D1，不隨每次 API 分頁重送。

只有所有目標 market／session 批次都進入 `collected` 或可解釋的正式終態，且 staging rows 等於 universe total，才能原子發布新版 snapshot。個別商品合法缺值可成為 row-level unknown，但部分市場日期尚未處理時不得把 v3 發布為全市場完成。

### 6. Criteria、snapshot、cursor 與偏好升為 v3

新 criteria 新增 `fractal` 與 `bollReversal` 分支；啟用的四類條件在外層共同使用既有 `all`／`any` 三態規則。v3 fingerprint 綁定兩張技術條件的算法／方向／模式、formula version、snapshot ID、排序與分頁 cursor，v1／v2 不得被 v3 route 重新解釋。

v2 偏好遷移到 v3 時兩個新條件預設關閉，既有成交量、大戶、成交值、組合與排序保持不變。結果明細顯示確認日、中心日／原始日期範圍、算法、方向、P／D OHLC、P／D bands、影線與 unknown reason；列表可依分型確認日、算法及通道外距離排序，最後仍以代碼穩定 tiebreak。

點擊結果沿用既有指定未鎖定 K 線圖機制，不加入自選清單、不改其他圖表、下單／智慧下單商品或草稿。第一版不強制在圖上新增分型 marker；結果證據已足以讓使用者在所選日 K 圖核對型態。

### 7. 背景 bootstrap 與前置 v2 change 分開收斂

新 change 先等前置 v2 change 完成 live acceptance，保存其 exact D1／snapshot／tasks 基線後才套用 v3 additive migration。OHLC bootstrap 依 `market + session` 建立 target、cursor、checkpoint 與固定 request／時間 budget，支援中斷續跑、來源冷卻、timeout、Retry-After 與 bounded retry；新商品只補必要日期，不修改自選清單或 TDCC 個人長歷史佇列。

UI／GET 永不 dispatch bootstrap。背景未完整時保留最後合法 v2 snapshot並回報 v3 preparation progress；不得以部分 60 日 coverage 發布 v3，也不得為縮短時間提高為無界併發。

## Risks / Trade-offs

- [「分型」有多套市場定義] → UI 與 evidence 固定標示「原始三 K」或「纏論包含處理」，公式分開測試，不使用泛稱隱藏差異。
- [包含關係初始方向不明] → 回 `containment_direction_unknown`，不以漲跌或任意預設猜測。
- [停牌／新上市使 21 或 60 日不完整] → 依官方市場 session 明確回 `missing_ohlcv`／`insufficient_history`，不跳日或補零。
- [全市場 60 日批次增加來源請求與 D1 容量] → 以 market／session 批次、有界 run、checkpoint、retention 與衍生 snapshot 控制；不逐商品抓取。
- [官方 OpenAPI 與歷史報表 OHLC 語意不一致] → 實作前逐市場做 live source review 與同日 hash／筆數／欄位驗收，不相容時保持 v2。
- [BOLL 浮點邊界在不同責任鏈漂移] → 共用 canonical 函式、固定 rounding 與 exact fixtures，API 不用格式化顯示值重算。
- [v3 擴張拖延 v2 live 收尾] → change、migration、tasks 與 snapshot version 分離，v2 完成前不切換 v3 發布。
- [技術型態被誤讀為交易建議] → 文案只陳述可驗證 K 棒結構，禁止自動下單、通知或勝率暗示。

## Migration Plan

1. 完成並保存前置 v2 change 的 live acceptance、D1、snapshot 與測試基線。
2. 建立兩套分型、BOLL 首次穿越及三態純函式與來源 fixture，不改 v2 route。
3. 加入 additive OHLC schema、官方 adapter 與 60 日 background planner；先在 staging／備份 D1 驗證 migration。
4. 分段執行全市場 OHLC bootstrap，保存逐市場／日期 coverage、failed／remaining／overdue 與來源證據。
5. coverage gate 通過後產生第一份 v3 immutable snapshot，再切換 v3 route 與 UI；v2 保留一個 release window。
6. 跑全市場 API、實際 UI、600／768／900 px、console、圖表點選及無交易副作用驗收後才完成 change。
7. 回滾時停止 v3 發布並讓 UI 回最後合法 v2 snapshot；保留 additive OHLC 與 checkpoint，不刪除已驗證資料或停機。

## Open Questions

無。使用者已確認同時提供原始三 K 與完整纏論包含關係算法，且 BOLL 條件必須是前一交易日仍在通道內、最新交易日首次穿越。
