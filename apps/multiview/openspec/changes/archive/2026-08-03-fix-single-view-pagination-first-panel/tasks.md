## 1. 單圖與多圖狀態邊界

- [x] 1.1 新增單圖 deep-link 離開多圖轉換 helper：依新 chart count 將商品 index 換算為 `floor(index / pageSize)`，清除 single-view state 與會重新觸發單圖的 URL query。
- [x] 1.2 將 `defaultSymbolForPanel`、`defaultIntervalForPanel`、副圖資格與 debug mode 的 single-view 判定限制在目前 1 圖生命週期，並保留一般多圖 canonical slice。
- [x] 1.3 修正 `applySingleChartView` 的頁碼換算，確認無效商品或頁籤仍安全 fallback 且不產生越界頁碼。
- [x] 1.4 讓 6／8 圖的有效主副圖模式固定為單一副圖，停用主圖與多層副圖選項，並在切回其他圖數時恢復原偏好。

## 2. 回歸測試與可驗證契約

- [x] 2.1 擴充前端回歸測試，保護圖表數量 change handler、single-view cleanup、正確 page-size 換算及 panel 預設商品邊界。
- [x] 2.2 補上 1／2／3／4／6／8 圖的分類頁切片測試，確認每頁第一個商品不會被舊 single-view 商品覆蓋。
- [x] 2.3 執行 lint、完整測試、OpenSpec strict、`git diff --check` 與 production build，修正實際失敗。
- [x] 2.4 補上 6／8 圖的主副圖模式回歸測試，確認單一副圖強制、選項停用與其他圖數的偏好恢復。

## 3. 正式站瀏覽器驗收

- [ ] 3.1 以有效 `view=single` URL 進入 Cloudflare 正式站，逐一切換 1／2／3／4／6／8 圖，確認第 1 頁與後續頁的所有 panel 商品與 canonical slice 一致。
- [ ] 3.2 在每種多圖數量驗證上一頁／下一頁、台股／其他市場頁籤、重新載入與 single-view URL query 已清除，並確認 console 無新增錯誤。
- [ ] 3.3 保留不含秘密的瀏覽器驗收摘要與 asset／commit 識別，確認不影響暫緩中的 `add-mainforce-chip-subcharts`。
