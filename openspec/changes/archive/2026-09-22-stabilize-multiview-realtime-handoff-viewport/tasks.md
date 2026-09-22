## 1. 回歸契約

- [x] 1.1 為 time-anchored viewport 加入 524→242、242→524、局部日期錨點與缺少錨點的純函式測試。
- [x] 1.2 加入自動來源等待 Shioaji bootstrap、失敗才顯示 canonical fallback，以及同日 snapshot 不重建 viewport 的 wiring 回歸。

## 2. 程式修正

- [x] 2.1 在 `chart-interactions.js` 實作可測試的 viewport snapshot range 轉換，限制較短資料集合的最大跨度。
- [x] 2.2 讓自動模式的分鐘與日線保存 canonical fallback但等待 Shioaji bootstrap，再原子顯示最終同源 payload。
- [x] 2.3 將首次 bootstrap、fallback、收盤 handoff 與換交易日的完整重建接到 time-anchored viewport，保留同日最後一棒增量更新。

## 3. 驗證與證據

- [x] 3.1 執行 viewport、realtime、rendered HTML 與副圖 focused tests，確認 524→242 不產生不存在的 logical slots。
- [x] 3.2 執行 MultiView typecheck、build、browser tests、OpenSpec strict 與 `git diff --check`。
- [x] 3.3 以 simulation runtime 的 00929.TW 驗證自動、Shioaji、Yahoo 三種模式、延遲 fallback 與目前主副圖同步狀態。
- [x] 3.4 於下一個實際開盤時段驗證 00929.TW 第一筆與後續 snapshot 只增量更新最後一棒，且不發生可見 viewport 位移。
