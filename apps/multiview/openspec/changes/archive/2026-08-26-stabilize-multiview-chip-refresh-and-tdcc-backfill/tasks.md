## 1. TDCC 最新週與回補

- [x] 1.1 實作 `Asia/Taipei` 發布週次判定，讓 shareholder cache 必須涵蓋目前最低可接受資料週
- [x] 1.2 修正 requested range coverage，避免舊於起日的 TDCC snapshot 被誤判為已覆蓋
- [x] 1.3 對齊本機 TDCC 週六主同步與週日重試排程及文件
- [x] 1.4 加入發布窗口、舊週 cache 與新商品 queued target 的回歸測試

## 2. 每日籌碼排程與健康狀態

- [x] 2.1 讓 scheduled daily handler 在資源上限內續跑多個 tick，並於無進度時安全停止
- [x] 2.2 隔離逐 symbol eligibility／provider 錯誤，避免單一 `invalid_response` 中止整批
- [x] 2.3 將 watchlist prewarming health 改為讀取 daily orchestrator 自身 heartbeat 與 safe reason
- [x] 2.4 加入多批續跑、單一目標失敗隔離與 health 資料來源回歸測試

## 3. 副圖顯示穩定性

- [x] 3.1 將 chip pane 的 tab identity 與 symbol／interval data-source identity 分離
- [x] 3.2 同來源 `candles=[]` 或 transient fetch error 時保留最後成功 payload 與 series，換來源時清除
- [x] 3.3 加入同商品切 tab、主圖重建暫時空資料與真正換股的回歸測試

## 4. 可觀測性與驗收

- [x] 4.1 將靜態 seed report 明確標示為 seed snapshot，不再當作目前 after-hours pipeline 成功證據
- [x] 4.2 執行聚焦 Worker／前端／runtime 測試與 OpenSpec strict validation
- [x] 4.3 以本機 health 與 D1 coverage 驗證最新週、新商品 queue 及安全狀態可辨識
