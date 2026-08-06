## 1. 渲染行為

- [x] 1.1 調整費波那契 SVG renderer，使第二張單色完成圖不建立區間 band polygon
- [x] 1.2 確認第二種圖的 pending preview 同樣不建立區間填色，且保留單色水平線、標籤、錨點與波段虛線

## 2. 自動化驗證

- [x] 2.1 補強前端 contract 測試，鎖定單色圖不渲染 band、彩色圖仍保留 band
- [x] 2.2 執行 `npm test`、`npm run lint`、`openspec validate --all --strict` 與 `git diff --check`

## 3. 可見驗收

- [x] 3.1 在本機瀏覽器依序建立回撤與拓展，確認第二張圖只有單色線條且沒有區間填色，第一張色帶維持可見
