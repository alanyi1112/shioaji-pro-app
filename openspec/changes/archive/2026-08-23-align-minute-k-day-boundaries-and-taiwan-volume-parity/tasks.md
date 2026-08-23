## 1. 契約核心與固定對照資料

- [x] 1.1 建立不含帳戶或完整行情的共享 fixture，涵蓋跨台北日期／同日缺口、Shioaji lot 日聚合、Yahoo／TWSE share-to-lot 小數張、bootstrap cursor、重送、倒序、跨 session 與 provider fallback，並固定兩個 runtime 的期望 OHLCV
- [x] 1.2 實作並測試來源感知的台股整股 volume normalizer 與 normalization revision，證明 Shioaji lot 採 identity、Yahoo／TWSE shares 除以 1,000 且保留小數張，未知／舊 unit metadata fail closed
- [x] 1.3 補齊純 day-boundary selector 契約測試，證明只對 `1m`／`5m`／`15m`／`1h` 的相鄰 `Asia/Taipei` 日期變化建立 boundary，同日缺口、`intraday`、日／週／月不建立

## 2. 主交易畫面垂直切片

- [x] 2.1 將 `DayBoundaryPaneManager` 接到獨立亮黃色 semantic token，維持 1.2 CSS px、中點、HiDPI、所有 pane、background z-order 與 theme 對比，並更新 primitive／browser-focused tests
- [x] 2.2 將主交易畫面 STK 歷史、forming candle、成交量柱、readout 與 volume-derived indicators 明確接到 `common_lot` canonical volume，使用 session／source time／sequence／generation／`total_volume` cursor 阻止 bootstrap 重複、重送、倒序及舊 session 累加
- [x] 2.3 在主交易畫面以 1m／5m／15m／60m、light／dark、主圖＋副圖、歷史 prepend、平移縮放、resize 與商品／時框快速切換完成可見驗收，確認亮黃色分日線及成交量一致且 console 無未處理錯誤

## 3. MultiView 分鐘 K 分日線垂直切片

- [x] 3.1 依固定 Lightweight Charts 5.0.9 建立 MultiView pane-native day-boundary primitive 與 manager，使用共享 selector fixture 驗證 1.2 CSS px、中點、亮黃色、attach／detach、requestUpdate 與 destroy
- [x] 3.2 將 manager 接入 Candlestick、volume 與每個技術 pane 的 production lifecycle，在 payload、分鐘 bootstrap／Tick、history prepend、viewport、pane reconcile、interval／symbol generation 與 panel destroy 時正確更新且不影響 autoscale／pointer
- [x] 3.3 完成 MultiView 1／2／4／8 panel 的 1m／5m／15m／60m browser-visible 與完整 panel PNG 驗收，涵蓋跨日、同日缺口、主副圖 X 對齊、快速切換、resize、縮放與舊 primitive cleanup

## 4. MultiView 台股日成交量 parity 垂直切片

- [x] 4.1 將 Worker candle payload、indicators、readout 與 cache/source fingerprint 接上 `provider + sourceVolumeUnit + common_lot + normalizationRevision`；MultiView 主圖 readout 依序顯示開高低收、成交量、漲跌並移除漲跌幅，讓舊或未知 unit payload 失效重抓／重新正規化而不污染 volume-derived indicators
- [x] 4.2 在本機 `自動` Shioaji 可用與強制 `Shioaji 即時` 模式，使用既有 simulation-only、single-flight、範圍 cache、100,000 rows guard 與 generation guard 載入有界 1 分 Kbars日聚合完整日 K display payload，且不寫入 D1 verified canonical history
- [x] 4.3 將當日 Snapshot／Tick provisional tail 接到同 session `total_volume` cursor，證明 bootstrap 後只加入未計入 delta；來源失效時以完整 Yahoo／TWSE `common_lot` payload 原子 fallback，不混接 provider、OHLCV 或 unit
- [x] 4.4 以相同 STK、相同台北日期與相同 Shioaji fixture執行主畫面／MultiView integration parity，要求 daily OHLCV、成交量柱及 volume-derived input 完全相同；另驗證 Yahoo／TWSE fallback 只宣稱單位一致並保留 provider 差異
- [x] 4.5 在 `127.0.0.1:5174` 既有本機 simulation capability 上完成日 K 正向、斷線 fallback、source mode 切換、收盤 handoff 與跨畫面可見 evidence；只記錄商品、日期、provider、unit、摘要值及 reason code，不保存帳戶、credential 或完整行情 payload

## 5. 文件與獨立 closure

- [x] 5.1 更新 README／runtime 文件與受影響驗收矩陣，說明「分 K」為分鐘 K、亮黃色分日線適用時框、台股整股 volume 單位為張、Shioaji 同源 parity 及 Yahoo／TWSE fallback 不保證來源值相同
- [x] 5.2 執行主畫面與 MultiView focused tests、共享 fixture integration、browser tests、TypeScript、兩個 production build、OpenSpec strict 與 `git diff --check`，並修正所有 P0／P1
- [x] 5.3 由獨立 P0／P1 closure 檢查跨模組 source/unit race、bootstrap/Tick crash window、舊 generation／cache replay、primitive cleanup、fallback 原子性、simulation-only 與無 broker authority 邊界；全部通過後更新 tasks／evidence
