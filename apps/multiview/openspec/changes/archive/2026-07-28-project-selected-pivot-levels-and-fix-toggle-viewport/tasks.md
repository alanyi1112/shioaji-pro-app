## 1. Worker 下一期 Pivot 投影契約

- [x] 1.1 擴充 `worker/pivot-points.ts` 型別與純函式，讓 projection 以 reference time／period key 保存 P、R1～R3、S1～S3、`completed`／`provisional` 與適用期語意。
- [x] 1.2 沿用 Traditional 公式，實作日、週、月 K 以該參考期 OHLC 計算下一同類交易期，並拒絕缺值、非有限數值及 `H < L`。
- [x] 1.3 實作日內 candle 依來源交易所時區對應交易日，使用同 provider 的 daily-based OHLC，且排除單根日內 K 與 extended-hours 聚合作為參考值。
- [x] 1.4 實作完整／未完成參考期判定；下一個實際 period 未知時只回傳「下一交易日／週／月」語意，不製造假日期或假 candle。
- [x] 1.5 更新 `worker/market-data.ts` 的 projection 產生、display time 裁切與 history prepend 流程，確保 reference key、完成狀態及 projection 不漂移。
- [x] 1.6 更新 `/api/candles`、`/api/stream` 與 Pivot cache contract version，讓 snapshot、stream 與 cache 使用相同 projection 語意並安全拒絕舊 contract。
- [x] 1.7 維持 Pivot lazy 載入、日內 bounded daily reference single-flight 與失敗隔離，未啟用時不得新增高週期上游請求。

## 2. Pivot 切換與 viewport 穩定性

- [x] 2.1 在 panel state 保存 projection map、預設／固定 reference key、完成狀態與 Pivot mode，並維持多 panel 隔離。
- [x] 2.2 啟用 Pivot 時以目前 candle 數作為最小 `display_count`，並拒絕以較短 Pivot cache entry 覆蓋較長的 `lastPayload.candles`。
- [x] 2.3 取消 Pivot 時只清除 Pivot overlay、readout、autoscale helper 與 selection，保留目前 candle payload、其他指標、副圖及註記。
- [x] 2.4 取消後關閉 Pivot stream 並重連不含 Pivot mode 的 stream，使用 load token、商品、週期及 mode 阻擋晚到 request／event。
- [x] 2.5 擴充 viewport snapshot，保存可視區第一／最後 candle time、是否貼近最新 K 與 bar spacing；time set 改變時以時間錨點還原主圖、技術副圖及籌碼副圖。
- [x] 2.6 只有相同 time set 或純 prepend 可使用 logical delta；payload 縮短、裁切或固定 reference 不存在時回退至最後 completed projection，不套用失效 logical index。
- [x] 2.7 確認 history loader、axis safe width、resize 與 stream 更新不會在 Pivot 切換後再次 `fitContent` 或產生額外空白區。

## 3. 單一參考 K 棒投影 UI

- [x] 3.1 在主圖建立專用 Pivot overlay 與 readout／「回到最新」控制，顯示參考期、適用下一交易日／週／月及完成／暫估狀態。
- [x] 3.2 移除完整歷史七條可見 step series，改由參考 K 棒 x 座標向右畫至價格軸安全邊距前，且不建立未來 timestamp 或假 candle。
- [x] 3.3 套用 P 中性色實線、R1／S1強調、R2／S2虛線及 R3／S3點線／較淡樣式，所有水準均顯示名稱與 tick-size 格式化價格。
- [x] 3.4 實作右側 Pivot 標籤的固定排序、垂直避碰與短導引線，使接近價位仍可完整閱讀且水平線維持真實價格。
- [x] 3.5 建立透明上下界 autoscale helper，只在固定／預設 projection 改變時更新，不產生 crosshair marker、原生價格標籤或 hover 尺度抖動。
- [x] 3.6 讓 overlay 在縮放、平移、歷史 prepend、axis width、panel resize 與跨 pane range sync 後重新定位，並包含於完整 panel PNG 匯出。

## 4. K 棒選取與既有繪圖互動

- [x] 4.1 Pivot 啟用時預設選取最後 completed projection；只有沒有 completed 但有合法 provisional 時才顯示最新暫估投影。
- [x] 4.2 一般主圖單擊以 nearest candle 固定 reference key，hover／十字線只更新既有 readout 與跨 pane 游標，不得改變固定 Pivot。
- [x] 4.3 實作點擊優先權：費波那契／價格範圍、固定範圍 VP、既有 overlay 控制優先，事件被消耗時 Pivot selection 必須不變。
- [x] 4.4 讓「回到最新」可用滑鼠與鍵盤操作，並維持主圖功能表 viewport-safe、焦點順序、Escape／外部收合及 cleanup 契約。
- [x] 4.5 切換商品、週期、panel 數或 destroy 時清理該 panel 的 Pivot selection／overlay／helper，不得影響其他 panel 或保存為伺服器端資料。

## 5. 自動測試與回歸驗證

- [x] 5.1 擴充 Pivot 純函式測試，涵蓋日／週／月下一期公式、日內交易日映射、週末／休市語意、invalid OHLC、completed 與 provisional。
- [x] 5.2 擴充 Worker integration 測試，驗證 Pivot 預設 lazy、projection contract、cache version、display 裁切、history prepend、daily reference 失敗隔離與 API／stream 一致。
- [x] 5.3 新增 160 根與 320 根以上 payload 切換測試，確認啟用／取消 Pivot 不縮短 candles、不套用失效 logical range，並保留主副圖相同可視 candle time。
- [x] 5.4 新增前端生命週期測試，涵蓋點選固定、回到最新、晚到 request、stream provisional 更新、商品／週期切換與 reference fallback。
- [x] 5.5 新增 UI／互動測試，確認七線只由所選 K 棒向右延伸、沒有未來 time point、標籤避碰、autoscale 穩定及費波那契／價格範圍／固定範圍 VP 優先權。
- [x] 5.6 驗證一圖、八圖、窄 panel、鍵盤巡覽與完整 panel PNG；確認 Pivot 文字／價位／狀態可見，功能表可操作且 console 無錯誤。

## 6. 品質門檻與正式發布

- [x] 6.1 執行 `npm run lint`、`npm test` 與必要的 targeted tests，修正所有失敗且不得降低既有覆蓋。
- [x] 6.2 執行單一 `npm run build`，確認 Sites／Cloudflare Workers bundle、靜態資產與 TypeScript 相容。
- [x] 6.3 執行 `openspec validate project-selected-pivot-levels-and-fix-toggle-viewport --strict`、`openspec validate --all --strict` 與 `git diff --check`。
- [x] 6.4 在本機瀏覽器驗收 160／320 根以上歷史、日／週／月、日內暫估、點選／回到最新、反覆啟用取消、繪圖工具、多圖與匯出。
- [x] 6.5 經使用者授權發布後，以完整 HEAD 建立 Sites version，並在正式站重驗資產版本、單圖／多圖可見結果、viewport 保持、PNG 與 console。
