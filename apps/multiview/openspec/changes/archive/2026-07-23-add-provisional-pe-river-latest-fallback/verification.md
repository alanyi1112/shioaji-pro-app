# 驗證紀錄

## 2026-07-23 實作與本機驗證

- `npm run lint` 通過。
- `npm test` 共 226 項全部通過，涵蓋 provisional candidate、固定 percentile、D1 嚴格 binding、原子 reconciliation、逾時 running lease 回收、workflow contract、API、DOM、繪圖與 PNG clone。
- `openspec validate add-provisional-pe-river-latest-fallback --strict` 與 `openspec validate --all --strict` 共 20 個 change／spec 全部通過。
- `git diff --check` 通過。
- 本機以 `2454.TW` 重演官方至 `2026-07-21`、FinMind 暫代至 `2026-07-22`；API 分別回傳 `verifiedEnd` 與 `displayEnd`，UI 顯示「FinMind 暫代至 2026-07-22，等待交易所確認」。SVG 有四個暫代 band 與五條暫代線，透明度與虛線樣式符合規格，browser console 無錯誤。
- migration 已補 D1 既有 table 相容測試。原先被本機忽略的舊 migration 會在正式 D1 重複建立 `taiwan_stock_pe_control`；已改成可重複執行的 marker migration，並由 runtime 以 `PRAGMA table_info` 安全補欄位。

## Private workflow、官方追認與正式環境證據

- feature gate `PE_RIVER_PROVISIONAL_LATEST_ENABLED` 已在 private／custom Sites runtime 啟用，設定值未暴露於前端或紀錄。
- Sites version 112 首次部署因既有 D1 table 重複建立而失敗，沒有宣稱成功；修正 migration 後，commit `ac8159f290cd5218dfccfbca3f7e6dd60185ea8f` 的 Sites version 113 deployment succeeded。
- 首次手動 run [`29945407033`](https://github.com/alanyi1112/MultiChartOnCodexSite/actions/runs/29945407033) succeeded：official latest accepted 30、provisional accepted 24、fallback accepted 6、history 8／8、budget 16／240；正式 `2615.TW` 因而成為官方 `2026-07-21`、FinMind 暫代 `2026-07-22` 的真實 D-1／D 證據。
- TWSE OpenAPI 後續發布 `2026-07-22`。第一次追認 run [`29971252585`](https://github.com/alanyi1112/MultiChartOnCodexSite/actions/runs/29971252585) 在 client 45 秒 timeout 後安全失敗；Sites log 顯示 Worker 在 44.365 秒被取消，不是上游 `provider_unavailable`。取消前 row-level D1 batch 已原子完成：`2615.TW` 與 `3481.TW` 都從 provisional 升級為 `official_verified`，`verifiedEnd`／`displayEnd` 同為 `2026-07-22`，provisional dates 清空；但 control 成功時間未被錯誤提前更新。
- commit `49ca302fb90e0602dd806ad14a3a7b3d02d7fd1f` 將 protected POST timeout 調整為 90 秒，並讓 scheduler 只在 lease 到期後回收 `running` job；新增測試確認 lease 到期前不可竊取、到期後可遞增 attempt 冪等接續。Sites version 114 deployment succeeded。
- 修正版 private workflow run [`29971570970`](https://github.com/alanyi1112/MultiChartOnCodexSite/actions/runs/29971570970) 使用 `49ca302` 並於 9 分 28 秒後 succeeded：latest accepted 38、fallback accepted 14、provisional accepted 0、history claimed／completed 8／8、failed 0、budget 66／240。
- 正式 health 的 `lastLatestRunAt` 為 `2026-07-23T01:23:12.600Z`、`lastHistoryRunAt` 為 `2026-07-23T01:30:36.151Z`；TWSE／TPEx official source date 均為 `2026-07-22`，provisional pending 0、mismatch 0。這完成 task 6.4 的真實「官方到齊後相符追認」分支；未以 mismatch 或 gap 偽造完成。
- 正式 `2615.TW` API 為 available、1,082 筆，`verifiedEnd`／`displayEnd`／`officialSourceDate` 均為 `2026-07-22`，provisional dates 為空。正式 `8069.TWO` API 為 available、1,199 筆，coverage `2021-07-23～2026-07-22`，backfill complete，三個 end date 也都是 `2026-07-22`。

## 已登入正式站瀏覽器驗收

- 驗收環境為 private／custom Sites version 114；透過正式「我的清單」搜尋並加入 TPEx 普通股 `8069.TWO`，沒有修改或刪除既有商品。
- `8069.TWO` 單圖勾選後實際產生四個 `.pe-river-band` 與五條 `.pe-river-line`，status 為 1,199 筆、coverage `2021-07-23～2026-07-22`。pointed-date readout 顯示官方本益比、交易所參考 EPS、P10／P30／P50／P70／P90、所在區帶、證券櫃檯買賣中心、FinMind、政府資料開放授權與官方 coverage；官方已追認，畫面沒有 provisional warning。
- TWSE 普通股 `2481.TW` 單圖為四帶五線、1,214 筆、coverage `2021-07-22～2026-07-22`；readout 顯示臺灣證券交易所與官方本益比／參考 EPS，沒有錯誤暫代警示。
- 4 圖與 8 圖分別在 `8069.TWO` panel 顯示四帶五線，其他未勾選 panel 沒有殘影且所有 panel 均無載入錯誤。快速切換 `2492.TW` → `8069.TWO` 時，兩者都保持勾選並重新取得各自 1,214／1,199 筆 coverage，沒有前一商品資料殘留。
- 重新整理後回到單圖、checkbox 預設未勾，河流 status、band 與 warning 都為空；重新勾選可正常載入，符合按需載入與 cleanup 規格。
- 實際下載並目視開檔 `/Users/alanyi/Downloads/8069.TWO_1d_2026-07-23T01-42-03-862Z.png`：PNG 為 2992×3468、約 1.2 MB，包含主圖四帶五線、pointed-date 官方 readout、技術副圖及全部籌碼副圖，沒有 viewport 裁切。

## 完成狀態與剩餘風險

- tasks 6.4、6.5 已有真實官方、D1、workflow、API、已登入 UI 與 PNG 證據；本 change 為 32／32。
- 首次逾時 run 留下的 `running` job 只能在 lease 到期後回收；version 114 已具備回收路徑，後續排程可冪等接續，不會在 lease 有效期間重複處理。
- 歷史來源仍是 FinMind intermediary，最新值與最終信任仍由 TWSE／TPEx OpenAPI 追認；若官方未發布、mismatch 或 gap，仍須依既有 fail-closed／quarantine 規則處理，不得稱為官方資料。
