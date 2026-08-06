## 1. 回歸測試

- [x] 1.1 新增詳細資料動態表頭只顯示日期且不含「前一筆／指向值」的測試
- [x] 1.2 新增浮層寬度、表格最小寬度與儲存格水平留白縮減的 CSS 契約測試

## 2. 前端實作

- [x] 2.1 將前一期與當期詳細資料表頭改為只顯示實際日期，並處理日期缺漏 fallback
- [x] 2.2 縮小詳細資料浮層、表格與儲存格的水平尺寸，同時保留數值對齊與 overflow 行為

## 3. 驗證與發布

- [x] 3.1 執行相關測試與完整 `npm test`
- [x] 3.2 在本機瀏覽器開啟 holder、法人與融資代表詳細資料，確認日期表頭、實際寬度與完整可讀性
- [x] 3.3 執行 lint、`git diff --check` 與 `openspec validate --all --strict`
- [x] 3.4 commit、push 並發布 Codex Sites 新版本
- [x] 3.5 在正式站驗證日期表頭與緊湊版面，確認 console 無新增錯誤

## 4. 內容自適應收縮

- [x] 4.1 更新 CSS 契約測試，要求浮層與表格依內容收縮且不保留固定最小寬度
- [x] 4.2 將所有籌碼詳細資料浮層與表格改為內容固有寬度，保留 viewport 上限與 overflow
- [x] 4.3 在本機瀏覽器驗證大戶持股、法人與 metadata 表格的空白欄距明顯縮減
- [x] 4.4 執行完整測試、lint、OpenSpec strict validation 與 diff check
- [x] 4.5 commit、push 並發布 Codex Sites 新版本
- [x] 4.6 在正式站驗證內容自適應寬度、完整可讀性與 console 無新增錯誤
