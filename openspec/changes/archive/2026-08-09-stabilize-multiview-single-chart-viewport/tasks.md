## 1. Viewport 協調器與互動權限

- [x] 1.1 建立 panel-local viewport coordinator，追蹤 generation、最後接受 logical range、程式性 mutation 與 source-scoped 使用者手勢
- [x] 1.2 加入 coordinator 動態單元測試，覆蓋程式性 callback、pointer／wheel 授權、舊 generation 與使用者範圍保留

## 2. 主圖與技術副圖整合

- [x] 2.1 將主圖及技術副圖的 range callback、resize、refit、資料更新與 recovery 接入 coordinator
- [x] 2.2 讓單一副圖在初載與延遲 resize 後維持 canonical／使用者最後接受範圍，且不影響歷史補載與即時更新

## 3. 多層籌碼副圖整合

- [x] 3.1 以明確 pane 手勢取代固定兩個 frame 的 `rangeInputEnabled`，並將 source 與互動授權傳回 panel coordinator
- [x] 3.2 確保延遲 mount、IntersectionObserver、ResizeObserver、非同步 render 與 pane 重排只拉取最後接受範圍，不得反向污染主圖

## 4. Invariant、診斷與回歸測試

- [x] 4.1 實作初始 viewport invariant 與有界自我修復，涵蓋資料重疊、首尾座標、可見佔比及右側 gap
- [x] 4.2 擴充 panel debug report，揭露最後接受範圍、viewport invariant、修復次數與各 pane range
- [x] 4.3 補齊單一副圖延遲 resize、多層副圖延遲掛載、一般／Alt wheel、使用者操作後資料更新及重複開啟測試

## 5. 驗收

- [x] 5.1 在本機 5174 以 `0050.TW` 日 K 重複驗收單一副圖與多層副圖，確認不再出現 `158–319`、`-383–161` 或等效空白 viewport
- [x] 5.2 執行相關 MultiView 測試、完整測試、OpenSpec strict validation 與 `git diff --check`
