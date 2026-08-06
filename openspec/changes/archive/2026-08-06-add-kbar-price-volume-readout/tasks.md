## 1. Definition 與持久化模型

- [x] 1.1 實作 `series`／`readout` 可辨識 definition union，讓既有技術指標維持原行為且 readout 不需要 `outputs`、`compute()` 或 chart series
- [x] 1.2 新增「K 棒價量」picker metadata、搜尋別名及單一實例標記，並為 runtime schema、load／save 與舊 storage 過濾補齊可重入測試
- [x] 1.3 在開始修改共用 indicator definition／store 前重查 `integrate-multichart-technical-indicators` 的實際實作狀態，合併 typed union 而不覆蓋任一 change 的契約

## 2. Picker、設定與 legend 控制

- [x] 2.1 在「主圖疊加」顯示無線條色票依賴的「K 棒價量」項目，驗證名稱、價量、OHLCV、開高低收與時間區間搜尋
- [x] 2.2 實作單一實例加入流程；重複點選不得新增 instance，改為聚焦既有設定或顯示「已加入」
- [x] 2.3 建立 readout 專用設定與 legend 控制，只保留隱藏／顯示、適用時框及移除，不顯示線型、顏色、複製、上移或下移
- [x] 2.4 將可見 readout 固定 render 在主圖顯示數值區第一列，並以 component／DOM 測試證明一般指標排序與持久化陣列相對順序未被改寫

## 3. 時間區間與 OHLCV 讀值

- [x] 3.1 建立台灣市場 wall-clock 時間區間 formatter，覆蓋 1m `HH:mm:ss–HH:mm:ss`、5m／15m／60m `HH:mm–HH:mm`、跨日期雙端 `MM/DD` 與 1D 交易日期
- [x] 3.2 由 `barsRef` 建立目前 generation 的 time index，讓 crosshair time 查找同一根 canonical candle；不得使用 snapshot、Y 座標或其他時框資料
- [x] 3.3 實作固定欄位順序「開、高、低、收／最新、量」、商品價格精度及 volume 整數千分位 formatter
- [x] 3.4 讓圖上第一欄只顯示時間區間，明確移除「回報價量」與「K 棒價量」前綴，並為完整區間及欄位加入 tooltip／accessible name
- [x] 3.5 實作 crosshair 離開、沒有 time、未來空白區回到最新 candle，以及載入中／無 candle 時所有欄位顯示 `—`

## 4. Forming／completed lifecycle

- [x] 4.1 以 chart-local `formingBarTime` 記錄合法 live quote 建立或更新的目前 bucket，新 bucket 出現時立即將前一根視為 completed
- [x] 4.2 為日內 K 建立可取消的 bucket boundary timer，區間結束且沒有下一筆 tick 時仍將「最新」切回「收」
- [x] 4.3 為 STK／IND／WRT 1D 建立可測試的台灣 session 結束判定；FUT／OPT metadata 不足時保守顯示「收」，不得以尾端資料列猜測 forming
- [x] 4.4 加入歷史尾端、盤中 forming、新 bucket、收盤無 tick、斷線 stale、股票日盤與期貨跨午夜的 lifecycle fixture

## 5. 跨日粗分隔線

- [x] 5.1 建立台灣顯示日期 boundary selector，只在 1m／5m／15m／60m 的相鄰 canonical candles 日期改變時產生邊界，同日資料缺口與 1D 不得產生本分隔線
- [x] 5.2 實作 2 CSS px `DayBoundaryPrimitive`，以 theme grid color 在相鄰 candles 的 X 座標中點及 pane background 繪製，並依 device pixel ratio 保持一致視覺粗細
- [x] 5.3 對所有現存主副圖 pane reconcile primitive attachment，驗證副圖新增／移除／重排、平移、縮放、resize、theme、history paging 與 chart destroy 的更新及 cleanup
- [x] 5.4 加入股票隔日、期貨跨午夜、同日資料缺口、1D 排除、主副圖 X 對齊、舊 generation 丟棄及不影響 autoscale／crosshair／圖表點擊的測試

## 6. 多圖、即時更新與安全隔離

- [x] 6.1 將 crosshair、live quote、初始載入、history paging 與商品／時框切換整合到同一個有界 latest-wins readout scheduler
- [x] 6.2 加入 generation guard 與 cleanup，確保舊商品、舊時框及已 unmount chart 的 callback／timer 不得寫回
- [x] 6.3 驗證全域 instance 只同步啟用／隱藏／時框設定，各 `CandleChart` 的 crosshair time、forming 狀態與讀值互相隔離
- [x] 6.4 驗證 readout 更新及跨日 primitive 不新增／銷毀 chart series、不重設 autoscale 或副圖 pane，且不攔截觀察、點價交易、停損、停利、警示與 Pivot 點選事件

## 7. 驗證與可見驗收

- [x] 7.1 加入 formatter、canonical lookup、單一實例、固定置頂、形成中語意、空白 fallback、無資料與 storage migration 的單元及 component／DOM 測試
- [x] 7.2 在 1／2／4／8 圖 fixture 驗證不同商品、時框與 crosshair 位置的隔離、跨日線對齊，並確認高頻 current-bar 更新不需要再次移動滑鼠且沒有未處理錯誤
- [x] 7.3 執行本專案現有的 `pnpm exec tsc -b --pretty false`、相關測試、`pnpm run build`、`openspec validate add-kbar-price-volume-readout --strict`、`openspec validate --all --strict` 與 `git diff --check`（本專案沒有 `lint` script）
- [x] 7.4 在本機 simulation session 進行 browser-visible 驗收：加入／重複加入／隱藏／移除／重載、時間區間置頂、歷史 OHLCV、形成中最新價、游標離開 fallback、跨日粗分隔線、狹窄版面及多圖隔離
- [x] 7.5 記錄本機驗收使用的商品、時框、K 棒區間、跨日邊界與非秘密結果；不得以右上角 snapshot、測試假資料或 production／真實下單取代可見驗收
