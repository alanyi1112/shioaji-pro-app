## 驗證摘要

- 實作來源：`b8dc2e72b73170e4766a025aa87a7a415cb711a4`
- Sites version：60
- 正式網址：`https://quote-chart-multiview.alanyi1112.chatgpt.site`
- 存取範圍：既有 `custom` owner-only，1 位允許使用者、0 個群組；本次未變更權限。

## 自動驗證

- `npm test`：146/146 通過，包含 build。
- `npm run lint`：通過，0 warnings。
- `node --check public/static/chip-panes.js`：通過。
- `git diff --check`：通過。
- `npx openspec validate --all --strict`：15/15 通過。

## 本機瀏覽器驗收

- 方式 A 與方式 B 都可選取「券資比」，方式 B 既有首次預設未被改變。
- `00919.TW` 於 2026-07-17 顯示融券餘額 132 張、融資餘額 8,145 張，手算 `132 / 8,145 × 100 = 1.6206…%`，readout 顯示 1.62%。
- `00929.TW` 於 2026-07-17 的融券餘額為 0 張、融資餘額為 5,511 張，readout 顯示合法 0.00%，未誤標為無資料。
- 非日 K 安全狀態顯示「籌碼副圖只支援日 K」與「無資料」，未產生無限值。
- 右鍵功能表顯示「券資比」與「日變化」，預設只勾選券資比；勾選日變化後原地更新，不新增 `margin-short` dataset。
- 右側百分比數值軸寬度實測 64 至 74 CSS px；主圖與券資比日期對齊誤差為 0 CSS px。
- 瀏覽器 console error：0。

## 正式站驗收

- 首頁載入 `chip-panes.js?v=20260719-short-margin-ratio-v1`，三張圖各有券資比選項。
- `00919.TW` readout 顯示「券資比 1.62%」、「日變化 +0.15%」、「融券餘額 132 張」、「融資餘額 8,145 張」與來源 FinMind。
- 右鍵功能表可勾選「日變化」，券資比線與日變化柱同時保留；右側百分比軸寬 88 CSS px。
- 正式站主圖、技術副圖與全部籌碼副圖的日期對齊誤差為 0.1235 CSS px，小於等於 1 CSS px。
- 圖表數量切換 1／2／3 時，分別建立 1／2／3 個 panel；三圖模式的 `00919.TW`、`00878.TW`、`00929.TW` 都顯示「已載入」。
- 瀏覽器 console error：0。
