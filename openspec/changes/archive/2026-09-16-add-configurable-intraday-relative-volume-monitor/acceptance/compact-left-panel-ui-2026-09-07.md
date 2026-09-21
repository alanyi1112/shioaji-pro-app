# 盤中監控左側 UI 緊湊化驗收（2026-09-07）

## 結論

- 容量摘要的 label 與 value 已改為同一列，依左欄寬度自動換欄；1512 × 982 viewport 的 494 px 左欄中，13 項摘要為 4 排、總高 105 px，每項 24 px。
- 依 2026-09-07 下午的視覺回饋，容量摘要 label 放大為 11.2 px、value 放大為 13.12 px；「儲存設定」按鈕文字縮小為 10.56 px、按鈕高度 20.14 px。調整後摘要與清單高度均未退化。
- 長狀態項改為跨兩欄，狀態值使用 11.84 px；「狀態：等待 bounded Gate」容器由 117.75 px 增為 238.5 px，`scrollWidth` 237 px，完整文字不再裁切。
- 桌面監控商品卡的代碼／股名、市場／來源、監控、門檻與排序／刪除改為同一控制列；次要 evidence 使用緊湊換行。實際 8027 商品卡由 126.19 px 降為 60.05 px，同一個 601 px 清單區可完整看見 7 張商品卡，原驗收畫面為 4 張。
- 黃色狀態警示已縮小字級、padding 與 line-height；通知按鈕、權限文字與結果／名單頁籤也改為緊湊配置。
- 已有監控商品時，「新增／匯入商品」工具預設收合；空名單時自動展開。收合入口可由 pointer 與鍵盤操作，原有搜尋、批次匯入、自選清單、MultiView 我的清單與盤後選股匯入功能保留。
- 一般桌面尺寸下，清單可視區為 601 px，可同時看到 4 檔完整商品卡；短 viewport 的容量摘要改為單排橫向捲動，1024 × 600 下清單高度由調整前量測的 85 px 提高為 245 px。

## 實機量測

| 情境 | 容量摘要高度 | 監控清單高度 | 摘要配置 | 頁面溢出 |
| --- | ---: | ---: | --- | --- |
| 1512 × 982 | 105 px | 601 px | 4 排自動換欄 | X 0／Y 0 |
| 390 × 844 | 132 px | 294 px | 自動換欄 | X 0／Y 0 |
| 1024 × 600 | 26 px | 245 px | 單排橫向捲動 | X 0／Y 0 |
| 1024 × 600／150% 字級 | 26 px | 245 px | 單排橫向捲動 | X 0／Y 0 |

桌面驗收截圖：[`intraday-monitor-compact-1512x982-2026-09-07.png`](./screenshots/intraday-monitor-compact-1512x982-2026-09-07.png)

商品卡密度驗收截圖：[`intraday-monitor-dense-cards-1512x982-2026-09-07.png`](./screenshots/intraday-monitor-dense-cards-1512x982-2026-09-07.png)

## 驗證

- `pnpm test:browser -- src/components/intraday-monitor-panel.browser.test.ts`：9 files，101 tests passed。
- `pnpm build`：通過；保留既有 chunk size warning。
- `openspec validate add-configurable-intraday-relative-volume-monitor --strict`：通過。
- `git diff --check`：通過。
- 5173 已重啟套用新 UI；8080 simulation API、5174 MultiView 與 production 狀態未被這次 UI 調整改動。
- 實際 runtime 複查：`runtime_mode=simulation`、`api_simulation=true`、`web_listener=up`、`multiview_listener=up`、`production_readonly_job=stopped`。

## OpenSpec 邊界

本次是已完成任務 6.2、6.5、6.8 與 8.8 的介面密度改善與回歸加強，不取代任務 8.2 所需的兩個完整交易日，也不授權 Gate 0、通知、production 或 broker write。
