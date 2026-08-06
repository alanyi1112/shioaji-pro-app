## 1. 選單 contract

- [x] 1.1 更新副圖互動測試，鎖定三個籌碼主項與十個次項的新顯示名稱，並確認 checkbox value 與群組 ID 不變。
- [x] 1.2 新增選單寬度、技術／主項字級及次項較小字級的 CSS contract，保留窄螢幕單欄 fallback。
- [x] 1.3 更新密度 contract，鎖定一般 188px、6／8 圖 180px 上限與右側對齊定位。
- [x] 1.4 新增技術指標固定兩欄、legend 橫跨兩欄且維持 DOM／鍵盤順序的 CSS contract。
- [x] 1.5 新增籌碼群組無水平分隔線、2px 垂直間距與緊湊父項高度的 CSS contract。

## 2. 前端實作

- [x] 2.1 更新 `public/static/index.html` 的籌碼主項與次項顯示文案，不改變內部 value、pane ID 或選取行為。
- [x] 2.2 更新 `public/static/styles.css`，將副圖選單限制在 220px 與 viewport 內，並套用 12px 主項、11px 次項的字級層級。
- [x] 2.3 移除籌碼群組說明文字，並讓非台股或非日 K context 隱藏籌碼選項與既有籌碼 pane，切回適用 context 時保留既有選取狀態。
- [x] 2.4 縮小副圖選單基準寬度，讓 6／8 圖窄面板使用 180px 並向左展開；展開時不得被面板 overflow 裁切，並保留兩欄完整標籤與窄 viewport fallback。
- [x] 2.5 將 RSI、KD、MACD、ATR 改為每列兩個，縮短選單高度且不改 checkbox value、預設勾選與操作行為。
- [x] 2.6 移除三個籌碼群組的上邊框並縮減群組間距、內距與父項高度，保留 checkbox 與兩欄子項操作。

## 3. 驗證與發布

- [x] 3.1 執行 focused tests、完整 `npm test`、`npm run lint`、`git diff --check` 與 `openspec validate --all --strict`。
- [x] 3.2 在本機瀏覽器檢查副圖選單實際寬度、文案、字級層級、兩欄／窄螢幕單欄與 checkbox 操作。
- [x] 3.3 在本機瀏覽器切換台股日 K、美股與非日 K，確認籌碼選項與 pane 依適用性顯示／隱藏。
- [x] 3.4 提交並推送 exact validated source，發布 owner-only Sites version，確認 deployment succeeded 與正式站可見結果。
- [x] 3.5 在本機瀏覽器以 6 圖與 8 圖驗證選單寬度、面板內左右邊界、完整高度、完整文字與無水平捲動。
- [x] 3.6 重新執行完整驗證，提交並推送 exact validated source，發布 owner-only Sites version，確認正式站 6／8 圖可見結果。
- [x] 3.7 執行完整驗證並在本機與正式站 6／8 圖確認技術指標兩列、持股比群組完整可見及無瀏覽器錯誤。
- [x] 3.8 執行完整驗證並在本機與正式站 6／8 圖確認水平分隔線消失、選單高度降低、持股比完整可見及無瀏覽器錯誤。
