## Context

主交易畫面以 React、TypeScript 與 Lightweight Charts 5.2 建立 `CandleChart`。既有 `DayBoundaryPaneManager` 已能依相鄰 candle 的台灣顯示日期，在所有 pane 的中點繪製分隔線，但顏色由一般 grid token 提供，因此辨識度不足。主畫面的歷史與即時台股成交量直接沿用 Shioaji Kbars／Tick；整股 `volume` 與 `total_volume` 的來源單位為 lot（張）。

MultiView 是 `apps/multiview/` 內的獨立靜態前端與 Worker runtime，固定使用 Lightweight Charts 5.0.9。分鐘 K 已透過本機 simulation coordinator 載入跨日 1 分 Kbars 並聚合為 5／15／60 分，但未建立跨日 primitive。其日 K completed history 主要來自 Yahoo／TWSE 的 share（股），盤中 overlay 則直接使用 Shioaji lot，造成同一 series 混用 1,000 倍不同的單位，也使主畫面與 MultiView 無法直接對照。

這項變更跨越兩個圖表 runtime、兩個 Lightweight Charts 版本、歷史與即時資料路徑，以及 source fallback 邊界。它只能使用既有本機 simulation 行情權限，不得擴張到 broker write、production 或遠端 Shioaji runtime。

## Goals / Non-Goals

**Goals:**

- 讓主交易畫面與 MultiView 的分鐘 K 都以醒目的亮黃色分日線清楚區分相鄰台北日期。
- 讓分日線在歷史補載、平移縮放、resize、pane 重建、商品／時框切換與匯出時維持正確且不殘留。
- 將本機台股整股圖表的 canonical 呈現單位固定為 `common_lot`（張），並保留來源原始單位與 provider metadata。
- 在本機 Shioaji 模式下，讓主畫面與 MultiView 日 K 對同一批 Kbars 使用同一聚合契約，成交量可精確比對。
- 讓 Yahoo／TWSE fallback 以完整 payload 原子切換，正規化單位但不冒充與 Shioaji 的來源值完全相同。
- 以 total-volume cursor、session、sequence 與 generation guard 防止 live volume 重送或倒序造成重複累加。

**Non-Goals:**

- 不改造既有 `intraday` 分時走勢圖，也不在日／週／月 K 繪製分日線。
- 不把台股整股與盤中零股、期貨、選擇權、指數或其他市場強制解讀為相同 volume unit。
- 不將 Shioaji 本機顯示資料寫成 TWSE／TPEx verified canonical history，也不取消既有收盤核定流程。
- 不要求 Yahoo／TWSE 與 Shioaji 在成交範圍不同時數值完全一致；fallback 只保證單位、來源標示與內部一致。
- 不升級 MultiView 的 Lightweight Charts 5.0.9，不新增外部 dependency、部署、production、CA 或交易能力。

## Decisions

### 1. 以 pane-native primitive 繪製分日線

兩個 runtime 都先以純函式從排序後 canonical candles 選出相鄰日期不同的 boundary pair，再由 primitive 使用 time scale 將兩根 K 的時間轉為 X 座標，畫在兩者中點。共同視覺契約為 1.2 CSS px 與亮黃色語意 token；預設色採 `#facc15`，主畫面可在 light theme 使用經對比驗證的同色系 token，但不得退回 grid color。renderer MUST 直接以 `1.2 × horizontalPixelRatio` 取得 bitmap 寬度，不得四捨五入成整數 CSS px。

主交易畫面沿用並改良既有 `DayBoundaryPaneManager`。MultiView 依 Lightweight Charts 5.0.9 支援的 series／pane primitive API，在主圖與每個 indicator pane 維持一個受 manager 管理的 instance；pane 建立、移除或重排後重新 reconcile。primitive 僅讀取 time scale，不建立資料 series、不參與 autoscale，也不攔截 pointer。

不採 DOM 絕對定位線，因為它容易在 time scale、HiDPI、匯出與獨立 indicator chart 同步時漂移；也不使用 markers，因為 markers 無法提供跨 pane 的全高垂直線。

### 2. 分日判定固定使用 Asia/Taipei 顯示日期

只有 canonical interval `1m`、`5m`、`15m`、`1h` 進入 selector。相鄰 candles 的 `Asia/Taipei` 日期 key 不同才建立 boundary；同日時間缺口不建立。這與主畫面既有午夜切換語意相容，也適用目前 MultiView 的台股分鐘 K。

本 change 不重新定義期貨夜盤的交易日歸屬。主畫面 FUT／OPT 仍只表示台北日曆日期換日，不因分隔線改寫 exchange trading date。

### 3. 台股整股 canonical 呈現單位固定為 common_lot

正規化函式必須同時接收 `provider`、`securityType`、`sourceVolumeUnit` 與非負有限值，輸出 `{ value, unit: "common_lot" }`：

- Shioaji 整股 STK Kbars／Tick 的 `Volume`、`volume`、`total_volume` 已是 lot，採 identity conversion。
- Yahoo／TWSE 的台股 daily volume 是 share，除以 1,000 後保留合法小數張；不得四捨五入、截斷或再乘回 1,000。
- 缺少可信 unit metadata、負值、非有限值或不適用商品時，volume 必須標示 unavailable，不得猜測。

來源儲存可保留 source-native value；正規化必須在 indicators、volume series、readout 與跨畫面比較之前完成。payload 與 cache key／revision 必須攜帶 unit revision，避免舊的無單位 payload 被當成新 canonical 值沿用。

MultiView 主圖 K 線 readout 固定依序顯示日期、開、高、低、收、成交量與漲跌。成交量直接取同一根 canonical candle，使用相同 `volumeContract` 格式化為張；readout 不另行推導或複製其他 DOM 列的文字。該列不顯示漲跌幅；右上角最新價摘要不在此 readout 契約範圍內。

選擇「張」而不是全面改成「股」，是因主交易畫面與本機即時權威路徑目前皆直接使用 Shioaji 整股 lot，使用者也要求 MultiView 與主畫面對齊。對 Yahoo／TWSE 採 `/1000` 只代表單位換算；若來源涵蓋盤中零股或其他成交範圍，UI 仍必須保留 provider 標示，不宣稱來源值 parity。

### 4. Shioaji 模式的本機日 K 使用完整、同源 display payload

本機 `自動` 且 Shioaji 可用，或使用者強制 `Shioaji 即時` 時，MultiView 日 K 的可見資料窗由 simulation-only Shioaji 1 分 Kbars依 `Asia/Taipei` 日聚合，當日尾端再以同一 session 的合法 Snapshot／Tick total-volume delta 更新。查詢使用既有 page-scoped single-flight、範圍 cache、response size 與 generation guard，不使用盤中固定輪詢。

這些 local display bars 不寫入 `candle_history`，也不取得「官方核定」身分。收盤後的 TWSE／TPEx verification 與 D1 canonical history 契約維持不變。若 Shioaji 不可用且模式允許 fallback，整份日 K payload 原子切換為已正規化至 common_lot 的 Yahoo／TWSE payload；不得保留 Shioaji volume 再混入其他來源 OHLC。

不採「只把盤中 total_volume 乘以 1,000」的修補，因為那會讓 MultiView 與主畫面仍使用不同來源與成交範圍，也無法提供精確 parity。不採把 Yahoo completed history 與 Shioaji 當日 bar 靜默拼接為同一權威 series；若產品保留跨 provider 的 fallback 顯示，metadata 必須讓使用者可辨識來源邊界。

### 5. live volume 以累計量 cursor 推進

主畫面與 MultiView 都為目前 `canonical symbol + session date + source generation` 保存最後接受的 `total_volume`、source time 與 sequence。新 Tick 的 volume delta 只能是相同 session 中單調前進的 `total_volume - previous_total_volume`；bootstrap 已含的累計量先建立 cursor，不得再次加入。重送、倒序、舊 session、舊 generation、累計量倒退或單位不符時，不增加 volume，且不得破壞現有 candle set。

價格是否仍可接受必須依既有行情完整性契約決定；volume 被拒絕時不得以 tick volume、零值或 Yahoo 值猜補。新台北日期必須以該 session bootstrap／Snapshot 建立新的 cursor。

### 6. 以共享 fixture 契約確保兩個 runtime parity

兩個 runtime 不強迫共用同一語言模組，但必須共用固定 fixture 與期望值：跨日 candle pairs、HiDPI 中點、Shioaji lot 日聚合、Yahoo／TWSE share-to-lot、bootstrap 後 total-volume delta、重送／倒序／跨 session，以及 provider fallback。整合測試必須把相同 Shioaji fixture 分別送入主畫面與 MultiView 聚合器並比較 daily OHLCV，避免只各自通過單元測試卻互相漂移。

## Risks / Trade-offs

- [風險] `#facc15` 在不同背景的對比不足 → 以主畫面 light／dark 與 MultiView dark 的 browser-visible screenshot 驗證，必要時只調整同一亮黃色 semantic token，不退回 grid color。
- [風險] MultiView 5.0.9 primitive API 與主畫面 5.2 不同 → 各自建立小型 adapter，使用相同 selector fixture，並測試 attach、detach、pane reconcile、resize、history prepend 與 destroy。
- [風險] 240 日左右的 1 分 Kbars 接近既有 response guard → 依實際 display window 分頁／有界載入，保留 100,000 rows 上限、single-flight 與 cache；超限時 fail closed 或使用完整 fallback，不回傳半套混源 payload。
- [風險] Yahoo／TWSE 可能包含 Shioaji 整股 stream 未涵蓋的成交 → fallback 僅宣稱 common_lot 單位一致，UI 保留 provider／source time，不宣稱與 Shioaji 數值完全相同。
- [風險] 舊 cache 沒有 volume unit → 提升 payload／source fingerprint revision；未知或舊 revision 不得直接當新 canonical volume，必須依可信 provider 重新正規化或失效重抓。
- [風險] reconnect 或 bootstrap 尾端與第一筆 Tick 重疊 → 以 session total-volume cursor 作為唯一 volume 推進依據，重送／倒序 fixture 與 fault test 必須證明不重複。
- [風險] 分日 primitive 在多圖與多 pane 增加繪製成本 → selector 只在 candles／interval 改變時計算 boundary，renderer 只畫 viewport 內可解析座標，更新採 latest-wins／requestUpdate。

## Migration Plan

1. 先加入純 selector、volume unit normalizer、fixture 與 source revision，不接 UI。
2. 接上主交易畫面分日色彩與 live volume cursor，通過 focused tests 及 browser-visible 驗收。
3. 接上 MultiView primitive manager、日 K 同源 display payload與 volume normalization，保留完整 fallback 與 generation guard。
4. 以同商品、同日期 Shioaji fixture及本機 simulation capability evidence完成兩個 runtime parity；不得保存完整行情或帳戶資料。
5. 執行兩個 runtime 的 focused／integration／browser tests、TypeScript、production build、OpenSpec strict 與 `git diff --check`。

此 change 不需要部署或資料庫破壞性 migration。rollback 可移除新 display adapter／primitive 並恢復舊 source revision；source-native cache 未被覆寫，因此不需反向轉換資料。

## Open Questions

無。產品方向已確認為分鐘 K、亮黃色分日線、台股整股以「張」呈現，以及本機 Shioaji 模式跨畫面同源 parity。
