## 1. 呈現模式狀態與控制項

- [x] 1.1 在 `public/static/app.js` 建立 `main`／`single`／`multi` 語意模式、保存偏好與 effective mode，並實作新偏好優先、舊 A／B 遷移及無合法值預設 `single` 的解析流程
- [x] 1.2 更新 `public/static/index.html` 與相關控制繫結，將標籤改為「主副圖」，依序顯示「主圖」、「單一副圖」、「多層副圖」，且不暴露 A／B 內部代號
- [x] 1.3 重構頁籤與單一商品頁的資格判斷，使整個下拉選單保持可操作，僅在非台股或混合頁籤停用「多層副圖」，並保留未被採用的 `multi` 保存偏好
- [x] 1.4 更新 `app.js`、`styles.css` 與相關模組的前端資產 cache-buster，確保正式 HTML 載入本次版本

## 2. 主圖模式版面與 lifecycle

- [x] 2.1 擴充 panel presentation 邏輯，讓 `main` 在 1／2／3／4／6／8 圖與單一商品頁沿用 `has-no-subchart` 收合副圖列、擴展主圖，並移除多層副圖的 document-scroll 狀態
- [x] 2.2 在 `public/static/chip-panes.js` 實作明確的 none／suspended lifecycle，於主圖模式停止新 request、輪詢、背景回補、resize、crosshair 與讀值，取消或隔離進行中 response，並清理 controller、listener、observer 與 wrapper
- [x] 2.3 保留方式 A／B 的技術指標、籌碼選取、series 與群組順序；從主圖切回單一或多層副圖時只重建必要副圖 controller，且不得重建或重新請求主 candles
- [x] 2.4 主圖模式下停用但保留每個 panel 的「副圖」設定入口，補上 `aria-disabled`、操作提示與 disabled 樣式，切回其他模式後恢復互動

## 3. 既有互動與版面相容性

- [x] 3.1 更新 `public/static/chart-interactions.js` 與 resize／crosshair 同步流程，使三種語意模式不再把 `main` 正規化為方式 A，並維持多圖雙擊開啟單一商品頁的原分頁狀態
- [x] 3.2 驗證匯出、圖表數量切換、頁籤切換、商品與週期切換在三模式下保留有效偏好，且主圖模式不建立不可見技術或籌碼副圖
- [x] 3.3 維持 eligible 台股的方式 B 版面與 document scroll，以及非台股的方式 A 技術副圖行為，不引入 panel 內層垂直捲動或非預期水平捲動

## 4. 自動化測試與靜態驗證

- [x] 4.1 新增偏好契約測試，涵蓋無值、損毀值、舊 A、舊 B、新 `main`／`single`／`multi`，以及新值覆蓋舊相容值的 migration matrix
- [x] 4.2 新增主圖 lifecycle 測試，確認副圖列收合、不可見籌碼 request 計數為零、進行中 request 可取消或隔離、controller 與 observer 清理，以及切回後選取恢復
- [x] 4.3 擴充 rendered HTML 與互動測試，涵蓋標籤、選項順序、只停用多層選項、1／2／3／4／6／8 圖、台股／非台股／混合頁籤及 `view=single` 資格
- [x] 4.4 執行完整 `npm test`、必要的 build／lint、`openspec validate --all --strict` 與 `git diff --check`，修正所有失敗與規格漂移

## 5. 瀏覽器可見驗收與發布

- [x] 5.1 在本機瀏覽器逐一驗證主圖／單一副圖／多層副圖，確認各圖數主圖空間確實擴展、設定入口狀態正確、network 無不可見籌碼 request、console 無未處理錯誤
- [x] 5.2 完成 Sites 發布後，以已登入正式站驗證最新 cache-buster、台股與非台股單一商品頁、全台股與混合多圖頁籤、密集 6／8 圖及偏好恢復
- [x] 5.3 將正式站可見結果、network／console 證據、發布版本與已知限制記錄於本變更的驗證文件，全部通過後才將 tasks 標示完成並進入歸檔
