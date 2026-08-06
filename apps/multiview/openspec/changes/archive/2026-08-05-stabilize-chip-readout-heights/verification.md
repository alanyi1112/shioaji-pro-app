# 驗證紀錄

## 驗證基準

- 驗證日期：2026-08-05
- 最終部署 commit：`42802d02f4bdd2f1c7aee062645e0a5879a69762`
- 靜態資源版本：`20260805-chip-readout-heights-v2`
- 驗收方式：在各圖表主圖的 20%、40%、60%、80% X 位置移動滑鼠，逐次量測籌碼副圖標題列高度、副圖高度、下一層副圖頂端、整體面板高度、同列相同副圖頂端差異及水平溢位。
- 通過標準：幾何差異不超過 1 CSS px、同列差異不超過 1 CSS px、沒有水平溢位、沒有畫面錯誤及瀏覽器主控台錯誤。

## 本機 gate

- `npm test`：407 / 407 通過，0 失敗。
- `npm run lint`：通過。
- `npm run build`：通過。
- `openspec validate --all --strict`：通過。
- `git diff --check`：通過。

## Sites 保留站

- URL：`https://quote-chart-multiview.alanyi1112.chatgpt.site/`
- Sites version：179
- version ID：`appgprj_6a523fbeb4c481918c55a57eecd35ba6~appgver_a7dbb4f65a14819180df63c2af099313`
- deployment ID：`appgdep_6a72a12938008191abc2b4f3e641a31f`
- 靜態資源：`styles.css`、`chip-panes.js`、`app.js` 均載入 `20260805-chip-readout-heights-v2`。

| 圖表數量 | 籌碼副圖樣本 | 標題列差異 | 副圖高度差異 | 下一層頂端差異 | 面板高度差異 | 同列差異 | 水平溢位 | 畫面／console error |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | `00919.TW` | 0 px | 0 px | 0 px | 0 px | 0 px | 0 px | 無 |
| 2 | `00919.TW`（另一格為 `^TWII`） | 0 px | 0 px | 0 px | 0 px | 0 px | 0 px | 無 |
| 3 | `00919.TW`、`00929.TW`（另一格為 `^TWII`） | 0 px | 0 px | 0 px | 0 px | 0 px | 0 px | 無 |
| 4 | `00919.TW`、`00929.TW`、`00878.TW`（另一格為 `^TWII`） | 0 px | 0 px | 0 px | 0 px | 0 px | 0 px | 無 |

驗收後已恢復為 4 圖、多層副圖模式。

## Cloudflare 正式站

- URL：`https://multichart-production.alanyi1112.workers.dev/`
- GitHub Actions run：`30969761272`
- workflow：成功，包含 protected smoke test，未觸發 rollback。
- 靜態資源：`styles.css`、`chip-panes.js`、`app.js` 均載入 `20260805-chip-readout-heights-v2`。

| 圖表數量 | 籌碼副圖樣本 | 標題列差異 | 副圖高度差異 | 下一層頂端差異 | 面板高度差異 | 同列差異 | 水平溢位 | 畫面／console error |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | `00919.TW` | 0 px | 0 px | 0 px | 0 px | 0 px | 0 px | 無 |
| 2 | `00919.TW`、`00878.TW` | 0 px | 0 px | 0 px | 0 px | 0 px | 0 px | 無 |
| 3 | `00919.TW`、`00878.TW`、`00929.TW` | 0 px | 0 px | 0 px | 0 px | 0 px | 0 px | 無 |
| 4 | `00919.TW`、`00878.TW`、`00929.TW`、`00981A.TW` | 0 px | 0 px | 0 px | 0 px | 0 px | 0 px | 無 |

驗收後已恢復為 4 圖、單一副圖模式。

## 驗收期間修正

- 初次部署後發現 HTML 的靜態資源 query key 未更新，瀏覽器可能沿用舊資源；已更新 cache-bust 後重新部署。
- Sites 保留站在稀疏本機資料狀態曾出現空圖 `setVisibleRange` 的 `Value is null`；已將籌碼副圖時間範圍同步改為例外隔離並退回 logical range，新增回歸測試後重新部署。
- 上述問題均已在最終 commit 與雙站最終驗收中確認消失。
