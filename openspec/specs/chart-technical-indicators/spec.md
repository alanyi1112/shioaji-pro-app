# chart-technical-indicators Specification

## Purpose
TBD - created by archiving change integrate-multichart-technical-indicators. Update Purpose after archive.
## Requirements
### Requirement: 技術指標必須具有可追溯的固定參考版本
系統 MUST 以 `MultiChartOnCodexSite` commit `ecae7cac837f06085801c96f3da0c570051d66e7` 的 `worker/indicators.ts` 與 `worker/pivot-points.ts` 作為本 change 重疊 OHLCV 指標的固定公式基準，並 MUST 在程式與測試中保存 `multichart-ecae7ca-v1` formula version。相同、依時間遞增的 candle fixture MUST 產生與來源函式相同的 warm-up time、空值、六位小數值及輸出線數；來源 repo 不得成為安裝、build 或 runtime dependency。

#### Scenario: 固定 fixture 驗證來源公式
- **WHEN** 測試以保存的來源 RSI／KD／MACD／ATR／MA／BOLL／FVG／Volume Profile／Traditional Pivot fixture 計算指標
- **THEN** 每一來源輸出 MUST 與保存的期望值逐點相同
- **AND** 測試 MUST 驗證 time、第一個有效 index、null 或 whitespace 邊界及六位小數值

#### Scenario: Volume MA20 是本地延伸
- **WHEN** 測試 Volume MA5／MA10／MA20
- **THEN** MA5 與 MA10 MUST 對齊參考 repo 的來源輸出
- **AND** MA20 MUST 使用相同 zero-inclusive SMA 契約與 RealTimeStock 自有 fixture
- **AND** UI、規格及測試 MUST NOT 宣稱來源 repo 原本提供 Volume MA20

#### Scenario: 來源 repo 日後改版
- **WHEN** `MultiChartOnCodexSite` 在固定基準 commit 之後修改公式
- **THEN** RealTimeStock MUST NOT 在未提升 formula version、更新規格及 fixture 的情況下自動改變數值

### Requirement: RSI 必須使用可重用的 Wilder 5／10 雙週期算法
系統 MUST 讓 `rsi` instance 同時輸出 short 與 long 兩條 RSI，預設週期為 5 與 10。每一週期 MUST 先以最初 N 根漲跌幅的 SMA 初始化 average gain 及 average loss，其後使用 Wilder 遞迴；average gain 與 average loss 同為 0 時 MUST 回傳 50，只有 average loss 為 0 時 MUST 回傳 100。單週期核心 MUST 可供 StochRSI 使用，雙線 RSI 改版不得改變既有 StochRSI 的 input shape。

#### Scenario: RSI 暖機及固定數值
- **WHEN** 系統使用來源測試的十五筆 close fixture 及預設 5／10 計算 RSI
- **THEN** short 前五個 candle 與 long 前十個 candle MUST 沒有有效值
- **AND** short 第一個有效值 MUST 為 66.666667，short 最後值 MUST 為 72.184073
- **AND** long 第一個有效值 MUST 為 71.428571，long 最後值 MUST 為 70.532894

#### Scenario: 平盤 RSI
- **WHEN** 至少十二根 candle 的 close 全部相同
- **THEN** RSI5 與 RSI10 完成暖機後 MUST 都等於 50
- **AND** 系統 MUST NOT 因 average loss 為 0 將完全平盤誤判為 100

#### Scenario: RSI 顯示、驗證與 StochRSI 相容
- **WHEN** 使用者新增或設定 RSI
- **THEN** 設定介面 MUST 提供 2–100 的 shortPeriod 與 longPeriod，且 shortPeriod MUST 小於 longPeriod
- **AND** 副圖 MUST 顯示兩條可辨識的 RSI 線、各自讀值及 30／50／70 細虛線
- **AND** 非法組合 MUST 顯示欄位錯誤並不得保存
- **AND** 既有 StochRSI fixture MUST 繼續通過

### Requirement: KD 必須使用初始值 50 的 9／3／3 遞迴算法
系統 MUST 以 period=9、rsvWeight=3、kWeight=3 作為 `kd` 預設。累積 period 根 candle 後 MUST 使用該 window 的最高、最低與本期 close 計算 RSV；最高等於最低時 RSV MUST 為 50。K、D 前值 MUST 固定以 50 初始化，再分別使用 `K=(前K×(rsvWeight-1)+RSV)/rsvWeight` 與 `D=(前D×(kWeight-1)+K)/kWeight` 更新，不得使用 rolling SMA 取代。

#### Scenario: KD 暖機及第一個有效值
- **WHEN** 系統使用來源測試的十五筆 candle fixture 及預設 9／3／3 計算 KD
- **THEN** 前八根 candle 的 K 與 D MUST 沒有有效值
- **AND** 第一個 K MUST 為 61.904762，第一個 D MUST 為 53.968254
- **AND** 最後 K MUST 為 78.202365，最後 D MUST 為 73.076839

#### Scenario: KD 顯示與參數驗證
- **WHEN** 使用者新增或設定 KD
- **THEN** 設定介面 MUST 提供 period 2–100、rsvWeight 1–20、kWeight 1–20
- **AND** 副圖 MUST 顯示 K、D、各自讀值及 20／80 細虛線

### Requirement: MACD 與 ATR 必須沿用參考暖機並保留樣式鍵相容
MACD MUST 使用 SMA seed 的 EMA fast／slow，並以來源 repo 的零值時間序列暖機 signal；第一個有效 MACD candle MUST 同時具有 signal 與 histogram。MACD 的 RealTimeStock output keys MUST 保留 `hist`、`macd` 與 `signal`。ATR MUST 將第一根 TR 定義為 high-low，初始 ATR 使用最初 N 根 TR 的 SMA，其後使用 Wilder 遞迴平均。所有輸出 MUST 對齊原 candle time。

#### Scenario: MACD 參考暖機
- **WHEN** 使用者以預設 12／26／9 計算 MACD
- **THEN** fastPeriod MUST 小於 slowPeriod，所有 period MUST 通過有界整數驗證
- **AND** 第一個有效 `macd` time MUST 同時具有 `signal` 與 `hist`
- **AND** 既有三個 output style keys MUST 在 migration 後仍對應原線條

#### Scenario: ATR 參考暖機
- **WHEN** 使用者以 period=14 計算 ATR
- **THEN** 前十三根 candle MUST 維持 whitespace
- **AND** 第一個 ATR MUST 是前十四個 TR 的 SMA，後續值 MUST 使用 Wilder 遞迴

### Requirement: 主圖組合指標必須保留 RealTimeStock 既有能力
系統 MUST 提供參考均線組、BOLL、Volume MA、FVG、K 線固定區間 Volume Profile 及 Traditional Pivot Point。這些指標 MUST 使用目前圖表依 time 排序的 Shioaji candles 計算，不得另外呼叫來源 repo、Cloudflare、D1 或未授權市場資料服務。既有額外指標與自訂指標 MUST 保持可選且不得被移除或改名。

#### Scenario: 顯示參考均線組
- **WHEN** 使用者新增「參考均線組」
- **THEN** 主圖 MUST 同時顯示使用 close 計算的 SMA5、SMA10、SMA20、SMA60、SMA120
- **AND** 每條線 MUST 在累積對應期數前維持 whitespace
- **AND** 使用者仍可另外新增既有單線 SMA、EMA 或 WMA

#### Scenario: 顯示 BOLL
- **WHEN** 使用者以預設 period=20、multiplier=2 新增 BOLL
- **THEN** 中軌 MUST 為最近二十根 close 的 SMA，上下軌 MUST 使用同 window 母體標準差的正負兩倍
- **AND** 固定 fixture 的第一組 upper／middle／lower MUST 分別為 20.830952／15／9.169048

#### Scenario: 顯示成交量與 Volume MA
- **WHEN** 使用者啟用 Volume MA 且目前圖表顯示成交量柱
- **THEN** 系統 MUST 透過 definition render metadata 在相同 `vol` price scale 顯示 Volume SMA5、SMA10 與 SMA20
- **AND** 合法的零成交量 MUST 納入期數與平均
- **AND** 期數不足時 MUST 維持 whitespace，不得把缺值當零

### Requirement: FVG 必須具有明確且可測試的 zone 生命週期
系統 MUST 以三根 candle 偵測 FVG。bullish FVG 範圍 MUST 為第一根 high 至第三根 low；bearish FVG 範圍 MUST 為第三根 high 至第一根 low，偵測 time 使用第三根 candle。zone 自偵測 candle 向右延伸，部分穿越不得縮小原始邊界。

#### Scenario: 建立並限制 FVG 顯示數量
- **WHEN** 第三根 candle 與第一根 candle 形成合法 bullish 或 bearish gap
- **THEN** 系統 MUST 建立方向 marker 與對應 zone
- **AND** 主圖 MUST 最多保留最新二十個方向 marker 及最新十二個尚未 fully mitigated zones

#### Scenario: FVG 完全填補
- **WHEN** 後續 candle 的 low 觸及或跌破 bullish zone 下緣，或 high 觸及或突破 bearish zone 上緣
- **THEN** 該 zone MUST 標記為 fully mitigated 並停止向右延伸
- **AND** 未達到相反邊界的部分穿越 MUST NOT 提前移除或改寫原始 zone 邊界

#### Scenario: FVG primitive 對齊與清理
- **WHEN** 圖表平移、縮放、resize、history paging、切換商品／時框或移除 FVG
- **THEN** marker 與有效 zone MUST 維持時間／價格對齊或被完整清理
- **AND** overlay MUST NOT 污染 K 線 autoscale、crosshair 或交易點擊

### Requirement: K 線 Volume Profile 必須使用 chart-local 固定區間
每個 K 線 Volume Profile instance MUST 依 `chart identity + instanceId + symbol + timeframe` 保存 chart-local runtime `rangeStartTime` 與 `rangeEndTime`。統計母體 MUST 只包含兩個 anchor 之間且包含兩端的 canonical candles；anchors 不得寫入全域 indicator instance，也不得因 viewport 或 history paging 自動移動。

#### Scenario: 尚未設定固定區間
- **WHEN** 使用者啟用 K 線固定區間 Volume Profile，但目前 chart runtime 沒有合法 anchors
- **THEN** legend MUST 顯示「請設定固定區間」
- **AND** 系統 MUST NOT 猜測使用全部已載入資料或目前可視範圍

#### Scenario: 選取固定起訖 candle
- **WHEN** 使用者在游標觀察模式明確啟動「設定區間」，並依序選取兩根已載入 candle
- **THEN** 系統 MUST 將較早時間正規化為 start、較晚時間正規化為 end，且兩端都納入計算
- **AND** 點價買賣、停損、停利或警示模式 MUST 優先並阻止 Volume Profile 取得 anchors

#### Scenario: 固定區間不隨 viewport 漂移
- **WHEN** 使用者平移、縮放、resize、載入區間外歷史或產生晚於 end anchor 的新 candle
- **THEN** POC／VAH／VAL 與 bins 的統計母體 MUST 保持不變
- **AND** 只有固定區間內 candle 的 OHLCV 修正或使用者重新設定 anchors MAY 觸發數值變更

#### Scenario: 計算與顯示固定區間 profile
- **WHEN** 固定區間內具有合法 candles
- **THEN** 系統 MUST 以 streaming min/max 取得最低 low 與最高 high，建立 24 個等距 bins，並將每根完整 volume 歸入 typical price `(high+low+close)/3` 所在 bin
- **AND** POC MUST 是 volume 最大 bin 的中心；VAH／VAL MUST 從 POC 向相鄰 bins 擴張至總量 70%，同量時優先向上
- **AND** 主圖 MUST 顯示不遮蔽右側價格軸的橫向 profile、POC、VAH 與 VAL

#### Scenario: 與逐筆分價量區分
- **WHEN** 使用者同時開啟 K 線固定區間 Volume Profile 與既有逐筆分價量 block
- **THEN** UI MUST 分別標示 candle-bin 與 tick-price 資料語意
- **AND** 系統 MUST NOT 宣稱兩者的 POC、價量分布或內外盤數值相同

### Requirement: Traditional Pivot 第一階段只能用於 STK／IND／WRT
系統 MUST 提供預設關閉的 Traditional Pivot Point，並使用所選 completed reference 交易日的 `H`、`L`、`C` 計算下一交易日 `P=(H+L+C)/3`、`R1=2P-L`、`S1=2P-H`、`R2=P+(H-L)`、`S2=P-(H-L)`、`R3=R1+(H-L)`、`S3=S1-(H-L)`。本 change 只允許 security type STK、IND、WRT；FUT 與 OPT MUST 保持不支援。

#### Scenario: 股票類商品建立 completed reference
- **WHEN** STK、IND 或 WRT 的 canonical raw 1m rows 依 `Asia/Taipei` 日期分組，且某日期之後已有下一個實際交易日期資料
- **THEN** 前一日期 MUST 視為 completed reference，並使用該日所有合法 rows 建立 H／L／C
- **AND** 系統 MUST NOT 使用 UTC 日界線、單根日內 candle 或畫面第一根不完整 candle 代替完整交易日

#### Scenario: 最新日只能是 provisional
- **WHEN** 最新日期尚無下一個實際交易日期資料佐證完成
- **THEN** 該 group MUST 標示 provisional
- **AND** 預設「最後完成」projection MUST NOT 把 provisional 冒充 completed

#### Scenario: FUT／OPT 明確延後
- **WHEN** 目前商品 security type 為 FUT 或 OPT
- **THEN** Pivot picker MUST 停用或顯示「第一階段尚未支援」
- **AND** 系統 MUST NOT 以午夜切割、猜測 session 或輸出 provisional Pivot

#### Scenario: 以完整交易日投影七線
- **WHEN** 使用者在 1m、5m、15m、60m 或 1D 圖啟用 Pivot，且最後 completed reference 具有合法 H／L／C
- **THEN** 主圖 MUST 顯示 P、R1、R2、R3、S1、S2、S3 的下一交易日右向投影
- **AND** readout MUST 顯示 reference 日期、適用下一交易日、completed 狀態與七個格式化價格

### Requirement: Pivot overlay 與互動必須維持圖表及交易安全
Pivot MUST 只呈現目前預設或使用者固定 reference 的七條右向水平投影，不得建立未來 timestamp、假 candle 或完整歷史 step lines。使用者只有在游標觀察模式才可點選歷史 K 棒固定 reference；交易相關模式 MUST 優先。Pivot 的計算、選取、primitive、readout、autoscale helper 與 cleanup MUST 依 chart、商品、時框及 generation 隔離。

#### Scenario: 點選歷史 K 棒固定 reference
- **WHEN** Pivot 已啟用、目前為游標觀察模式且使用者點選 STK／IND／WRT 的合法歷史 K 棒
- **THEN** 系統 MUST 固定該 K 棒所屬日期的 projection，後續 hover 不得改變 reference
- **AND** 使用者 MUST 可透過鍵盤可操作的「回到最新」恢復最後 completed projection

#### Scenario: 交易模式優先於 Pivot
- **WHEN** 使用者已選擇點價買、點價賣、停損、停利或警示模式後點擊圖表
- **THEN** 點擊 MUST 只依既有交易或警示流程處理，Pivot reference MUST 保持不變
- **AND** Pivot 啟用狀態不得擴大 production 權限、略過 simulation 或風險檢查

#### Scenario: 快速切換與清理
- **WHEN** 使用者 history paging、快速切換商品／時框、開關 Pivot 或銷毀 chart
- **THEN** 目前 generation 的 reference、完成狀態與七線 MUST 維持一致或安全重算
- **AND** 舊 generation 結果 MUST 被取消或丟棄，不得污染 viewport、autoscale 或其他指標

### Requirement: 所有圖表必須使用原子 canonical indicator store
系統 MUST 以單一 external store 管理 indicator instances。相同 document 中所有既有與後續 `CandleChart`、回測圖及同 origin 其他視窗 MUST 讀取經 schema 驗證的版本化 snapshot；單一 document 的新增、修改、隱藏、排序、複製及移除 MUST 對最新 snapshot 使用 functional update。

#### Scenario: 快速連續修改不得遺失
- **WHEN** 兩個操作在 React 重新 render 前連續修改 instances
- **THEN** store MUST 依序套用兩個 functional updates
- **AND** 後一操作 MUST NOT 以 stale array 覆蓋前一操作

#### Scenario: 設定 modal 取消不得回滾其他更新
- **WHEN** 使用者開啟某 instance 設定視窗後，另一張圖修改了其他 instance，接著使用者取消設定
- **THEN** modal MUST 只丟棄自己的 local draft
- **AND** 系統 MUST NOT 把開啟 modal 時的整份舊 snapshot 寫回 store

#### Scenario: 設定 modal 確認遇到已刪除 instance
- **WHEN** modal 開啟期間目標 instance 已被其他操作移除，使用者再按確認
- **THEN** 系統 MUST 顯示安全衝突提示且不得偷偷重建該 instance

#### Scenario: storage 寫入失敗
- **WHEN** localStorage 不可用、quota 已滿或 v3 寫入失敗
- **THEN** 系統 MUST 保留並通知新的 in-memory canonical snapshot
- **AND** UI MUST 顯示「設定尚未保存」及安全 reason code，且原 v2 資料 MUST 保留

#### Scenario: 同 origin 視窗同步
- **WHEN** 另一個同 origin 視窗寫入合法新版 envelope
- **THEN** 現有視窗 MUST 依 revision／updatedAt／writerId 的 last-write-wins 規則套用較新 snapshot
- **AND** 非法或較舊 storage event MUST NOT 覆蓋目前有效狀態

### Requirement: 舊版 instances 與每類預設值必須分開非破壞遷移
系統 MUST 將 `sj-pro-indicators-v2` 遷移至 `sj-pro-indicators-v3` envelope，並將 `sj-pro-ind-defaults-v1` 遷移至獨立的新版 defaults envelope。兩種 migration MUST 可重入；新版成功寫入前 MUST 保留舊 key。每個合法 instance 的 id、順序、hidden、visibleTf、precision、showLabels、showValues 與可安全對應的 styles MUST 保留。

#### Scenario: 遷移 RSI、KD、MACD 與 ATR
- **WHEN** v2 含 RSI period、KD period/k/d、MACD fast/slow/signal 或 ATR period
- **THEN** RSI MUST 轉為 5／10，KD MUST 將合法 k/d 轉為 rsvWeight/kWeight，MACD MUST 轉為新參數名稱，ATR MUST 保留合法 period
- **AND** MACD styles MUST 繼續對應 `hist`／`macd`／`signal`
- **AND** 非法相對關係 MUST 分別回復 5／10、9／3／3、12／26／9 或 14

#### Scenario: 遷移 per-type defaults
- **WHEN** `sj-pro-ind-defaults-v1` 含受 breaking change 影響的合法或非法預設
- **THEN** 系統 MUST 使用與 instances 相同的參數及 style mapping 產生新版 defaults envelope
- **AND** 單一類型損壞 MUST NOT 清空其他類型預設或 instances

#### Scenario: 損壞 storage
- **WHEN** v3 內容無法解析或不符合 schema
- **THEN** 系統 MUST 嘗試從合法 v2 重新 migration
- **AND** v2 也無效時 MUST 使用空清單並只記錄安全 reason code

### Requirement: 指標資料更新不得反覆銷毀 pane 或截斷遞迴歷史
系統 MUST 將 series／pane 結構 reconciliation 與資料刷新分離。instance 結構、樣式、順序、theme 或時框可見性改變時 MAY 建立、移動或移除 series；單純 candle 資料更新 MUST 重用相同 `instanceId + outputKey` series／pane。EMA、MACD、Wilder RSI／ATR 等遞迴公式 MUST 使用完整前序狀態或經 full recompute 證明等價的 checkpoint，不能只使用暖機期加可視區間。

#### Scenario: current bar 內更新 RSI
- **WHEN** SSE tick 改變目前尚未收線 candle 的 close
- **THEN** 每張圖 MUST 最多存在一個 latest-wins job，且可見 RSI 最新讀值 MUST 在 500ms 節流週期後的第一個完成更新反映 canonical current bar
- **AND** 副圖 pane identity、高度與使用者拖曳比例 MUST 不變

#### Scenario: 歷史補載重建 checkpoint
- **WHEN** 使用者向左平移觸發 history paging 並合併較舊 candles
- **THEN** 受影響的 prefix checkpoint MUST 失效並依完整 canonical bars 重建
- **AND** 可見尾端值 MUST 與一次 full recompute 同資料的結果逐點相同

#### Scenario: 切換商品或時框
- **WHEN** 舊 generation 尚有排程時切換商品或時框
- **THEN** 舊結果 MUST 被取消或丟棄
- **AND** 新圖 MUST NOT 短暫顯示前一商品、時框或 chart runtime error

### Requirement: Runtime 錯誤必須依 chart 隔離且可診斷
`idle`、`computing`、`ready`、`error` MUST 依 `chart identity + instanceId + generation` 保存，且 MUST NOT 寫入全域 indicator storage。同一 instance 在某張圖失敗時，其他商品或時框上的 instance MUST 維持自身狀態。錯誤訊息不得包含自訂程式全文、完整市場資料、帳號或秘密。

#### Scenario: 單一圖表指標計算失敗
- **WHEN** 某 chart 上的 instance compute 或 primitive renderer 拋出例外
- **THEN** 該 chart legend MUST 顯示「計算失敗」與安全 reason code，並保留設定、重試與移除操作
- **AND** 其他 chart、指標、主 K 線、simulation session 與下單安全模式 MUST 維持可用

### Requirement: 實作必須以四個獨立驗收閘門推進
本 change MUST 依序完成「公式與 migration」、「canonical store 與 stable renderer」、「FVG 與固定區間 Volume Profile」、「STK／IND／WRT Pivot」四個階段。每個階段 MUST 在其自動化測試、browser-visible 測試及 build 通過後才可進入下一階段；未完成的後續階段不得被前一階段宣稱完成。

#### Scenario: 建立可執行的 browser harness
- **WHEN** 階段 1 進入驗收
- **THEN** repo MUST 已有可重複執行的 `test:browser` 或等效真實瀏覽器測試 harness
- **AND** 後續階段 MUST 用它驗證 lightweight-charts series／primitive、互動、resize 與 cleanup，不得只檢查靜態 JSX 字串

#### Scenario: 完整 change 驗收
- **WHEN** 四個階段皆完成
- **THEN** 必須通過完整 `pnpm test`、browser harness、`pnpm run build`、OpenSpec strict validation 與 `git diff --check`
- **AND** 本機可見驗收 MUST 使用 simulation session，確認多圖同步、current-bar、history paging、固定區間、Pivot 商品限制及 console 無未處理錯誤
- **AND** 驗收 MUST NOT 呼叫不存在的 `pnpm run lint`，除非實作期間另有明確 tooling task 新增該 script
