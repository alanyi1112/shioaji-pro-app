## 1. 籌碼資料模型與來源正規化

- [x] 1.1 擴充 `InstitutionalFlow` 與 `MarginShort` 型別，加入外資／投信 gross、融資融券限額及使用率欄位，並補齊舊 JSON 缺鍵視為 `null` 的相容處理。
- [x] 1.2 更新 FinMind 法人 normalizer，以相同分類集合保存外資買進、賣出、淨額及投信買進、賣出、淨額，並新增原始股數與四捨五入邊界測試。
- [x] 1.3 更新 FinMind、TWSE 與 TPEx 融資融券 normalizer，解析 limit／quota／來源使用率，在來源缺少使用率時以同列餘額與正數限額計算，並測試零限額、缺值、單位及來源值優先行為。
- [x] 1.4 將來源使用率交叉驗證差異接入不含秘密的 API warning，補齊 D1 JSON upsert、局部合併、舊 row 讀取與 `GET /api/taiwan-stock-chip` response 測試。

## 2. 成交量 MA5／MA10

- [x] 2.1 為 `computeIndicators` 新增成交量 MA5／MA10 的單元測試，涵蓋完整期數、期數不足、零成交量與 candle time 對齊。
- [x] 2.2 在 Worker 回傳 `volume_moving_average.ma5`／`ma10`，確認所有 interval 共用相同 SMA 規則且不改變既有價格移動平均。
- [x] 2.3 在主圖成交量區建立 MA5／MA10 折線、逐期讀值與相對前一筆實際資料的方向顯示，並在取消成交量時同步隱藏三個 series。

## 3. 籌碼細項圖表與互動

- [x] 3.1 建立具版本且以 `tabId + symbol + paneId` 區隔的 series 選擇狀態與 pane 內控制項，保留既有主要 series 預設並測試舊偏好 migration。
- [x] 3.2 擴充外資與投信 pane 的買進、賣出、淨額、外資持股股數／比例讀值與可選 series，確保投信持股沒有來源時不建立或推算資料。
- [x] 3.3 擴充融資與融券 pane 的餘額、日變化、買進、賣出、償還、使用率與資券互抵讀值及可選 series，依存量、流量與百分比分離 price scale。
- [x] 3.4 實作各欄位以前一筆實際非 `null` 值判定方向及逐項「無資料」，補齊窄 pane、多圖模式、鍵盤操作、可存取名稱與 series 圖例樣式。
- [x] 3.5 更新靜態資產版本與前端整合測試，確認切換 symbol、tab、A／B 模式或 series 不會重新請求 candles、覆寫其他 panel 狀態或洩漏 listener。
- [x] 3.6 移除籌碼副圖標題列的「項目」控制，將具色彩提示與 checkbox 的 series 選項整合至既有滑鼠右鍵／鍵盤功能表，保留移除副圖與焦點復原行為。
- [x] 3.7 讓每個具有可見資料的 pane 顯示右側數值軸，依目前選取資料群組切換右軸並維持其他不同單位 series 的獨立隱藏尺度。

## 4. 驗證與交付

- [x] 4.1 執行籌碼、指標、D1、API、rendered HTML 測試及 lint／typecheck，修正所有 regression。
- [x] 4.2 使用瀏覽器驗證上市、上櫃、ETF、不可融券及部分缺值案例，涵蓋 1／3／4 圖、crosshair、縮放、讀值箭頭、series 選擇持久化與可見結果。
- [x] 4.3 唯讀抽樣 FinMind、TWSE、TPEx 實際 API schema 與數值，驗證 gross、limit、quota、使用率公式、單位及 provenance，並記錄無法取得的投信持股仍為 `null`。
- [x] 4.4 執行 `npx openspec validate --all --strict`；發布後以 Sites control plane 或已登入 session 驗證 live HTML／JS／`GET /api/taiwan-stock-chip`，確認新欄位與圖表已在正式版本生效後再完成歸檔。
- [x] 4.5 執行前端 contract、完整測試、lint、build 與 strict validation；以瀏覽器驗證右鍵選項、鍵盤操作、右側數值軸及多圖窄 pane，發布後確認正式站資產與可見結果。
