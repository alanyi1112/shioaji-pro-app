## 1. 滾輪路由修正

- [x] 1.1 更新多層副圖 `bindWheelRouting()`，使一般無修飾鍵垂直 wheel 在 capture phase 捲動 document，並在每個 `createChart()` 前註冊以先於圖表 library 阻止事件
- [x] 1.2 讓 `Option/Alt + wheel` 在多層副圖交由 Lightweight Charts 縮放，並保留 `Ctrl/Meta` 瀏覽器原生手勢
- [x] 1.3 確認主圖與單一副圖模式的既有 mouse wheel 行為不變
- [x] 1.4 隔離 lazy-mounted 籌碼 chart 初始化期間的暫態 range event，待兩個 layout frame 後才開放反向 range input

## 2. 回歸測試

- [x] 2.1 更新 wheel routing 單元測試，涵蓋一般 wheel、Alt wheel、Ctrl/Meta、deltaMode 正規化與 cleanup
- [x] 2.2 補上來源契約，確認主圖、技術副圖與 lazy-mounted 籌碼副圖都在 `createChart()` 前共用同一 routing helper
- [x] 2.3 補上 lazy mount range-input 隔離與 lifecycle cleanup 契約

## 3. 驗證

- [x] 3.1 在本機單圖多層副圖以真實 wheel 驗證 document 捲動、visible logical range／bar spacing 不變、lazy mount 正常且跨 pane 座標差小於或等於 1 CSS px
- [x] 3.2 執行相關測試、完整 `npm test`、lint、build、OpenSpec strict 與 `git diff --check`
