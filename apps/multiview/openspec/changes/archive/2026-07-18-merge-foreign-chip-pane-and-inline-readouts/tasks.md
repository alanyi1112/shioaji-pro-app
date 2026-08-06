## 1. 外資合併 pane 與選取狀態

- [x] 1.1 將副圖選單及 registry 的外資買賣超、外資持股改為單一「外資買賣超＋持股」項目
- [x] 1.2 加入舊 `foreign-flow`／`foreign-holding` 選取狀態 migration、去重與順序保留
- [x] 1.3 讓作用 pane 可彙整多個 dataset，並在合併 pane 以獨立尺度繪製買賣超柱及持股比折線

## 2. 標題列逐日讀值

- [x] 2.1 在籌碼 pane 標題同一列建立可分段、可換行且不水平溢位的 inline readout
- [x] 2.2 將共用十字線改為更新各 pane 的游標日期讀值，離開後恢復最新可用讀值
- [x] 2.3 移除籌碼 pane 的浮動 tooltip DOM、定位 API 與 CSS
- [x] 2.4 正確呈現 TDCC 非發布日的「當日無資料」與最近一筆真實資料語意

## 3. 圖表標籤與正負語意

- [x] 3.1 關閉所有籌碼 series 的 title、last-value 與 price-line 標籤，避免遮住折線或柱狀圖
- [x] 3.2 建立共用正負 formatter，將正值顯示為紅色 `+`、負值顯示為綠色 `-`、零值顯示中性色
- [x] 3.3 更新融資融券逐日讀值，保留清楚欄位名稱並以明確正負號取代「增減」

## 4. 驗證與部署

- [x] 4.1 更新選單、registry、migration、readout、TDCC 缺值及無 tooltip 的 contract／unit 測試
- [x] 4.2 執行完整測試、`git diff --check` 與 `openspec validate --all --strict`
- [x] 4.3 部署至 Codex Sites，使用實際瀏覽器驗收外資合併、標題列讀值、正負顏色及圖形不再被標籤或浮動框遮住
