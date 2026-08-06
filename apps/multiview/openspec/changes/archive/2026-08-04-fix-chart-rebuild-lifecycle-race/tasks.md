## 1. 重現與生命週期盤點

- [x] 1.1 建立可重複的快速圖數、分類分頁與市場頁籤切換流程，記錄正常操作與壓力操作的 panel 最終狀態及 Console error
- [x] 1.2 盤點 `createPanel()` 到 `destroy()` 範圍內的 timer、animation frame、observer、listener、stream、controller 與 Lightweight Charts reference，定位跨越 teardown 的 callback

## 2. 重建生命週期修正

- [x] 2.1 為每次 `renderPanels()` 與 panel 建立不可重用的 generation，讓舊 generation 的非同步工作採 latest-wins 失效
- [x] 2.2 建立 panel lifecycle registry，統一登記及取消 timer、animation frame 與 cleanup callback
- [x] 2.3 調整 `destroy()` 為冪等且依序停止新工作、中止請求與 controller、取消排程、移除圖表並清空 reference
- [x] 2.4 保留圖數、canonical 分頁切片、deep link 清理、6／8 圖固定單一副圖及 1／2／3／4 圖偏好恢復行為
- [x] 2.5 修正 ATR 自訂 price scale 初始化順序，先建立 ATR series 再套用 scale options
- [x] 2.6 讓 batch coordinator 成功 response 與錯誤 response 都比對 request snapshot token，隔離重用 panel ID 的舊 payload

## 3. 自動化驗證

- [x] 3.1 新增 generation 失效、lifecycle registry 清理與重複 teardown 的單元測試
- [x] 3.2 新增快速切換圖數、分類分頁與市場頁籤後 latest-wins 最終狀態的整合測試
- [x] 3.3 執行相關測試、完整 `npm test`、`npm run lint`、`openspec validate --all --strict` 與 `git diff --check`
- [x] 3.4 新增 ATR series 必須早於自訂 price scale options 的回歸測試
- [x] 3.5 新增相同 panel ID 在 in-flight 期間被替換時，舊 batch response 不得投遞給新 subscription 的回歸測試

## 4. 瀏覽器與部署後驗收

- [x] 4.1 在本機乾淨瀏覽器 session 驗證正常與快速連續切換，確認最終 panel／商品／模式正確且 Console 0 errors
- [x] 4.2 經使用者確認後，以 exact commit 部署 Sites 保留站與 Cloudflare 正式站
- [x] 4.3 分別在 Sites 保留站與 Cloudflare 正式站重跑圖數、分頁、市場頁籤、deep link、重整與快速切換驗收，保留不含秘密的版本與 Console 證據
