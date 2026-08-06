## 1. 來源基準與純函式

- [x] 1.1 固定 `MultiChartOnCodexSite` 最新可驗證 commit `ecae7ca` 的 `chart-annotations.js`、`app.js`、正式 specs 與測試，加入 `multichart-ecae7ca-fibonacci-v1` version、回撤／拓展水準、比率文字與價格 fixture，不建立跨 repo runtime dependency
- [x] 1.2 實作有限值 validation、回撤 `B-r×(B-A)` 與拓展 `C+r×(B-A)` 純函式，涵蓋上漲、下跌、平盤及非法輸入
- [x] 1.3 實作共用錨點 resolver：A=low、B=high、C=low、Option／Alt 自由價位、空白區及 tick-size 正規化
- [x] 1.4 加入 preview、`待選 A／B／C｜價格` 導引與 click commit 使用相同 resolved time／price、空白區不建立假 candle 及無法換算時拒絕的測試

## 2. Annotation controller 與本機保存

- [x] 2.1 建立 idle／pending-retracement／pending-extension／completed 的純 controller 與 immutable snapshot
- [x] 2.2 支援 arm、preview、add point、complete、Escape cancel、分種類 clear、clear all 及剩餘錨點數
- [x] 2.3 實作同 identity 回撤／拓展各一張、重畫同類取代、完成 order 與彩色／單色角色正規化
- [x] 2.4 建立 versioned storage key 與 schema，identity 包含 security_type、exchange、canonical code、timeframe minutes
- [x] 2.5 只保存 completed；加入 reload、換 identity、損毀版本、非有限 anchors、同類重複、quota 失敗及記憶體 fallback 測試
- [x] 2.6 確保 storage、錯誤、log 與提示不包含帳戶、委託、成交、完整市場資料、API key、token 或憑證

## 3. SVG overlay 與視覺契約

- [x] 3.1 在 chart plot 上建立 React 管理、`pointer-events: none` 的 SVG overlay，並提供綁定 `chart identity + panelInstanceId + generation`、latest-wins 排程及可銷毀的 renderer lifecycle；panelInstanceId 每次 mount 唯一且不持久化
- [x] 3.2 依來源深色基準色票繪製 1 CSS px 水平實線、波段虛線、七級色、比率／價格標籤與 plot 安全邊界；非深色主題維持同等對比及非純顏色辨識
- [x] 3.3 讓較早圖使用 `#fb7185` 至 `#818cf8` 七級色與 `0.12` opacity bands，較晚圖使用 `#cbd5e1` 單色且完全不建立 band polygon，pending 使用 `0.72` opacity
- [x] 3.4 繪製下一 A／B／C 的 10 CSS px、1 CSS px 小型十字、固定／完成的半徑 4 CSS px 空心圓、暫態波段導引線與可計算水準；preview 不得同時顯示圓形
- [x] 3.5 繪製 `#38bdf8`、1.5 CSS px 實線、4 CSS px halo 與等寬 `待選 A／B／C｜價格` 標籤；只讀 resolved pending preview，不改寫原生十字線或其他 pane
- [x] 3.6 只有 completed extension 以 B／C 時間的有界透明 helper 納入最低／最高水準，依 signature 避免重複 `setData`，清除、換 identity 或 destroy 後完整移除
- [x] 3.7 訂閱 time scale、price scale、ResizeObserver、history paging 與 current data generation，從 canonical anchors 重算座標；加入縮放、平移、resize、價格軸拖曳、標籤邊界、色帶順序、pending autoscale、舊 generation 丟棄及 cleanup 測試

## 4. CandleChart 工具與交易安全

- [x] 4.1 在 `CandleChart` 工具列加入回撤、拓展與清除入口，顯示目前工具、下一錨點及剩餘點數
- [x] 4.2 建立單一 pointer move／click dispatcher；啟動費波那契時切回 observe 並取消固定區間／Pivot pending，Fibonacci pending 輸入只交給 annotation controller
- [x] 4.3 使用者切換 buy／sell／stop／take／alert 或其他選點工具時先取消 pending，再啟動原模式；completed overlay 維持可見
- [x] 4.4 加入 Escape listener、失焦／換商品／換時框取消、unmount cleanup，避免重複 listener 與舊 generation callback
- [x] 4.5 pending 期間暫時隱藏主圖價格 LineSeries 原生實心 crosshair marker，新建 series 亦遵守 pending 初值；完成、取消、清除、restore 或 unmount 後還原各 series 原設定
- [x] 4.6 驗證 pending pointer move／click 不呼叫 `setPickedPrice`，click 不呼叫 `placeQuickOrder`、`addTrigger` 或其他委託／警示副作用
- [x] 4.7 驗證費波那契完成後既有點價、停損、停利、警示、委託線、十字線、指標設定與 history paging 行為不變

## 5. 多圖、效能與完整驗收

- [x] 5.1 加入相同／不同商品與時框的 1／2／4／8 圖 controller、storage、overlay 及 rapid-switch generation 隔離測試
- [x] 5.2 驗證 current bar 更新只重繪必要 SVG，不反覆建立 helper、listener 或造成 pane／viewport reset
- [x] 5.3 執行 annotation unit、component、storage、overlay、交易安全及效能測試，再執行完整 `pnpm test`
- [x] 5.4 執行 `pnpm run test:browser`、`pnpm run build`、`openspec validate integrate-multichart-fibonacci-tools --strict`、`openspec validate --all --strict` 與 `git diff --check`；目前沒有 `lint` script，不得呼叫不存在的 `pnpm run lint`，除非另有明確 tooling task 新增
- [x] 5.5 在本機 simulation session 驗證回撤／拓展吸附、Option／Alt、preview、完成順序、重畫、Escape、分種類清除、reload、換商品／時框與 autoscale
- [x] 5.6 在本機 simulation 以 1／2／4／8 圖驗證多圖隔離、繪圖期間不改寫訂單點價／不送單／不建警示、切回交易模式取消 pending、crosshair marker 正確還原，且 console 無未處理錯誤
- [x] 5.7 確認未啟用 production、未送出真實委託、未新增 Worker／D1／Cloudflare／外部行情依賴，並記錄來源 commit、可見驗收結果與通用 PNG 匯出仍為 non-goal
