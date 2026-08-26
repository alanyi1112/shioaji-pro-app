## Why

2026-08-26 的 MultiView 實際驗收中，`pnpm local-runtime multiview-daily` 對 TPEx PE latest provider 回報 `schema_mismatch`；雖然既有 verified 資料仍可讓 health 顯示 2026-08-25，但最新資料更新可能退回舊資料或維持 pending，無法把來源尚未發布與解析器不相容清楚分開。現在需要修正 schema drift 處理並建立回歸門檻，避免 TPEx 欄位調整再次造成 PE 線圖停更。

## What Changes

- 盤點並固定 TPEx PE latest 實際回應欄位、資料日期與缺值語意，新增不含機密的 provider fixture。
- 更新 TPEx PE parser，使已知合法 schema 變體可正規化為既有 canonical PE row，未知 schema 仍 fail closed 並保留可診斷 reason code。
- 明確區分 `official_not_published`、合法空資料、`schema_mismatch` 與暫時 provider failure，禁止以舊值、零值或 requested end date 冒充最新資料。
- 逐一分類目前 PE history 的 missing／insufficient 商品，只有解析或排程缺陷列為修正；來源本身不足者維持可見的 partial／pending。
- 新增 parser、pipeline、health 與瀏覽器回歸驗收，至少涵蓋一檔 `.TW` 與一檔 `.TWO`，並核對實際 source date、D1 changed-only 寫入及 PE 線圖不消失。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `multiview-after-hours-data`: 強化 TPEx PE schema drift 的 fail-closed 正規化、reason code 分類、coverage 健康狀態與代表 `.TWO` UI 驗收要求。

## Impact

- 受影響範圍：`apps/multiview/` 的 TPEx PE provider adapter／parser、盤後 daily pipeline、D1 PE latest／history 寫入與 health summary。
- 驗證範圍：本機 simulation runtime、`pnpm local-runtime multiview-daily`、代表 `.TW`／`.TWO` API 與實際瀏覽器 PE 線圖。
- 不涉及 Shioaji production、真實下單、帳戶資料或任何機密值。
