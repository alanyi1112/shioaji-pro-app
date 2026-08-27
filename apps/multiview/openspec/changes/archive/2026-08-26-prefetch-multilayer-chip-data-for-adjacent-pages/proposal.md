## Why

MultiView 目前只預載相鄰分類頁的 K 線 payload；使用者在多層副圖模式切到下一頁時，仍須等待每檔商品的 TDCC 與日籌碼資料下載及 pane render，造成主圖先出現、副圖延後補上的可見落差。現有 chip request cache、single-flight 與 K 線預載 queue 已具備可重用基礎，適合加入受資源預算約束的下一頁籌碼預載。

## What Changes

- 當 effective presentation mode 為多層副圖、週期為日 K 且下一頁商品符合台股資格時，在 K 線預載成功後接續預載每檔商品已選 pane 所需的全部 TDCC／籌碼 datasets。
- 下一頁候選商品數量以目前圖表數量為上限；1／2／3／4 圖分別最多預載 1／2／3／4 檔，最後一頁只處理實際剩餘商品。
- 每檔商品將重複 dataset 去重後合併為單一 chip request，沿用完成 response cache 與 in-flight single-flight；不得逐 pane 重複請求。
- 新增籌碼預載 priority queue、並行／timeout／generation cancellation、頁面 visibility 與節省流量網路 gate。
- 籌碼 cache 採 stale-while-revalidate：切頁先使用最後 verified payload，背景更新成功才取代；失敗不得清除既有副圖。
- 新增預載請求、cache hit、切頁後實際使用與未使用淘汰等安全效益指標，供 browser 驗收與後續調校。
- 預載不得建立 offscreen chart、訂閱下一頁即時行情、啟動 TDCC 歷史回補、backfill polling 或暴露秘密資料。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `codex-sites-rewrite`：讓分類頁背景預載依圖表數量與資源預算處理下一頁已選籌碼資料，並維持多圖 cache／single-flight 與 Sites／Workers 安全邊界。
- `taiwan-stock-chip-subcharts`：讓多層副圖以每個 tab／symbol 保存的 pane 選項預載所需 datasets，並以 stale-while-revalidate 安全重用最後 verified payload。

## Impact

- 前端：`public/static/app.js` 的分類分頁與 panel payload prefetch queue，以及 `public/static/chip-panes.js` 的 selection、request cache、single-flight 與 debug report。
- API：沿用同源 `GET /api/taiwan-stock-chip`；不得由瀏覽器攜帶上游 token，也不得以預載自動呼叫 `/api/taiwan-stock-chip/backfill`。
- Runtime：本機、Codex Sites 與 Cloudflare Workers 相容環境都必須使用相同 bounded、best-effort 行為。
- 驗證：需涵蓋 1／2／3／4 圖、最後不足頁、快速切頁／切 tab／切模式、cache hit、慢速或節省流量網路、失敗保留與零額外 SSE／backfill。
