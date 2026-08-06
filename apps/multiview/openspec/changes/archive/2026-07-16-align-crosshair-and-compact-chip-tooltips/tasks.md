## 1. 固定對齊、tooltip 與版面 contract

- [x] 1.1 擴充 `tests/rendered-html.test.mjs` 與前端 debug contract，固定每個 panel 只有一個共用垂直線、各原生 chart 不得再顯示互相錯位的垂直線，且 overlay 必須為 `pointer-events: none`。
- [x] 1.2 建立可重複量測的 1px 對齊驗收 helper，以 `element left + timeToCoordinate(date)` 比較主圖、技術副圖與所有可見籌碼 pane，涵蓋 visible range 左／中／右日期、平移、縮放、resize、pane 增減及 TDCC 級距切換。
- [x] 1.3 加入逐日 tooltip contract，確認每種 chart／dataset 依游標 `sessionDate` 查值，`null`／部分資料不轉成 0，游標離開、panel 重建與 pane 移除後不殘留舊讀值。
- [x] 1.4 加入 TDCC contract，確認只有精確 `dataDate` 顯示週值；非發布日顯示「當日無發布資料」，最近一筆參考值必須附實際日期且不得畫到游標日。
- [x] 1.5 加入 CSS／DOM contract，確認方式 B 沒有永久最新讀值明細列，桌面技術副圖為 96–120px、籌碼 pane 為 88–104px，tooltip 不占 layout，且 document 仍是唯一垂直捲動容器。

## 2. 實作共用幾何與垂直 crosshair

- [x] 2.1 在 panel lifecycle 建立 canonical cursor state 與 re-entry guard，讓主圖、技術副圖、籌碼 pane 的 crosshair event 共用同一個 `sessionDate` 與 screen X，且不形成循環更新。
- [x] 2.2 統一主圖、技術副圖與籌碼 chart 的左右 plot geometry／價格軸 gutter；移除大戶／散戶造成左側 plot 起點不同的可見 price scale，並在資料、pane、mode、focus、resize 改變後重新同步。
- [x] 2.3 在每個 panel 建立單一垂直 overlay line，關閉獨立 chart 的原生垂直線，依主圖頂端、最後可見 pane 底端與共用日期 X 座標更新位置。
- [x] 2.4 將 document scroll、ResizeObserver 與 layout refresh 以 `requestAnimationFrame` 合併更新 overlay 與 alignment report，確保共用線不中斷、不攔截 wheel／touch／drag／zoom 操作。
- [x] 2.5 回歸 A／B、1／2／3、4／6／8 與 focus 切換，確認隱藏 chart 不接收 crosshair／resize，返回原模式後 visible range、日期與選取狀態正確恢復。

## 3. 實作逐日浮動 tooltip 與 TDCC 缺值語意

- [x] 3.1 為主圖、KD／RSI／MACD／ATR 及所有籌碼 controller 建立 `resolveReadout(sessionDate)` 日期索引，補齊法人、外資持股、融資、融券、借券與大戶／散戶的逐日欄位、組成值、狀態與來源。
- [x] 3.2 建立不參與 layout flow 的 HTML tooltip，依共用 X 座標顯示並在左右邊界自動換側；加入可及性文字，正負、缺值及狀態不得只靠顏色辨識。
- [x] 3.3 將 tooltip DOM 更新合併至單一 animation frame，只更新可見且內容有變化的 pane；游標離開、日期超出 range、切換商品／週期、pane 隱藏或 panel 銷毀時完整清理。
- [x] 3.4 實作 TDCC 精確 `dataDate` resolver：發布日顯示比例、週增減、張數、人數、級距與來源；非發布日先顯示「當日無發布資料」，最近一筆僅能以附日期的參考區顯示。
- [x] 3.5 保留方式 A 單一副圖槽位與方式 B 多 pane 的相同 tooltip 語意，確認 ETF、普通股、部分資料、不適用、stale cache 與歷史累積中狀態不會退回最新值或上一個商品資料。

## 4. 套用緊湊方式 B 副圖版型

- [x] 4.1 重整籌碼 pane header，只保留名稱、必要狀態、TDCC 級距選單與移除控制；移除永久最新值、日期、組成明細及其不可見占位高度。
- [x] 4.2 調整方式 B 的技術副圖、籌碼 pane、chart container、price label 與間距，使桌面高度符合規格並維持數值、零軸、比例線與正負柱可讀。
- [x] 4.3 為 2／3 圖與窄螢幕處理 header 截斷、控制換行、tooltip 邊界及價格軸寬度，確認沒有頁面水平捲軸或 panel 內垂直捲軸。
- [x] 4.4 回歸方式 A、4／6／8 圖與聚焦模式的固定視窗／單一槽位，確認緊湊 stack CSS 不外溢到這些模式。

## 5. 驗證、發布與正式站驗收

- [x] 5.1 執行 `node --check`、`npm test`、`git diff --check` 與 `openspec validate --all --strict`，確認未新增秘密值、外部依賴、API 或 D1 migration。
- [x] 5.2 以桌面瀏覽器實測 1／2／3 圖方式 B 至少五個籌碼 pane，對左／中／右日期及各項 layout 操作執行 1px 對齊量測，並截圖確認共用垂直線從上到下連續。
- [x] 5.3 以普通股與 ETF 驗證法人、融資券、借券、大戶／散戶逐日 tooltip；特別確認 `null`、部分資料、TDCC 非發布日及最近一筆參考日期語意。
- [x] 5.4 以窄螢幕與 wheel／touch 驗證 tooltip 換側、共用線、頁面整體捲動、水平拖曳／縮放及控制可操作性，並回歸 A、4／6／8 與 focus。
- [x] 5.5 提交並推送通過驗證的 exact source，建立及部署新的 Codex Sites version；以已登入正式站確認 1px 對齊、緊湊高度、逐日 tooltip、TDCC 缺值語意、document 捲動與 console 無錯誤後再回報完成。
