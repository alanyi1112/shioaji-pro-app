## 驗證結果

日期：2026-07-22（Asia/Taipei）

### 自動驗證

- `npm run lint`：通過。
- `npm test`：214 項通過、0 項失敗，包含 production build。
- `openspec validate --all --strict`：19 項通過、0 項失敗。
- `git diff --check`：通過。
- parser、D1、API、背景 runner 與 frontend contract 均有自動測試，涵蓋來源交叉核對、信任優先序、actual coverage、至少 252 筆門檻、latest-first、budget、lease、latest-wins、SVG cleanup 與 PNG clone。

### 真實免費來源與本機 D1

- FinMind `TaiwanStockPER` 與 `TaiwanStockPrice` 五年 range 實測：`2330.TW` 與 `8069.TWO` 各 1,214 筆有效配對交易日，coverage 均為 `2021-07-22～2026-07-22`。
- `2330.TW` 在 `2026-07-21` 與 TWSE 官方 P/E／收盤價於 0.01 容許內相符；`8069.TWO` 在 `2026-07-22` 與 TPEx 官方資料相符。
- 資料已按月經本機私有 ingest 寫入 D1；重新呼叫 public river API 直接讀回 available，兩檔均超過 252 筆，未使用未授權 fallback，也未保存秘密值。

### 實際瀏覽器與 PNG

- 1／4／8 圖均驗證 `2330.TW` 勾選後顯示五條界線與四個半透明河流帶；各 layout 的 SVG 尺寸會跟 panel 重算。
- crosshair readout 顯示官方本益比、交易所參考 EPS、財報年／季、P10／P30／P50／P70／P90、所在區帶、原資料提供機關、FinMind、政府資料開放授權與 actual coverage。
- 滾輪縮放與拖曳平移後 SVG 座標均更新；快速由普通股切至 ETF 時 latest-wins，週 K 與 `0050.TW` 均不留 polygon、polyline 或 readout。
- 右鍵「儲存此商品所有線圖為圖片」已實際下載並開檔驗證 `2330.TW_1d_2026-07-22T14-22-06-675Z.png`，PNG 為 2498×3128、880 KB，包含完整 panel、河流帶與指向日期 readout。

### 正式環境驗證

- 私有 GitHub Actions workflow 的雙重授權、Sites dispatch 身分、最小權限、每批最多 8 檔、全域每小時 240 request budget、heartbeat 與 D1 checkpoint 均完成實際執行；run `29930870520`、`29931913222`、`29932414686` 均成功，並以正式 health／個股 API 核對 D1 coverage，不只採信 workflow 結論。
- 正式 `2330.TW` API 回 `available`、1,214 points、coverage `2021-07-22～2026-07-22`；來源顯示臺灣證券交易所、FinMind 與政府資料開放授權。正式 health 已寫入 TWSE `2026-07-21` 與 TPEx `2026-07-22`，`mismatch=0`。
- 已登入 Chrome 對正式 `2330.TW` 日 K 勾選後，SVG 實際包含 5 個 polyline 與 4 個 polygon；status 顯示 1,214 筆與五年 coverage，crosshair 顯示官方 P/E、交易所參考 EPS、P10～P90、歷史區帶、TWSE、FinMind 與授權。
- 重新載入時 checkbox 為未勾選，正式 Worker log 沒有河流 API；勾選後才出現唯一一筆同源 `GET /api/taiwan-stock-pe-river` 並回 200。匿名 `curl` 為 401，但 Sites control plane 確認 active／custom、僅 1 位 allowed user、0 groups，因此不誤判部署失敗。
- 正式 Sites version 108 對應完整 commit `094fdc8e0a366f2b1c51895723740628ed89aa8a`，第一次部署因建置串流無終態失敗，使用同一 saved version 重試後 succeeded。
