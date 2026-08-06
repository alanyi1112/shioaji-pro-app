## 1. 頁籤列控制精簡

- [x] 1.1 移除顯示中頁籤列的上移／下移按鈕與相關停用狀態，只保留拖曳把手、名稱與 visibility 控制
- [x] 1.2 讓拖曳把手支援 `ArrowUp`／`ArrowDown` 鍵盤排序，沿用既有 reorder coordinator 並阻止邊界無效寫入
- [x] 1.3 調整頁籤列 flex 與最小寬度，使名稱優先使用剩餘空間、極端長名稱維持單行省略號

## 2. Visibility 眼睛圖示

- [x] 2.1 建立不依賴外部資產的內嵌眼睛／斜線眼睛 SVG helper，使用 `currentColor` 且圖示本身為裝飾性
- [x] 2.2 將顯示中頁籤的「隱藏」與已隱藏頁籤的「取消隱藏」改為固定尺寸圖示按鈕，保留完整 `aria-label`、`title`、hover 與 focus 狀態
- [x] 2.3 驗證 visibility mutation、成功提示、focus 回復與最後可見頁籤限制不受影響

## 3. 測試與驗收

- [x] 3.1 更新前端 source contract 測試，確認不再建立頁籤上下按鈕、圖示語意與鍵盤排序契約存在
- [x] 3.2 執行相關測試、`npm run lint`、完整 `npm test`、OpenSpec strict validation 與 `git diff --check`
- [x] 3.3 在本機 browser-visible 驗證長頁籤名稱、拖曳、鍵盤排序、隱藏、取消隱藏及窄版布局，且不得出現 console error

## 4. 6／8 圖籌碼副圖模式修復

- [x] 4.1 移除 `effectiveCompactSubchartMode()` 與模式控制中的 6／8 圖強制 A／disabled 條件，保留非台股與混合頁籤限制
- [x] 4.2 更新契約測試與 OpenSpec 驗收矩陣，確認全台股 1／2／3／4／6／8 圖皆可切換 A／B 且偏好不被覆寫
- [x] 4.3 在本機 browser-visible 驗證台股 6／8 圖模式選單可用、多層 pane 使用 document scroll、切換 A／B 不出現 console error
- [x] 4.4 修正 `view=single` 的模式資格只依目標商品判斷，並驗證台股單圖可切換 A／B、非台股單圖維持 A
