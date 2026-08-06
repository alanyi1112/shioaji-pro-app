## 1. 版面修補

- [x] 1.1 在多層副圖 page-scroll grid 中，為有技術指標的方式 A panel 保留既有緊湊技術副圖高度
- [x] 1.2 維持未選取技術指標時完全收合副圖列的行為

## 2. 驗證與收尾

- [x] 2.1 新增混合方式 A／B 四圖版面的 CSS 回歸測試
- [x] 2.2 執行完整測試、lint、OpenSpec strict 驗證與 `git diff --check`
- [x] 2.3 確認 production build 輸出包含混合方式 A／B 的技術副圖高度修補；部署後另在 Sites 保留站與 Cloudflare 正式站完成實際捲動驗收
