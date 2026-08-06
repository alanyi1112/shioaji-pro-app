## 1. 資格判斷與呈現模式

- [x] 1.1 新增台股頁籤相容商品 allowlist，讓 `^TWII` 不封鎖同頁 `.TW`／`.TWO` 商品的多層副圖
- [x] 1.2 保留 panel 級嚴格籌碼資格與 6／8 圖固定單一副圖，確認指數 panel 不建立籌碼 lifecycle

## 2. 自動化驗證

- [x] 2.1 擴充呈現模式測試，覆蓋 `^TWII + .TW + .TWO`、真正跨市場頁籤及 1／2／3／4／6／8 圖
- [x] 2.2 執行相關測試、完整測試、build、OpenSpec strict validation 與 `git diff --check`

## 3. Sites 保留站驗收

- [x] 3.1 發布精確驗證版本至 Sites 保留站
- [x] 3.2 在 Sites 保留站驗證台股 1／4 圖可選多層、`^TWII` panel 不建立籌碼 pane，且 6／8 圖仍固定單一副圖
