## Context

參考 repo `MultiChartOnCodexSite` 目前最新且可驗證的工作版本為 commit `ecae7cac837f06085801c96f3da0c570051d66e7`（`codex/restore-cloudflare-small-group-login`）。其 `origin/main` 尚停在 `2d09253f710de1126a0ca841bfb0645125b2ed31`，但兩個 commit 的 `worker/indicators.ts` 與 `worker/pivot-points.ts` blob 相同，因此本 change 固定以 `ecae7ca` 命名 formula version，不讓未來 branch 移動自動改變數值。參考 repo 的成交量均線只有 MA5／MA10；MA20 是 RealTimeStock 採同一 SMA 契約增加的本地延伸。

RealTimeStock 目前由瀏覽器使用 Shioaji K 棒在 `src/lib/indicators.ts` 計算，`src/lib/indicator-defs.ts` 保存 definitions、每類預設值與 localStorage instances，`CandleChart` 再把每個 instance 建立成 lightweight-charts series。現有 `IndicatorDef` 已是 `SeriesIndicatorDef | ReadoutIndicatorDef` 的可辨識 union，並已有 `DayBoundaryPrimitive` 可作受控 primitive lifecycle 的參考，不需要重做整套型別或改用自由 DOM overlay。

現有 `CandleChart` 已透過 `subscribeInstances` 接收同 document 通知；真正問題是 mutation 仍從 React closure 組出整份陣列、`saveInstances` 在 storage failure 時沒有真正保存記憶體 snapshot，而且設定 modal 取消時會把開啟當下的整份舊 snapshot 寫回。這些行為在多圖快速操作時可能覆蓋較新的更新。

current bar 物件會隨 tick 更新，但 `dataVersion` 只在新 bar 或歷史載入時遞增，使既有 K 棒期間的指標讀值落後。現行 indicator effect 每次更新又會移除全部 series 與副圖 pane；直接把每個 tick 納入 effect 會造成高頻 teardown、閃爍與比例重設。RealTimeStock 的長時框可由大量 raw 1m rows 聚合，EMA、MACD、Wilder RSI／ATR 又依賴完整前序遞迴狀態，因此不能以「暖機期＋可視區間」截斷資料後仍宣稱數值相同。

## Goals / Non-Goals

**Goals:**

- 以參考 repo 的固定 commit 與 fixture 建立可重現的公式版本，重疊公式以來源值為準，RealTimeStock 延伸項目則清楚標示並自備 fixture。
- 在不刪除 RealTimeStock 額外指標的前提下，提供參考主圖及技術副圖指標。
- 讓所有現存及後續建立的 chart block 使用單一 canonical instance state，並以原子 functional update 同步設定。
- 讓歷史載入、history paging、current bar、回測圖與可見 readout 使用相同公式版本及完整遞迴語意。
- 以固定起訖 candle 範圍計算 K 線 Volume Profile；圖表 viewport 改變不得改變統計母體。
- 第一階段 Pivot 只支援 STK／IND／WRT，依台北時區交易日期建立完整日盤 OHLC。
- 對 instances 與 per-type defaults 執行非破壞、可重入且可回復的 migration。
- 以四個階段及獨立驗收閘門降低一次整合大量工作的風險。

**Non-Goals:**

- 不在本 change 支援 FUT／OPT Pivot；待 API 提供權威 `trading_day`／session metadata 或另有經驗證的 TAIFEX session model 後另開 change。
- 不移植本益比河流圖、估算融資成本、籌碼／法人／融資券／TDCC 副圖或來源 repo 的資料管線。
- 不新增 1wk／1mo 時框或週線／月線 Pivot。
- 不新增 Shioaji production 登入、真實下單、遠端資料庫或 Cloudflare 依賴。
- 不把來源 repo 的單一共用技術副圖取代 RealTimeStock 的每 instance 獨立 pane。
- 不移除 VWAP、SAR、SuperTrend、Donchian、Keltner、StochRSI、CCI、OBV、MFI、Williams %R、DMI、ROC、BIAS 或自訂指標。
- 不自動為既有使用者加入新指標，也不把固定區間 Volume Profile 的 chart-local anchors 寫進全域 indicator instance。

## Decisions

### 固定最新參考 commit 與 formula version

將參考 OHLCV 純函式整理在 RealTimeStock 本身並宣告 `multichart-ecae7ca-v1`。CI 保存最小 candle fixture 與期望值，不在 build 或 runtime 讀取另一個本機 repo。來源公式輸出保留 warm-up whitespace 並以六位小數 round，對齊來源 `point()`；顯示 precision 仍由 instance 決定。

MA5／MA10、RSI、KD、MACD、ATR、BOLL、FVG、Volume Profile 與 Traditional Pivot 使用來源 fixture 或由來源函式產生的固定期望值。Volume MA20 沒有來源輸出，必須以同一個 zero-inclusive SMA helper 建立 RealTimeStock extension fixture，測試及 UI 不使用「來源 parity」描述。

### RSI、KD、MACD、ATR 保留既有消費者與樣式相容性

- 抽出單週期 `wilderRsiSeries` 純函式；雙線 RSI definition 呼叫兩次，StochRSI 仍呼叫單週期核心，不依賴雙線回傳 shape。
- RSI：`shortPeriod` 2–100、`longPeriod` 2–100，且 short < long；預設 5／10。
- KD：`period` 2–100、`rsvWeight` 1–20、`kWeight` 1–20；預設 9／3／3，K、D 前值由 50 初始化。
- MACD：`fastPeriod` 2–200、`slowPeriod` 3–200、`signalPeriod` 2–100，且 fast < slow；公式與暖機改為來源契約，但 output keys 保留 `hist`／`macd`／`signal`。
- ATR：`period` 2–100，預設 14；第一根 TR 使用 high-low，初始 ATR 使用最初 N 根 TR 的 SMA，再做 Wilder 遞迴。

設定 modal 使用 local draft。確認時只以 instance id 對最新 store snapshot 套用 patch；如果該 instance 已被其他操作移除，顯示安全衝突提示而不偷偷重建。取消只丟棄 draft，絕不回寫開啟 modal 時的整份 instance snapshot。

### 擴充既有 definition union 與明確 render target

沿用現有 discriminated union，新增受控的 built-in primitive／overlay variant；一般 series definition 增加明確 render metadata，例如 `paneTarget` 與 `priceScaleId`。`volume-ma` 的三條線固定使用 `priceScaleId: 'vol'`，主圖及回測 renderer 都遵守相同 metadata。

FVG、固定區間 Volume Profile 與 Pivot 優先採 Lightweight Charts 5.2 series／pane primitive，生命週期比照既有 `DayBoundaryPrimitive` 的 attach、detach、resize、time scale 與 price scale 訂閱。不得讓自訂 JavaScript 取得 DOM、網路或全域物件權限。

### 固定區間 K 線 Volume Profile

K 線 Volume Profile 每張圖、每個 instance、商品及時框各自保存一組 chart-local runtime anchors：`rangeStartTime` 與 `rangeEndTime`。使用者啟用後若尚未設定 anchors，legend 顯示「請設定固定區間」；只有在明確的「設定區間」且為游標觀察模式時，才能依序選取兩根已載入 candle，反向選取時正規化為較早／較晚時間，兩端皆納入計算。交易、停損、停利及警示模式具有更高優先權。

統計母體只包含固定起訖時間內目前可取得的 canonical candles。平移、縮放、viewport 改變或載入區間外歷史不得改變 POC／VAH／VAL；區間內 candle（包含尚未收線的 end candle）資料修正時才重算。新增晚於 end anchor 的 candle 不納入。商品／時框切換使用各自 runtime key，找不到合法 anchors 時回到「請設定固定區間」，不套用其他圖表的時間。

計算以 streaming min/max 避免對大量 rows 使用展開運算子；再以最低 low 至最高 high 建立 24 個等距 bins，將每根完整 volume 歸入 typical price `(high+low+close)/3` 所在 bin。平坦價格區間使用單一有效 bin，POC／VAH／VAL 均為該價格。UI 名稱固定為「K 線固定區間 Volume Profile」，與既有逐筆分價量清楚區分。

### FVG zone 生命週期

bullish FVG 由第一根 high 至第三根 low；bearish FVG 由第三根 high 至第一根 low，偵測時間使用第三根 candle。zone 自偵測 candle 向右延伸；部分穿越不縮小邊界。後續 candle 的 low 觸及或跌破 bullish 下緣，或 high 觸及或突破 bearish 上緣時，zone 視為 fully mitigated 並停止延伸。主圖最多保留最新二十個方向 marker，並只顯示最新十二個尚未 fully mitigated zones。

### Pivot 第一階段只支援 STK／IND／WRT

Pivot 採 Traditional 固定七線：`P=(H+L+C)/3`、`R1=2P-L`、`S1=2P-H`、`R2=P+(H-L)`、`S2=P-(H-L)`、`R3=R1+(H-L)`、`S3=S1-(H-L)`。公式核心保存在 RealTimeStock，不在 runtime 呼叫來源 repo、Worker、D1 或 Cloudflare。

只有 contract `security_type` 為 STK、IND 或 WRT 時可啟用 Pivot；FUT／OPT 的 picker 項目停用並顯示「第一階段尚未支援」，不得以曆日猜算。支援商品從 canonical raw 1m rows 依 `Asia/Taipei` 日期分組，不沿用 UTC／午夜 bucket，也不以單根日內 candle 代替完整日 OHLC。有下一個已載入交易日期時，前一日期才是 completed；最新且尚無下一日期佐證的 group 為 provisional。預設 projection 使用最後 completed reference，並指向下一個實際有資料的交易日；歷史固定與「回到最新」只在游標觀察模式生效。

Pivot 使用受控 primitive 由 reference anchor 向右繪製七線、名稱／價格標籤與 readout，不建立未來 timestamp 或假 candle。點價買賣、停損、停利及警示模式優先，Pivot 不得消耗其 click。

### Canonical external store 採 memory-first 與明確衝突規則

沿用現有 `subscribeInstances` 概念，但將讀取、正規化、更新及持久化集中為 module-level store，React 端以 `useSyncExternalStore` 訂閱 immutable snapshot。單一 document 內所有 mutation 都是針對最新 snapshot 的 functional update，因此不得遺失快速連續操作。

更新順序固定為：驗證 updater 結果 → 更新 in-memory canonical snapshot 並通知 listeners → 嘗試寫入 v3 storage → 更新不含敏感內容的 persistence status。storage 不可用時，本次 document 繼續使用新的 memory snapshot，並提示「設定尚未保存」；原 v2 key 不刪除。同 origin 其他視窗透過 `storage` event 接收合法 envelope；跨視窗同時寫入明確採 last-write-wins，使用 envelope 的 revision／updatedAt／writerId tuple 排序，舊事件不得覆蓋較新 snapshot。

### Stable series 與完整遞迴狀態

以 `instanceId + outputKey` 作 series identity：

- instances、樣式、pane 次序、theme 或 timeframe visibility 改變時才 reconcile series／pane。
- K 棒資料改變時更新既有 series data，不銷毀 pane。
- current bar tick 以每 chart 最多一個 pending job、最長 500ms 的 latest-wins 排程刷新可見指標。
- unmount、切換商品或時框時取消舊 generation；runtime status 及排程以 `chart identity + instanceId + generation` 隔離。

SMA 類可使用 rolling window；EMA、MACD、Wilder RSI／ATR 等遞迴指標使用完整前序狀態或可證明等價的 prefix checkpoint。current bar 更新從最後穩定 checkpoint 重算尾端；新 bar 提交 checkpoint；history prepend 使受影響 checkpoint 失效並依完整 canonical rows 重建。任何最佳化都必須先以 full recompute fixture 驗證尾端逐點相同，不得只截取暖機期與可視區間。

### v3 instances 與 per-type defaults 分開遷移

新增 `sj-pro-indicators-v3` envelope；`sj-pro-indicators-v2` 保留作 migration source。另將 `sj-pro-ind-defaults-v1` 遷移到獨立的新版 defaults envelope，不把 defaults 混入 instances。

- RSI `period` 轉成 5／10；第一條可辨識樣式對應 short，long 使用參考預設。
- KD `period/k/d` 轉成 `period/rsvWeight/kWeight`；非法值回復 9／3／3。
- MACD `fast/slow/signal` 轉成新參數名稱，但 styles 繼續對應既有 `hist`／`macd`／`signal` keys。
- ATR 合法 period 保留，否則回復 14；其他類型保留合法參數與使用者呈現設定。

migration 可重入；v3 成功寫入前不得刪除 v2。v3 損壞時重新嘗試 v2 migration，兩者皆無法解析才使用空清單與安全 reason code。defaults 使用同樣原則獨立處理。

### Runtime 錯誤不寫入全域設定

`idle`／`computing`／`ready`／`error` 是 chart runtime state，不屬於全域 instance schema，也不持久化。單一 chart 的 compute／primitive error 只在該圖 legend 顯示「計算失敗」與安全 reason code，並保留設定、重試與移除入口；其他商品、時框、指標及主 K 線繼續運作。

## Risks / Trade-offs

- [RSI、KD、MACD 數值是 breaking change] → 固定來源 commit、formula version、fixture 與 migration notice；不保留 legacy 演算法作為預設。
- [八圖 current-bar 更新的 CPU 負載] → stable series、每圖單一 latest-wins job、prefix checkpoint、generation cancel 與固定資料集 browser profile；禁止以截短歷史改變數值。
- [同 origin 多視窗仍可能同時寫入] → 單一 document 保證原子更新；跨視窗明確採 deterministic last-write-wins，不宣稱 CRDT 合併。
- [固定區間選取與圖表下單共用 click] → 只有明確的設定區間模式可取 anchor，交易／停損／停利／警示模式永遠優先。
- [特殊 overlay 與 chart resize／pan 不同步] → 重用 primitive lifecycle，納入平移、縮放、resize、cleanup 與 autoscale 驗收。
- [STK／IND／WRT 最新交易日完成狀態無交易日曆佐證] → 只有後續實際交易日期存在時才標 completed；最新 group 保守標 provisional。
- [FUT／OPT Pivot 延後] → picker 明確顯示不支援；待權威交易日資料可用後另開 change，不以錯誤結果換取表面支援。
- [localStorage 損壞或 quota 失敗] → schema validation、非破壞 migration、memory-first snapshot 與安全 persistence status。

## Implementation Phases

1. **公式與 migration**：建立固定 fixture、共用公式核心、RSI／KD／MACD／ATR、MA pack、Volume MA5／10／20、BOLL parity，以及 instances／defaults migration。通過公式與 migration gate 後才進入階段 2。
2. **Canonical store 與 stable renderer**：完成 functional store、modal draft、跨視窗 LWW、stable series／pane、current-bar checkpoint、回測一致性、chart-scoped runtime status 及 1／2／4／8 圖驗收。
3. **FVG 與固定區間 Volume Profile**：以受控 primitive 完成公式、固定 anchors、zone lifecycle、互動優先權、viewport／resize／cleanup 驗收。
4. **股票類 Pivot**：只完成 STK／IND／WRT 日盤分組、Traditional 七線、歷史固定、provisional／completed、互動與多圖隔離；FUT／OPT 保持停用。

每個 gate 都執行其範圍內單元／component／browser 測試及 `pnpm run build`。在階段 1 建立實際可執行的 `test:browser` harness；本 repo 目前沒有 lint script，因此本 change 不列出不存在的 `pnpm run lint`，若未來新增 lint 必須另有明確 tooling task。

## Migration Plan

1. 在不切換 renderer 前先加入來源與延伸 fixture、v3/defaults migration reader／writer及回復測試。
2. v3 第一次成功寫入後仍保留 v2／defaults 舊 key；舊 key 不由本 change 刪除。
3. 完成階段 1 gate 後才啟用 breaking 公式；完成階段 2 gate 後才讓 external store 與 stable renderer 成為唯一寫入／渲染路徑。
4. FVG、固定區間 Volume Profile、Pivot 均預設關閉，分別在階段 3／4 gate 通過後開放 picker。
5. rollback 時回復同一階段程式碼；舊版本忽略 v3 並繼續讀 v2，不能用 rollback 刪除使用者資料。

## Open Questions

- 無阻擋問題。FUT／OPT Pivot 已明確移出本 change；Volume Profile 已固定為 chart-local 起訖 candle 區間。
