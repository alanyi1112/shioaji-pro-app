## 1. Series 選取真實性

- [x] 1.1 建立共用 series 選取正規化，修復既有空陣列與未知 ID，並保留合法非空自訂選取
- [x] 1.2 套用至所有 pane 的互動入口，禁止取消最後一條 series，避免 readout 有值但圖形空白

## 2. 日期映射與可繪點

- [x] 2.1 建立穩定的 candle date mapping signature，日期映射改變時以最後 payload 本機重畫且不觸發 API request
- [x] 2.2 追蹤 line／histogram 實際可繪點數，並在 clear、unmount 與重新 render 時正確重設
- [x] 2.3 讓 export readiness 區分真實無資料與應有資料卻沒有可繪點，後者必須 fail closed

## 3. 驗證

- [x] 3.1 增加空選取修復、取消最後 series、日期映射本機重畫與零可繪點 readiness 的回歸測試
- [x] 3.2 執行 focused tests、MultiView build、`openspec validate --strict` 與 `git diff --check`
- [x] 3.3 以 2449.TW 實際瀏覽器核對法人、融資券、借券、比率及持股比副圖與 console
