## 1. 階段一：公式、definitions 與非破壞 migration

- [x] 1.1 將參考基準固定為 `MultiChartOnCodexSite` commit `ecae7cac837f06085801c96f3da0c570051d66e7`，加入 `multichart-ecae7ca-v1` formula version、最小 OHLCV fixture 與六位小數期望值，不建立跨 repo runtime 路徑依賴
- [x] 1.2 建立可重複執行的真實瀏覽器 `test:browser` harness 與 package script，供後續 lightweight-charts series／primitive、互動、resize 及 cleanup 驗收
- [x] 1.3 建立共用的 time 排序、warm-up whitespace、非有限值隔離、六位小數 rounding、有界整數及跨欄位參數驗證工具
- [x] 1.4 抽出單週期 `wilderRsiSeries`，讓 `rsi` 輸出 Wilder RSI5／10 雙線並加入 30／50／70 基準線；補齊固定值、平盤=50、單邊上漲=100、非法週期及既有 StochRSI 相容測試
- [x] 1.5 將 `kd` 改為 period／rsvWeight／kWeight 與 K、D 初始值 50 的 9／3／3 遞迴；補齊固定值、最高=最低、非法權值及 20／80 基準線測試
- [x] 1.6 將 MACD signal 零值暖機與輸出時點改為來源契約，參數改為 fastPeriod／slowPeriod／signalPeriod，但保留 `hist`／`macd`／`signal` output keys 與樣式 mapping
- [x] 1.7 核對並統一 ATR 第一根 TR、SMA seed、Wilder 遞迴及 period 範圍，加入來源 parity fixture
- [x] 1.8 新增 `reference-ma-pack` 的 SMA5／10／20／60／120，並讓既有 BOLL canonical 函式通過來源 20／2 fixture；保留單線 SMA／EMA／WMA 與可設定 BOLL
- [x] 1.9 新增 `volume-ma` 的 MA5／MA10／MA20：MA5／10 使用來源 fixture，MA20 使用相同 zero-inclusive SMA 契約的 RealTimeStock extension fixture，期數不足維持 whitespace
- [x] 1.10 為一般 series definition 增加明確 pane／price-scale render metadata，讓 Volume MA 在主圖及回測 renderer 都固定使用 `priceScaleId: 'vol'`
- [x] 1.11 更新設定 modal 的 RSI、KD、MACD、ATR 欄位、跨欄位錯誤、還原固定參考預設與可存取性；此階段先保留現有 store 接線
- [x] 1.12 建立 `sj-pro-indicators-v3` envelope、runtime schema validation 與可重入 v2 migration；保留 id、順序、hidden、visibleTf、precision、labels、values 及可安全對應 styles
- [x] 1.13 將 `sj-pro-ind-defaults-v1` 分開遷移至新版 defaults envelope，套用與 instances 相同的 RSI／KD／MACD／ATR 參數及 style mapping，不把 defaults 混進 instances
- [x] 1.14 加入 v3 損壞、v2 fallback、defaults 單類損壞、非法單一 instance、quota failure 及舊 key 不刪除測試
- [x] 1.15 確認 VWAP、SAR、SuperTrend、Donchian、Keltner、StochRSI、CCI、OBV、MFI、Williams %R、DMI、ROC、BIAS、自訂指標、搜尋、收藏、複製及時框顯示未被移除或改名
- [x] 1.16 **階段一閘門**：通過公式／definition／migration 單元測試、`pnpm test`、`pnpm run build`、最小 browser smoke test 與 `git diff --check`，並記錄 MA20 為 RealTimeStock extension；未通過不得進入階段二

## 2. 階段二：Canonical store、stable renderer 與即時更新

- [x] 2.1 將 instances 讀取、正規化、immutable snapshot、functional update 與訂閱集中為 module-level canonical store，React 端使用 `useSyncExternalStore` 或等效 external-store hook
- [x] 2.2 實作 memory-first 更新順序：先驗證並更新 in-memory snapshot／通知 listeners，再嘗試寫入 storage；失敗時保留新 snapshot、舊 v2 key及安全 persistence status
- [x] 2.3 為 v3 envelope 加入 revision／updatedAt／writerId，讓同 origin `storage` event 採 deterministic last-write-wins；非法或較舊事件不得覆蓋目前 snapshot
- [x] 2.4 將新增、修改、隱藏、排序、複製及移除全部改成針對最新 snapshot 的 functional update，移除以 React stale closure 重建整份陣列的寫入路徑
- [x] 2.5 將設定 modal 改為 local draft；取消只丟棄 draft，確認只 patch 最新 snapshot 中的目標 id，目標已被移除時顯示衝突而不重建
- [x] 2.6 加入同 document 多圖同步、快速連續 mutation、modal 開啟期間其他圖更新、取消不回滾及跨視窗 LWW 測試
- [x] 2.7 將 indicator renderer 改為以 `instanceId + outputKey` 對應 stable series／pane，分離結構 reconciliation 與 candle data refresh
- [x] 2.8 只有 instance 結構、樣式、pane 排序、theme 或時框可見性改變時才建立、移動或移除 series／pane；單純資料更新不得改變 pane identity、使用者高度或 stretch factor
- [x] 2.9 current bar tick 使用每 chart 最多一個 pending job、最長 500ms 的 latest-wins 排程；新 bar、初載及 history paging 使用 generation guard
- [x] 2.10 為 EMA、MACD、Wilder RSI／ATR 等遞迴公式建立完整前序狀態或 prefix checkpoint；current bar 從穩定 checkpoint 重算尾端，history prepend 使受影響 checkpoint 失效並重建
- [x] 2.11 加入每種最佳化與 full recompute 的逐點尾端 parity 測試，禁止使用「暖機期＋可視區間」截斷遞迴歷史
- [x] 2.12 讓回測圖 `renderIndicatorSeries` 使用相同 formula version、參數 migration、output keys、render metadata 與 stable lifecycle
- [x] 2.13 將 idle／computing／ready／error 保存為 `chart identity + instanceId + generation` runtime state，不寫入全域 storage；legend 顯示安全錯誤、重試、設定及移除入口
- [x] 2.14 加入 current-bar 讀值、history paging checkpoint rebuild、商品／時框切換無殘影、單圖錯誤不污染他圖及 pane 比例穩定測試
- [x] 2.15 建立固定資料集的 1／2／4／8 chart browser 測試，驗證每圖最多一個 pending job、無 pane teardown storm、快速操作可回應、console 無未處理錯誤，並保存 profile 結果供後續比較
- [x] 2.16 **階段二閘門**：通過 store、component、checkpoint、回測、1／2／4／8 圖 browser 測試、`pnpm test`、`pnpm run build` 與 `git diff --check`；未通過不得進入階段三

## 3. 階段三：FVG 與固定區間 K 線 Volume Profile

- [x] 3.1 沿用現有 discriminated `IndicatorDef` union，新增受控 built-in primitive／overlay variant，生命週期比照 `DayBoundaryPrimitive`；不得擴張自訂 `new Function` 的 DOM、網路或全域物件權限
- [x] 3.2 實作 bullish／bearish FVG 三根 candle 公式、最新二十個 marker 與最新十二個尚未 fully mitigated zones
- [x] 3.3 實作 FVG zone lifecycle：部分穿越不縮邊界；bullish 被後續 low 觸及下緣或 bearish 被後續 high 觸及上緣時才 fully mitigated 並停止延伸
- [x] 3.4 實作固定區間 Volume Profile 的 chart-local runtime anchors，key 為 chart／instance／symbol／timeframe；未設定時顯示「請設定固定區間」，不得猜測全部已載入或可視範圍
- [x] 3.5 新增明確的「設定區間」互動：只在游標觀察模式依序選取兩根 candle、反向選取自動正規化、兩端納入；交易／停損／停利／警示模式優先且不得被消耗
- [x] 3.6 實作固定區間 24 bins、streaming min/max、typical-price 歸戶、flat-range 單一有效 bin、POC 及 70% VAH／VAL；區間外 history paging、viewport 或新 bar 不得改變統計母體
- [x] 3.7 建立 FVG 與 Volume Profile 的 Lightweight Charts primitive renderer，支援 resize、平移、縮放、price scale、換商品、換時框、history paging、移除及 chart destroy cleanup
- [x] 3.8 在 picker、legend 與說明中使用「K 線固定區間 Volume Profile」，並與既有「逐筆分價量」清楚區分
- [x] 3.9 驗證兩種 primitive 不影響 K 線 autoscale、價格軸、crosshair、圖表下單、委託線拖曳、警示、自訂指標及其他 pane
- [x] 3.10 加入 FVG 偵測／部分穿越／完全填補、固定區間選取／反向選取／區間內更新／區間外不變、24 bins／POC／VAH／VAL、resize／cleanup 的單元與 browser 測試
- [x] 3.11 **階段三閘門**：通過 overlay 單元／browser 測試、1／2／4／8 圖 primitive 隔離、`pnpm test`、`pnpm run build` 與 `git diff --check`；未通過不得進入階段四

## 4. 階段四：STK／IND／WRT Traditional Pivot

- [x] 4.1 建立 `traditional-pivot` 純函式與固定 formula version，只接受合法 H／L／C 並輸出 P、R1～R3、S1～S3；加入來源 parity、非法 OHLC、上漲／下跌／平盤與六位小數 fixture
- [x] 4.2 以 contract `security_type` 限制 Pivot 只支援 STK／IND／WRT；FUT／OPT picker 必須停用或顯示「第一階段尚未支援」，不得計算 provisional 結果
- [x] 4.3 從 canonical raw 1m Shioaji rows 依 `Asia/Taipei` 日期建立 STK／IND／WRT 日 reference OHLC，不使用 UTC／曆日午夜 bucket、單根日內 candle、Worker、D1 或外部行情
- [x] 4.4 只有在下一個實際交易日期 rows 已存在時才把前一日期標為 completed；最新 group 保守標 provisional，預設 projection 只使用最後 completed reference
- [x] 4.5 新增預設關閉、可獨立選取且只適用現有 1m／5m／15m／60m／1D 的 Pivot definition／picker／legend
- [x] 4.6 建立 P、R1～R3、S1～S3 七條右向 primitive、價格標籤、reference／適用下一交易日／completed readout、標籤避碰與必要 autoscale helper，不建立假未來 K 棒
- [x] 4.7 支援游標觀察模式點選歷史 K 棒固定 reference 與鍵盤可操作的「回到最新」；點價買賣／停損／停利／警示模式 MUST 優先
- [x] 4.8 讓 Pivot 在 history paging、current session 更新、換商品、換時框、快速開關及 chart destroy 時維持 generation 隔離、viewport、autoscale 與其他指標不變
- [x] 4.9 加入 STK／IND／WRT 日期分組、休市缺口、completed／provisional、FUT／OPT 禁用、歷史固定、點擊優先權、七線值、autoscale、1／2／4／8 圖隔離及 cleanup 測試
- [x] 4.10 **階段四閘門**：通過 Pivot 單元／component／browser 測試、`pnpm test`、`pnpm run build` 與 `git diff --check`，確認 FUT／OPT 沒有被表面支援

## 5. 完整驗收與安全邊界

- [x] 5.1 執行 `pnpm test`、新建的 browser harness、`pnpm run build`、`openspec validate integrate-multichart-technical-indicators --strict`、`openspec validate --all --strict` 與 `git diff --check`；本 change 不執行目前不存在的 `pnpm run lint`
- [x] 5.2 在本機 simulation session 驗證 MA pack、BOLL、Volume MA5／10／20、RSI、KD、MACD、ATR、FVG、固定區間 Volume Profile 及 STK／IND／WRT Pivot 的新增、設定、隱藏、移除與重載
- [x] 5.3 在本機 1／2／4／8 圖驗證同 document 同步、current-bar、時框切換、history paging、modal 取消不回滾、固定區間不漂移、Pivot 歷史固定、pane 比例及 console 無未處理錯誤
- [x] 5.4 確認錯誤、log、通知與測試輸出不含自訂程式全文、完整市場資料、帳號、API key、token 或憑證
- [x] 5.5 確認本 change 未啟用 production、未送出真實委託、未加入來源 Worker／D1／Cloudflare 呼叫，並在 verification 記錄 formula version、來源 commit、四個階段 gate 及可見驗收結果
