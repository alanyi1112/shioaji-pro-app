## 1. 盤中實作前安全預檢與重現

- [x] 1.1 唯讀保存今日原正式擷取、資料推進、既有服務／session／generation／連線錨點；可於待會兒盤中實作，不等收盤或 cleanup，不改原證據或重啟共用服務。
- [x] 1.2 加入能重現 1 分陣列／物件別名、跨分鐘重複時間與同分鐘價量雙算的失敗測試；明列 fixture 與真實來源的差別。

## 2. 資料所有權與完整性

- [x] 2.1 修正 1 分聚合為獨立陣列及 Candle，驗證 raw／display 更新互不污染，其他週期結果不變。
- [x] 2.2 檢查即時更新的 volume／turnover cursor，驗證合法增量一次套用及重放／舊事件拒絕，不放寬來源契約。
- [x] 2.3 建立時間有效、嚴格遞增及唯一的檢查，接入快取保存／讀取與提交邊界，正常 OHLCV／成交值／時間原值不變。
- [x] 2.4 將污染 cache entry 視為目前 key 的 miss，僅一次沿用 bootstrap 復原；驗證不清空其他 key、不合併衝突數值及不無限重試。

## 3. 圖表整合與回歸

- [x] 3.1 隔離提交例外並顯示可診斷局部錯誤，保留同 key／generation 的有效系列；驗證其他面板仍可操作，並立即核對修改後背景擷取與共用服務仍正常推進。
- [x] 3.2 驗證週期／商品切換的 generation guard、history prepend、live tail 及 cache recall 不產生重複或跨商品 K 棒。
- [x] 3.3 在真正 Chromium 以隔離事件跨至少三個分鐘邊界重現 1m→5m→1m→1D→1m、污染快取復原及歷史載入，保存 console／畫面／價量斷言，不冒充 live。
- [x] 3.4 執行價量單位／成交值、readout、viewport／拖曳間距、指標、CDP／三關價／Pivot Point／Fibonacci 相關回歸，確認既有修復未倒退。
- [x] 3.5 執行 focused tests、型別檢查、build、OpenSpec strict validation、git diff --check 及新增文字 whitespace 檢查，記錄成功／失敗／限制。

## 4. 短時間實盤確認與結案證據

- [x] 4.1 優先於今日修復及離線回歸通過後確認既有 simulation runtime、已訂閱商品及連線前後錨點；需要手動重載／額外訂閱時先核對授權，不新建 login／行情連線。
- [x] 4.2 優先以今日真實事件跨至少三個分鐘邊界完成週期來回切換，核對時間軸唯一、row count、單次 volume／turnover 增量及無整頁崩潰，保存 console 與實際資料證據；時間／事件不足才保留未完成至次一適用交易日。
- [x] 4.3 確認共用服務、正式監控擷取與其他頁面未被干擾，分列離線／live 結果及尚待事項；完整證據成立後才判定具備歸檔條件，不替代其他 change 全日驗收。
