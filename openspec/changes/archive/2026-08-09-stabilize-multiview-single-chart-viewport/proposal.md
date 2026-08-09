## Why

MultiView 從多圖雙擊商品進入單一商品圖時，主圖、技術副圖或延遲掛載的籌碼副圖可能把程式性 resize／render 事件誤認為使用者調整時間範圍，造成 K 棒貼在最左側或只佔畫面一小段。此問題已在 `0050.TW` 日 K 的多層副圖連續開啟測試中重現，單一副圖在載入期間發生尺寸變化時也會產生可視範圍漂移，必須建立一致且可驗證的 viewport 權威與初始化契約。

## What Changes

- 為 MultiView 主圖、技術副圖與籌碼副圖建立明確的 viewport 來源規則：初始化與程式性版面更新期間由主圖 canonical viewport 單向同步，副圖不得反向污染主圖。
- 只有可歸因於目前 pane 明確使用者手勢的平移或縮放，才可成為跨 pane viewport 更新來源；資料繪製、ResizeObserver、IntersectionObserver、非同步掛載與 recovery 事件不得被視為使用者操作。
- 在第一次使用者 viewport 操作前加入初始可視範圍 invariant 與有界自我修復，檢查資料重疊、首尾 K 棒位置、可見佔比及右側留白；使用者操作後不得自動重設其平移或縮放結果。
- 擴充 debug report 與自動化驗收，實際覆蓋多圖進入單圖、單一副圖、多層副圖、延遲 resize／掛載、即時更新及重複開啟，不再只以靜態程式碼比對判定通過。

## Capabilities

### New Capabilities

- `multiview-chart-viewport-stability`: 定義 MultiView 單一商品圖在單一副圖與多層副圖下的初始 viewport、跨 pane 同步權威、使用者互動保留、自我修復與可見驗收契約。

### Modified Capabilities

無。

## Impact

- 主要影響 `apps/multiview/public/static/app.js`、`apps/multiview/public/static/chip-panes.js` 與相關圖表互動／生命週期測試。
- 不變更行情 API、資料模型、商品清單、費波那契註記、交易橋接或 Shioaji runtime 模式。
- 不新增第三方依賴，也不涉及 production、帳務、憑證或下單路徑。
