## 1. 河流線上標籤

- [x] 1.1 為 P5／P20／P35／P50／P65／P80／P95 建立 `—Pxx N.NNx—` 格式化 helper
- [x] 1.2 在河流 SVG plot 左側為七條線加入同色文字、1px 同色框線、半透明底色及密集線距避碰連接線，並保持 pointer-events none
- [x] 1.3 確認 resize／縮放／平移重繪及 PNG clone 都保留七個線上標籤

## 2. 右鍵詳細說明

- [x] 2.1 移除主圖常駐 `.readout-row-pe-river` 與相關樣式，不再把河流詳情寫入主圖 readout
- [x] 2.2 讓河流 controller 保存 pointed-date 詳情並提供安全的 `getDetailLines()`／清理生命週期
- [x] 2.3 在 panel 右鍵選單加入「本益比河流圖詳細說明」與預設收合的詳情容器
- [x] 2.4 右鍵開啟時依 pointed date 更新詳情；無資料時隱藏入口，點擊展開時維持 aria-expanded 與視窗內定位

## 3. 自動化驗證

- [x] 3.1 更新河流 frontend contract 與線型測試，覆蓋七個同色框線標籤、無常駐 readout、右鍵展開及 cleanup
- [x] 3.2 更新靜態資產 cache key，執行完整測試、lint、OpenSpec strict validation 與 `git diff --check`

## 4. 瀏覽器驗收

- [x] 4.1 在本機啟用本益比河流圖，確認七個框線標籤位於 plot 左側、顏色與對應線一致且主圖不再顯示原綠框內容
- [x] 4.2 以右鍵選單展開詳細說明，核對本益比、EPS、財報、七個 multiplier、區帶、來源、授權與 coverage 後清理測試狀態
