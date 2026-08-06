# 驗收紀錄

## 自動化驗證

- `npm test`：144 項通過、0 項失敗。
- `npm run lint`：通過，0 warnings。
- `npm run build`：通過。
- `node --check public/static/chip-panes.js`：通過。
- `git diff --check`：通過。
- `npx openspec validate --all --strict`：14 個項目通過、0 項失敗。

## 本機瀏覽器驗收

- 以 `1920 × 1080`、3 欄、多層副圖驗收 `00919.TW`、`00878.TW`、`00929.TW`。
- `00919.TW` 外資讀值共 7 個 segments，實際排成 2 列；TDCC 大戶與散戶各 7 個 segments，實際排成 4 列。
- 所有受測 readout 的 `scrollWidth === clientWidth`、`overflow: visible`、`white-space: normal`，完整文字未裁切且 pane 會自然增高。
- 右側數值軸仍可見；三欄的日籌碼與 TDCC 線圖／柱圖均保留右側刻度。
- 缺少 TDCC 歷史的 pane 右鍵顯示「回補歷史資料」；點擊後顯示「TDCC 已排入回補」，並停用避免連點。
- 已完整的「三大法人合計」右鍵功能表不顯示回補項目。

## 正式站驗收

- owner-only Sites version 58 已成功發布至 `https://quote-chart-multiview.alanyi1112.chatgpt.site`，來源 commit 為 `38a441bec6ddfe47c68902525adee0c5bc930f80`。
- 正式 HTML 載入 `styles.css?v=20260719-chip-wrap-backfill-v1` 與 `chip-panes.js?v=20260719-chip-wrap-backfill-v2`。
- 以個人頁籤「錢線百分百」第 5 / 6 頁、3 欄、多層副圖驗收 `2324.TW`：外資 7 個 segments 排成 3 列，三大法人合計 4 個 segments 排成 2 列，融資與融券各 7 個 segments 排成 2 列，TDCC 大戶 7 個 segments 排成 4 列；全部 `scrollWidth === clientWidth`。
- 初版把 `2324.TW` 的兩週 target（`expectedWeeks: 2`、`completedWeeks: 2`）誤判為完整，因此右鍵只顯示「移除副圖」；新版以至少 51 週為完整門檻，補上同一狀態的前端與 Worker 回歸測試。
- 正式站 `2324.TW` 大戶持股右鍵功能表已顯示「回補歷史資料」與「移除副圖」；點擊後 pane 顯示「等待背景回補」，再次右鍵顯示 disabled 的「TDCC 已排入回補」。
- 正式 API 驗收回傳 shareholder distribution `rowCount: 2`，逐 symbol backfill 為 `status: queued`、`expectedWeeks: 2`、`completedWeeks: 2`；下一次受保護 runner 會重新 plan 官方一年內可用週日期，不由瀏覽器直接抓取歷史表單。
- 未帶登入使用者身分呼叫正式 `POST /api/taiwan-stock-chip/backfill` 回傳 `401` 與安全錯誤訊息，確認 production auth gate 生效；缺資料 queue 與操作後鎖定已由本機真實互動及 Worker contract tests 驗證。
- 正式站各日資料、TDCC 線圖／柱圖及右側數值軸仍正常可見，無新增常駐按鈕。

## 讀值名稱色驗收

- owner-only Sites version 59 已成功發布，來源 commit 為 `48485955ba0b5e1017684e91f929b213c9393427`；正式 HTML 載入 `styles.css?v=20260719-chip-readout-label-color-v1` 與 `chip-panes.js?v=20260719-chip-readout-label-color-v1`。
- 正式站融資 readout 的「餘額／變化／買進／賣出／償還／使用率」名稱色依序為 `#f472b6`、`#e879f9`、`#f87171`、`#4ade80`、`#f59e0b`、`#38bdf8`，與右鍵「線圖項目」六個色票逐一相同。
- 名稱與數值已分成獨立 DOM：例如「償還」名稱維持橘色 `#f59e0b`，下降的 `21 張 ↓` 數值則為綠色 `#4ade80`；名稱不再跟著正負方向變色。
