## Why

部分台股日 K 面板先顯示已載入資料後，新的 `/api/candles` 回應雖成功，前端套用資料仍可能拋出 `Value is null`，讓使用者誤以為商品資料來源失敗，且畫面可能停留在快取版本。此問題目前可在單圖、多層副圖及分類分頁切換後間歇出現，必須修正實際資料套用與圖表生命週期邊界，而不是只隱藏錯誤訊息。

## What Changes

- 將 K 線 payload 的驗證、快取提交與圖表套用改為具原子性的流程：只有目前 panel generation 與 load token 仍有效，且必要資料通過圖表資料正規化後才套用與寫入快取。
- 避免同一份快取資料與新資料在單次載入期間觸發互相交錯的圖表 series 重建、時間軸 refit 或延遲 callback；已失效 callback 不得操作目前或已銷毀的圖表。
- 對可安全略過的空值資料點採用明確正規化；對整份無效 payload 保留上一份可用資料，並顯示能區分「資料請求失敗」與「圖表更新失敗」的診斷狀態。
- 加入快取後更新、代表性 ETF、快速切頁、捲動與多層副圖的自動化及實際瀏覽器驗收，確認不再出現 `Value is null`，游標與可視範圍仍正確。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `codex-sites-rewrite`: 強化已載入資料後的前景更新契約，要求成功回應只能以有效、可繪製且屬於目前 panel 生命週期的資料原子替換畫面與快取，並禁止 `Value is null` 造成假性更新失敗。

## Impact

- 前端：`public/static/app.js` 的 panel load、payload 正規化、series 套用、時間軸與延遲工作生命週期。
- 測試：前端 contract 與瀏覽器互動驗收，涵蓋 `00919.TW`、`00982A.TW`、快取更新及快速分類切頁。
- API 與資料庫：不變更 `/api/candles` schema、D1 migration、資料來源或秘密值。
- 部署：同一提交分別發布至 Sites 保留站與 Cloudflare 正式站並各自驗收。
