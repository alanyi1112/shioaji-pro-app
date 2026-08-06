# 驗收紀錄

## 自動化驗證

- `npm test`：153 項測試全數通過。
- `npm run lint`：通過。
- `openspec validate --all --strict`：17 個 OpenSpec change／spec 全數通過。
- `git diff --check`：通過。

## Codex Sites 正式站驗收

- 版本：67（owner-only）。
- Runtime commit：`d0f7baeaecb17e96f4b0b681e214664fc668b907`。
- 正式站：`https://quote-chart-multiview.alanyi1112.chatgpt.site`。
- 靜態資產：`chip-panes.js?v=20260719-tdcc-holder-details-v3`。

以既有登入 Chrome session 驗證三欄、多層籌碼副圖模式：

- 大戶持股標題列顯示 `2026-07-17`、`持股 8.02%`、`週變化 -0.61%`，級距選單為 `1,000 張以上` 並靠右，右側間距實測 6px。
- 散戶持股標題列顯示 `2026-07-17`、`持股 17.87%`、`週變化 +0.05%`，級距選單為 `10 張以下`。
- 大戶與散戶右鍵功能表均各自只顯示一個「詳細資料」項目。
- 大戶與散戶詳細資料表均列出 9 個欄位：資料日期、持股比例、週變化、官方級距、持股張數、持股人數、資料來源、資料頻率與提醒。
- 右鍵位置不會覆寫已開啟明細所固定的最新發布日數值；頁面捲動後明細仍維持開啟、完整位於 viewport 內，`Escape` 可關閉。
- holder 線圖 canvas 正常存在並顯示。

## 持股張數變化追加驗收

- 版本：69（owner-only）。
- Runtime commit：`d7b74cd4496a894bb5f0cdc39352e6549a9a996a`。
- 靜態資產：`chip-panes.js?v=20260719-tdcc-holder-details-v5`。
- 大戶持股標題顯示 `持股 -109,082.8 張`，數值 class 為 `is-negative`，正式站 computed color 為綠色 `rgb(74, 222, 128)`。
- 散戶持股標題顯示 `持股 +12,779.5 張`，數值 class 為 `is-positive`，正式站 computed color 為紅色 `rgb(248, 113, 113)`。
- 精簡標題不另寫「增減」，以 `+`／`-` 與紅綠色表達方向；右鍵詳細資料表保留「持股增減」欄名並顯示同一數值。
- 大戶與散戶級距選單右側間距均為 6px，holder header 無水平 overflow，線圖 canvas 正常存在。
