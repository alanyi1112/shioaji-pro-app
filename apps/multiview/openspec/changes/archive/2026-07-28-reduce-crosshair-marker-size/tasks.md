## 1. 交點尺寸實作

- [x] 1.1 在主圖與技術副圖的可見 LineSeries 建立入口套用 2 CSS px 半徑及 1 CSS px 邊框，保留既有顯示與費波那契隱藏邏輯
- [x] 1.2 在籌碼副圖的可見 LineSeries 建立入口套用相同 marker 尺寸，不影響 time anchor、資料與同步
- [x] 1.3 更新 `app.js` 與 `chip-panes.js` cache-busting key，確保正式站載入新版 marker 設定

## 2. 自動化驗證

- [x] 2.1 新增主圖、技術副圖與籌碼副圖 marker 尺寸契約測試，並執行相關測試
- [x] 2.2 執行完整 `npm test`、`npm run lint`、`openspec validate --all --strict` 與 `git diff --check`

## 3. 畫面與發布驗收

- [x] 3.1 在本機瀏覽器驗證十字準線穿過主圖、技術副圖與籌碼副圖時，交點小於原預設且不遮蔽底層資訊
- [x] 3.2 同步完整 HEAD 至 GitHub 與 Sites source，發布 owner-only Sites version 並於正式站重驗
