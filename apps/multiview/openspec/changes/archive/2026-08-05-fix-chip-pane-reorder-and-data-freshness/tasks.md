## 1. 建立回歸基線

- [x] 1.1 新增 viewport snapshot／restore 的純函式或 source contract 測試，涵蓋右側貼齊、fractional index 與無法對應時間的安全回退。
- [x] 1.2 新增 warning 結構化模型與資料集色彩 mapping 測試，確認已知資料集不共用單一橘黃色。
- [x] 1.3 新增籌碼 service 截止前／截止後的 effective end、rows、coverage 與 readout 日期測試。

## 2. 修正副圖重排的 viewport 與座標

- [x] 2.1 在副圖置頂、置底與拖曳排序前通知 app 保存時間錨點式 viewport snapshot。
- [x] 2.2 在 layout refresh 完成 chart resize 後以 snapshot 還原 viewport，並重新執行 axis、overlay、alignment 與 shared crosshair 定位。
- [x] 2.3 確認一般提示、資料載入、商品切換與模式切換仍使用既有 layout refresh，不殘留過期 snapshot。

## 3. 修正提示色彩與資料日期契約

- [x] 3.1 將 warning[] 保持為逐筆結構，依資料集建立獨立純文字提示片段與穩定色彩。
- [x] 3.2 以台北時間最近已完成交易日封頂 service 的有效查詢終點，並讓 D1、provider、coverage 與 availability 共用同一有效終點。
- [x] 3.3 讓信用交易 readout 與線圖只使用實際 row 日期，今日無 row 時顯示缺值／最近一筆真實日期。

## 4. 驗證與交付

- [x] 4.1 執行 `npm test`、`npm run lint`、`npm run build`、`openspec validate --all --strict` 與 `git diff --check`。
- [x] 4.2 本機以 1／2／3／4 圖多層副圖實際驗證置頂後資料線滿框、游標 X 對齊與提示多色顯示。
- [x] 4.3 以 3231.TW 驗證台北時間截止前信用交易不顯示今日數值，並還原測試用圖表設定。
- [x] 4.4 記錄驗證結果，完成後才同步主規格、歸檔或進行部署；本次不納入 `add-mainforce-chip-subcharts`。
