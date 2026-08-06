## 1. ETF eligibility 與 API 契約

- [x] 1.1 先以 worker／service 測試建立普通股、上市 ETF、上櫃 ETF、權證、未知商品及非日 K 的 capability matrix 期望值。
- [x] 1.2 將商品 eligibility 重構為支援啟用中的 TWSE／TPEx `EQUITY` 與 `ETF`，並維持 exchange／`.TW`／`.TWO` suffix 的嚴格核對。
- [x] 1.3 在 `GET /api/taiwan-stock-chip` 新增向下相容的 `datasetEligibility`，讓五個 dataset 各自回報 `supported`、原因與候選來源，並保留既有 top-level `eligible`。
- [x] 1.4 更新 FinMind、TWSE、TPEx adapter 路由，使 ETF 能取得實際存在的法人、外資持股、融資券與借券資料；來源無紀錄時只降級該 dataset，且不得把缺值補零。
- [x] 1.5 加入 ETF 部分資料可用、上游回空陣列、來源失敗及普通股相容性的 response contract 測試。

## 2. TDCC ETF 與免費週歷史

- [x] 2.1 確認 TDCC 官方歷史匯出的穩定 URL、日期參數、格式及自動介接允許範圍，將可證明的契約與 fixture 固定於 adapter 測試；無法證明時實作 fail-closed 狀態。
- [x] 2.2 擴充 TDCC 全市場 eligibility 與 parser 測試，確認含尾端空白的 ETF 代號可正規化，並以 `00919` 等 17 級距 fixture 驗證普通股／ETF 都能解析。
- [x] 2.3 建立 TDCC history adapter，以資料日期分批讀取免費官方歷史輸入，沿用最新快照的日期、分級唯一性、有限數值與合計驗證。
- [x] 2.4 將歷史 adapter 接入受保護 ingest、market-wide single-flight、coverage 缺口判斷與批次 D1 upsert；同一資料日期不得逐 symbol 重複下載。
- [x] 2.5 檢查現有 `symbol + dataDate` schema 是否足以保存歷史匯入狀態；若不足，只新增 additive migration／index，並加入既有 D1 資料相容測試。
- [x] 2.6 實作官方歷史不可用、格式變更、查詢超出免費保存範圍、重複匯入及最新快照持續累積的退讓／negative-cache 測試。

## 3. 大戶散戶比例線與週變化柱

- [x] 3.1 更新 holder pane，為大戶與散戶各建立持股比例 LineSeries 與週增減 HistogramSeries，分別使用 `%` 與「百分點」formatter 及獨立尺度。
- [x] 3.2 只以相鄰兩筆實際 TDCC `dataDate` 計算週變化；增加使用台股紅色、減少使用綠色、持平使用中性色，且不得 forward-fill 或製造每日柱。
- [x] 3.3 為只有一筆快照的情況加入可辨識的比例資料點、日期及「首筆／無前週比較／歷史累積中」狀態，不繪製假的變化柱或趨勢。
- [x] 3.4 更新 hover／readout／legend，顯示週頻、比例、週增減百分點、官方級距、張數、人數、provider 與資料日期，並保留非彩色辨識方式。
- [x] 3.5 讓 ETF pane 依 `datasetEligibility`／`availability` 各自顯示可用、部分、無紀錄、過期或不適用，不影響同 panel 的其他籌碼及技術副圖。
- [x] 3.6 驗證比例線、週變化柱與主圖在 A／B、1／2／3／4／6／8 圖、聚焦、resize、crosshair、切換 symbol 及向左載入時保持時間軸與 lifecycle 同步。

## 4. 驗證、部署與回歸

- [x] 4.1 擴充 `tests/taiwan-stock-chip.test.mjs` 與 `tests/taiwan-stock-chip-service.test.mjs`，涵蓋 ETF capability、TDCC 歷史、D1 冪等、部分資料及安全退讓。
- [x] 4.2 擴充 `tests/rendered-html.test.mjs` 與前端 contract，驗證 ETF 不再被整體排除、holder pane 同時建立 line／histogram、單點狀態及週資料文字標示。
- [x] 4.3 執行 `node --check`、`npm test`、migration 檢查與 `openspec validate --all --strict`，並確認 repo／輸出不含 token 或其他秘密。
- [x] 4.4 以本機瀏覽器實測至少一檔普通股與一檔 ETF 的 A／B 模式、可用與 unavailable pane、單點與多週 holder 歷史、hover 及多圖尺寸。
- [x] 4.5 提交並推送通過驗證的 exact source，建立及部署新的 Codex Sites 版本。
- [x] 4.6 以已登入正式站驗證上市普通股、上櫃普通股、上市 ETF 與可用上櫃 ETF 的 API／可見副圖，確認比例線、週變化柱、來源日期及局部失敗行為後再回報完成。
