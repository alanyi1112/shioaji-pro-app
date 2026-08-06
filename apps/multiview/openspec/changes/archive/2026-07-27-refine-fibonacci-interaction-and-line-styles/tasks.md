## 1. 註記狀態與本機遷移

- [x] 1.1 將 `completed.fibonacci` 改為每種類型唯一、依完成順序排列的集合，並維持回撤與拓展公式輸出
- [x] 1.2 將本機 payload 升級至 version 3，安全遷移 version 1／2 單張費波那契與既有價格範圍
- [x] 1.3 補齊雙類型共存、同類取代、完成順序與損毀資料的 controller 單元測試

## 2. 錨點吸附與組合鍵

- [x] 2.1 建立可測試的 A／B／C 錨點解析器，實作 K 棒 low／high、未來 C 與 Option／Alt 自由價位規則
- [x] 2.2 讓主圖 preview 與 click 共用解析器，A／B 無 K 棒時不得建立錨點並顯示安全提示
- [x] 2.3 補齊一般吸附、無 K 棒拒絕、未來 C 與 Option／Alt 解除吸附測試

## 3. 雙圖渲染與線條樣式

- [x] 3.1 讓完成與 pending 渲染支援先畫彩色、後畫單色，並讓重畫同類後正確更新完成順序
- [x] 3.2 更新拓展 autoscale、SVG 重繪與 PNG 匯出路徑，使回撤與拓展可同時存在且不交換樣式
- [x] 3.3 將水平級別線改為 1 CSS px 實線、完成與暫態波段線改為 1 CSS px 虛線並保留暫態透明度

## 4. 河流圖與回歸驗證

- [x] 4.1 以測試鎖定本益比河流圖 P50 1.4 CSS px、其他線 1 CSS px、verified 實線及 provisional 虛線／透明度
- [x] 4.2 驗證同商品／週期保存還原、商品／週期隔離、兩種費波那契可見結果與完整 panel PNG
- [x] 4.3 執行 `npm test`、lint、`openspec validate --all --strict` 與 `git diff --check`，確認沒有無關或秘密資料變更
