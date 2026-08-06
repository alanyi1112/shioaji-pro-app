## 本機驗收紀錄

- 日期：2026-08-06
- 環境：本機 `simulation`；`api_simulation=true`、API health healthy、2330 market snapshot available、Web listener up
- 安全邊界：只使用觀察游標與 UI 設定；未切換 production、未啟用下單模式、未送出委託，紀錄不含 API key 或其他秘密值

### 價量與時間區間

- IX0001／5m：最新形成中 K 棒可見顯示 `10:55–10:59`，欄位依序為開、高、低、最新、量；accessible title 為 `2026/08/06 10:55:00–2026/08/06 10:59:59`
- IX0001／1m：可見顯示 `10:56:00–10:56:59`，forming 欄位使用「最新」
- IX0001／5m 歷史游標：`2026/08/05 09:35:00–09:39:59` 使用「收」；在圖外操作後回到 2026/08/06 最新 K 棒
- 2330／5m 歷史游標：`2026/07/30 10:20:00–10:24:59` 顯示開 2,230、高 2,240、低 2,230、收 2,235、量 388

### 指標與版面

- 「K 棒價量」位於主圖疊加，重複選取顯示「已加入 1」並重開既有設定，沒有建立第二個 instance
- 設定頁只顯示時框；legend 可隱藏／顯示，5m 可停用／恢復，移除後可重新加入，重載仍保留設定
- 價量列固定在主圖數值區最上方；720px viewport 會換行，`scrollWidth === clientWidth`，沒有水平溢位
- 加入 RSI 副圖後，2026/08/05→2026/08/06 的 2 CSS px 跨日分隔線在主圖與副圖使用相同 X；移除 RSI 後 primitive 正常 cleanup
- 1／2／4／8 圖可見 fixture 均建立對應 readout；兩圖時點選第一圖歷史 K 棒，第二圖維持最新 K 棒；八圖無空白 readout、console error 為 0，未移動滑鼠仍觀察到 current-bar 更新
- 驗收結束已移除七張額外 K 線圖與 RSI，恢復單一 K 線圖，只保留本 change 的「K 棒價量」

### 自動驗證補充

- 1／2／4／8 圖不同時框、不同 canonical bars、不同 crosshair time 與高頻 current-bar 更新由 Vitest fixture 驗證
- pane manager fixture 覆蓋新增、移除、重排、history/theme update、平移／縮放重算 X 與 destroy cleanup
- primitive 沒有 `hitTest`、autoscale 或 series API，readout definition 也沒有 `outputs`／`compute()`，不介入 chart series 與交易模式
