## Why

正式站的估算融資成本在跨交易日餘額出現來源調整時會永久中斷，導致後續已有完整融資資料仍不再畫線；估算融資維持率又因 Worker 永遠傳入 `marginLoanRatio=null` 而無法產生任何資料點。需要讓成本鏈在保留可追溯 gap 的前提下安全恢復，並依產品參考文件明定的個股估算公式產生維持率。

## What Changes

- 遇到跨交易日融資餘額不連續時，保留當日 `balance_mismatch` gap，不補造未知調整量。
- 在 mismatch 後第一個輸入完整且自身流量可核對的交易日，以當日收盤價建立新的估算區段並標示 `reseeded`，避免成本線永久中斷。
- 版本化估算公式與 response metadata，區分首次 `seeded`、餘額歸零後重建及中斷後 `reseeded`。
- 個股估算融資維持率固定依 `當日收盤價 ÷（估算融資成本 × 60%）× 100%` 計算。
- response 明確揭露固定 60% 是估算模型參數，不是商品當日實際融資成數，也不是個別券商帳戶維持率。
- 讓既有「估算融資維持率」副圖取得合法資料點、標題讀值、gap 原因與詳細資料，不新增第二份上游融資請求。
- 對已啟用融資券群組的舊版副圖偏好執行一次性遷移，補入「估算融資維持率」pane；新版使用者明確移除後不再自動加回。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `estimated-margin-metrics`: 成本鏈中斷後的可追溯重新起算、公式版本及固定 60% 個股估算融資維持率語意。

## Impact

- 受影響程式包含 `worker/estimated-margin-metrics.ts`、`margin-short` response、主圖與副圖狀態顯示及相關測試。
- 不新增 D1 migration；既有日籌碼資料可重新裝飾估算結果。
- 維持率仍是估算值，不代表個別券商、個別客戶或實際追繳維持率。
