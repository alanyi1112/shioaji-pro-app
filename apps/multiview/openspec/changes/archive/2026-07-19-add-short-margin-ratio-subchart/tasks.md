## 1. 公式與前端契約測試

- [x] 1.1 新增 `shortMarginRatioPercent` 純函式測試，涵蓋一般比值、合法融券 0、融資 0、缺值、負值與非有限值。
- [x] 1.2 更新 pane registry／selection contract tests，確認「券資比」位於融券之後、方式 A／B 可選、首次 B 預設不啟用且舊偏好不被重設。
- [x] 1.3 新增券資比 series／readout contract tests，固定預設百分比線、可選日變化柱、series 色票、右側百分比軸、gap 與第一筆無比較語意。

## 2. 券資比 pane 實作

- [x] 2.1 在 `public/static/chip-panes.js` 實作只接受同日合法融資融券餘額的券資比純函式與衍生 rows，保留完整精度並拒絕零分母或跨日補值。
- [x] 2.2 在固定 registry 與 `PANE_SERIES_OPTIONS` 加入非預設 `short-margin-ratio` pane、「券資比」線及「日變化」柱，沿用既有 selection 儲存而不重設偏好。
- [x] 2.3 實作券資比 inline readout，顯示券資比、相對前一合法交易日變化、融券餘額、融資餘額及來源，並正確處理合法零、首筆與缺值。
- [x] 2.4 實作右側百分比線與獨立隱藏尺度的可選正負日變化柱，保留 series 名稱色、數值方向色、共用十字線、時間範圍與右側數值軸。
- [x] 2.5 確認券資比只要求 `margin-short`，與融資／融券共用 request cache、availability、回補 menuitem、generation 隔離及 pane destroy 清理，不增加 API、D1 或上游呼叫。
- [x] 2.6 更新靜態資產版本與相關前端 contract assertions，避免正式站使用舊版 JS／CSS cache。

## 3. 驗證、發布與紀錄

- [x] 3.1 執行 focused tests、完整 `npm test`、lint、build、`node --check`、`git diff --check` 與 `npx openspec validate --all --strict`。
- [x] 3.2 使用瀏覽器在本機驗證方式 A／B 選取、手算券資比、合法零／缺值、日變化切換、readout 換行、右側百分比軸、共用十字線及 `margin-short` request 去重。
- [x] 3.3 提交並推送 exact validated source，發布 owner-only Sites version，在正式站重做券資比、右鍵 series、數值軸、1／2／3 圖與無回歸驗收，並記錄證據。
