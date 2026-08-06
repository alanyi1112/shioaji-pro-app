## 驗證結果

日期：2026-07-21（Asia/Taipei）

### 自動驗證

- `npm run build`：通過。
- `npm test`：194 項通過、0 項失敗。
- `npm run lint`：通過，0 warnings。
- `openspec validate restore-sox-volume-and-limit-multilayer-subcharts --strict`：通過。
- `openspec validate --all --strict`：19 項通過、0 項失敗。
- 測試明確確認 `^SOX` 原始量為 0 時，上游只請求 `^SOX`，沒有請求或合併 `SOXQ`、`SOXX` 或其他商品；原始來源改回有效量時直接顯示原始量並移除 unavailable metadata。

### Codex Sites 正式站

- 版本：97。
- commit：`296bb11007d1fe5bd5d4483733150a761b6cec80`。
- deployment：`appgdep_6a5f8546b7ac8191b53bb167af847089`，狀態 `succeeded`。
- 正式網址：`https://quote-chart-multiview.alanyi1112.chatgpt.site`。
- Live `/api/candles?symbol=%5ESOX&interval=1d&display_count=160`：160 筆 candles、非零成交量 0 筆、`sourceProvider: "yfinance"`，`quote.volumeAvailability` 與 `dataQuality.volumeAvailability` 均為 `status: "unavailable"`、`reason: "source_not_provided"`、`message: "此指數來源未提供成交量"`。
- Live `2330.TW` 日線：最近 20 筆成交量皆大於 0，沒有 `volumeAvailability`，確認一般商品不會被誤標。
- Live HTML 含 `.volume-availability-note`；Live `app.js` 含 `activeTabSupportsMultiLayerSubcharts`、非台股回傳 A 與「只有台股商品可使用多層副圖」控制提示。
- Live 商品目錄：台股頁籤 24 個商品全為 `.TW`／`.TWO`；美股、匯率債券、期貨期指頁籤均不是全台股，因此 effective mode 依正式資產強制為單一副圖。

### 瀏覽器限制

代理瀏覽器開啟私人正式站時停在 Sign in with ChatGPT 門檻，沒有使用者登入狀態；本次未代替使用者授權登入。登入後的可見狀態改以正式站 HTML／JS、Live API、完整自動測試與 Sites deployment control plane 交叉驗證。
