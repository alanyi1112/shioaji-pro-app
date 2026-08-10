## 1. 共用契約與基線測試

- [x] 1.1 建立版本化 Traditional Pivot projection fixture，涵蓋 completed／provisional、reference／applicable period、七個 levels、分鐘 target mapping 與非法 OHLC，讓主交易畫面及 MultiView 對相同輸入通過精度一致性測試
- [x] 1.2 為 Fibonacci 建立 kind-aware modifier fixture，涵蓋回撤一般 A low／B high、Option／Alt A high／B low、空白區無效及拓展自由價位回歸
- [x] 1.3 為 canonical 1 分 K、5／15／60 分聚合、跨日、缺口、倒序／重送 Tick 與 volume delta 建立純函式 fixture
- [x] 1.4 同步 `apps/multiview/openspec` 中重疊的 Pivot、Fibonacci、interval 與本機分鐘 K 規格，並確認不加入 Cloudflare／Sites、多帳戶或 production gate

## 2. 主交易畫面 Pivot projection 與 canonical state

- [x] 2.1 將 `traditional-pivot` 純函式擴充為與 `selected-next-period-v1` 等價的 projection、target、reference status 及 applies-to contract，並通過與 MultiView fixture parity 測試
- [x] 2.2 建立以 indicator id、security type、exchange、canonical code 組成且不含 timeframe 的 product-scoped Pivot state，保存目前 reference、anchor、status、applies-to 與 levels
- [x] 2.3 將 Pivot 建立、固定歷史、回到最新、隱藏與移除限制在 1D，讓 1m／5m／15m／60m 訂閱同一 product projection 且不得自行重算 reference
- [x] 2.4 正規化既有 Pivot instance 的 `visibleTf` 為所有支援時框，只影響 Pivot 並保留其他 indicator 的原子 store、跨視窗同步與 migration 行為
- [x] 2.5 為多圖同商品／不同商品、快速切換、history paging、reload 回到最後 completed、FUT／OPT 不支援及 1D 刪除同步清理加入 unit／component tests

## 3. 主交易畫面 Pivot 視覺與互動對齊

- [x] 3.1 讓七線從 reference candle 向右延伸至價格軸安全邊界，並實作與 MultiView 相同的 P／R／S 色彩、R1／S1 強調、R2／S2 虛線及 R3／S3 點線
- [x] 3.2 實作固定排序的 Pivot 標籤避碰、必要短 connector、有限七值 autoscale helper，以及 reference 不在分鐘資料窗時夾到 plot 左側的行為
- [x] 3.3 將 readout 改為 reference、下一交易日、已完成／暫估與格式化七值；分鐘圖顯示「由 1D 管理」並移除會改變 Pivot 的控制
- [x] 3.4 驗證繪圖工具與點價／交易模式優先、較新 generation 勝出、cleanup 不污染 viewport／autoscale，以及 browser-visible 線型與標籤 parity

## 4. 兩個畫面的 Fibonacci Option／Alt

- [x] 4.1 將根目錄 Fibonacci resolver 改為 kind-aware modifier policy，使回撤 Option／Alt 使用 A high／B low 且仍要求合法 K 棒，拓展維持既有自由價位
- [x] 4.2 更新主交易畫面的 pointer preview、price guide、click commit、tooltip 與 pending notice，並通過 tick-size、未來空白區、保存及清除回歸測試
- [x] 4.3 將 MultiView `chart-annotations.js` 與 `app.js` 套用相同 modifier policy、可見文字及 fixture，確保 preview／commit 與主交易畫面一致
- [x] 4.4 執行兩邊 Fibonacci 公式、水準、色帶、autoscale、interval identity、分種類清除、跨 interval 全清除與完整 panel PNG 回歸

## 5. 本機 MultiView interval 與設定遷移

- [x] 5.1 建立 deployment-target-aware interval contract：本機允許 `1m`、`5m`、`15m`、`1h`、`1d`、`1wk`、`1mo`，UI 依序顯示 1m、5m、15m、60m、日、週、月，遠端維持 feature-off 既有行為
- [x] 5.2 更新本機 config、instrument payload、URL parser、localStorage migration、single-chart state、panel defaults、prefetch、cache key 與格式化文字，讓 `60m` 穩定映射 canonical `1h`
- [x] 5.3 更新本機 `/api/candles`、`/api/candles/batch` 與 `/api/stream` allowlist／錯誤回應，確認週、月維持可用，只有 `intraday` 及其他非法週期回 `unsupported_interval`
- [x] 5.4 新增舊 `1wk`／`1mo` 設定原樣保留、`intraday` 回退 `1d` 且不破壞商品、panel 順序、指標、註記或其他偏好的 migration tests
- [x] 5.5 更新 interval UI／API contract tests，確認本機分鐘與日週月同時可用，Cloudflare／Sites config、production build 與既有遠端 allowlist 沒有被本機分鐘能力誤開

## 6. Canonical 1 分歷史與分鐘聚合

- [x] 6.1 在本機 realtime coordinator 建立 `canonical symbol + start + end` 的 Kbars single-flight、range-covering bounded cache、simulation guard、response size guard 與不可變 snapshot
- [x] 6.2 依 1m 3 日、5m 7 日、15m 30 日、60m 60 日請求 canonical 1 分歷史，讓相同商品多 panel 與被較長範圍涵蓋的切換不重複查詢
- [x] 6.3 實作 `Asia/Taipei` session-aware 5／15／60 分 OHLCV 聚合，保留實際第一根 time、跨日切 bucket、缺口 continuity 且不補造 candle
- [x] 6.4 擴充 Kbars/session point contract 保留完整 OHLCV 與來源 metadata，不再把 minute bootstrap 壓成只有 close／average price／volume 的折線模型
- [x] 6.5 為合法／非法 bootstrap、重疊 range、八 panel 重複商品、跨日、缺口及快取 eviction 加入 coordinator 與 aggregation tests

## 7. Tick 尾端、fallback 與 Candlestick pipeline

- [x] 7.1 實作 bootstrap 前 pending Tick 與 bootstrap 後 source time／sequence 去重，正確更新目前 1 分 open／high／low／close 及未重複 total-volume delta
- [x] 7.2 讓 canonical 1 分尾端重聚合目前 5／15／60 分 provisional bucket，拒絕倒序、重送、舊 session、非法價格、負量與舊 generation
- [x] 7.3 將四個分鐘時框接入一般 Candlestick、volume、readout、跨日分隔、history paging、viewport、indicator latest-wins、Pivot、Fibonacci、autoscale 與 panel export pipeline
- [x] 7.4 保持 MultiView Pivot panel-local 選取，但分鐘 interval 必須另取相同 provider／時區的 daily reference history，不得使用單根分鐘 K 代替完整交易日
- [x] 7.5 實作自動模式的完整 Yahoo delayed payload 原子 fallback、強制 Shioaji 的 partial／unavailable 顯示與強制 Yahoo 的 demand 釋放，禁止不同來源 OHLCV 混接
- [x] 7.6 停用新分鐘選單對舊 `intraday` 折線分支的依賴，確認分鐘圖不隱藏 Fibonacci、Pivot、技術指標或其他 K 線工具

## 8. 完整驗證與交付

- [x] 8.1 執行 root unit tests、MultiView targeted／full tests、root browser tests、兩邊 build、MultiView lint/typecheck，並修正所有 Pivot、Fibonacci、interval、realtime 與 viewport regression
- [x] 8.2 在 `127.0.0.1:5173` simulation 可見驗證主交易畫面 1D 建立／固定／回到最新／刪除 Pivot，確認 1m／5m／15m／60m 同組七線、MultiView 視覺 parity 與 console 無未處理錯誤
- [x] 8.3 在 `127.0.0.1:5174` simulation 可見驗證 1／2／3／4／6／8 panel 的時間週期標籤與 1m／5m／15m／60m／日／週／月選單，並回歸重複商品、快速切換、即時尾端、跨日、fallback、Pivot、Fibonacci、主副圖指標及完整 panel PNG
- [x] 8.4 核對頁面級 SSE 至多一條、同商品 Kbars range single-flight、無固定 Kbars 輪詢、無 production／真實下單能力，且驗收紀錄不含完整行情、帳戶、credential 或個人識別
- [x] 8.5 執行 root 與 `apps/multiview` OpenSpec strict validation、`git diff --check`、安全掃描與 Git 精準範圍檢查；只記錄本機 simulation 證據，不建立 Cloudflare／Sites、多帳戶或正式站未完成項目
