## Why

Cloudflare D1 免費額度已達限制，現階段無法在不增加風險或干擾既有任務的前提下完成 verified archive migration、資料回補與實站驗收。為了讓已完成的本機與 Sites 工作可獨立歸檔，同時不遺失 Cloudflare 的未完成義務，需要建立一個額度恢復後才執行的維護 change。

## What Changes

- 在 Cloudflare D1 額度與寫入能力恢復後，重新選定並記錄當時 exact deployment SHA。
- 對 Cloudflare 正式站執行 additive migration、verified manifest seed、fresh archive workflow 與 protected readback。
- 核對固定商品母體、18 期 receipts、51 週 official coverage、守恆欄位與資料庫完整性。
- 以 protected API 與已登入 Cloudflare Access 的瀏覽器驗收 8103、代表性 `.TW`／`.TWO`／ETF、新增商品 DB-only warm path、持股副圖 DOM／canvas／console／network。
- 所有 Cloudflare 證據必須獨立取得，不得以本機、Sites、舊 run 或舊 deployment 代替。

## Capabilities

### New Capabilities

- `cloudflare-tdcc-verified-archive-acceptance`: 規範 Cloudflare D1 額度恢復後的 TDCC verified archive 部署、資料守恆、protected API 與 owner UI 驗收門檻。

### Modified Capabilities

- 無。

## Impact

- 影響 Cloudflare 正式站的 D1 migrations、TDCC archive／official workflows、protected health／API 與 Access 瀏覽器驗收。
- 不改動本機與 Sites 已完成資料，不啟停 simulation API、watchdog、5173、5174、pipeline 或行情連線。
- 未經新的實際執行授權，不會寫入 Cloudflare D1、dispatch workflow、部署或變更 Access 設定。
