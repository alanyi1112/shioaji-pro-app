## 1. 歷史昨收索引與價格判色

- [x] 1.1 在 K 棒 readout 純函式層由 canonical 原始 1 分 K 建立 STK／IND／WRT 的「交易日 → 前一 completed session 最後 close」索引，使用現有 UTC-shaped 台灣 wall-clock 日期鍵並跳過無效數值。
- [x] 1.2 將歷史昨收索引接入每個 `CandleChart`：初始載入、歷史 prepend、商品／時框切換時重建，並由既有 generation guard 與 latest-wins 排程刷新目前 readout。
- [x] 1.3 更新 reference resolver：當日 STK／IND／WRT 優先使用目前有效 reference；歷史日使用索引；缺值 fail-closed 為 flat；FUT／OPT 維持既有 forming-only 規則。
- [x] 1.4 保持開、高、低、收／最新使用 `priceDirection`，時間與成交量固定中性，並驗證週末最新 session、載入邊界與多圖之間不殘留舊方向 class。

## 2. Indicator readout metadata 與渲染

- [x] 2.1 在 series indicator definition 增加 optional readout metadata，宣告 row label、可見 output 順序與 prefix，且不改變 outputs、compute 回傳 shape、series 建立順序或 persistence schema。
- [x] 2.2 設定 BOLL 為上／中軌／下，volume-ma 為「均量」及 5MA／10MA／20MA，reference-ma-pack 為「均線」及 5MA／10MA／20MA／60MA／120MA。
- [x] 2.3 調整 legend formatter／renderer，將每個 prefix 與數值以相同 output 顏色呈現；缺值保留 prefix 並顯示 `—`，其他未宣告 metadata 的 indicators 保持既有顯示。
- [x] 2.4 調整 legend CSS、tooltip 與 accessible name，允許只在 output 單位之間換行，且不得裁切、覆蓋價格軸或新增高頻 assertive live region。

## 3. 驗證與回歸

- [x] 3.1 補上昨收索引測試，涵蓋非連續交易日、第一個載入日缺值、prepend 補齊、排序／無效資料、週末最新 session 與 FUT／OPT 排除。
- [x] 3.2 補上 BOLL、均量、均線 readout metadata／formatter 測試，鎖定 row label、output 順序、prefix、顏色與缺值。
- [x] 3.3 補上 renderer／browser 驗收，確認截圖紅框的文字與色彩、窄版換行、tooltip／accessible name、K 棒價量置頂及多圖隔離。
- [x] 3.4 執行 `pnpm test`、`pnpm build`、`openspec validate --all --strict` 與 `git diff --check`，確認沒有改變行情 API、指標公式、交易流程或 production 邊界。
