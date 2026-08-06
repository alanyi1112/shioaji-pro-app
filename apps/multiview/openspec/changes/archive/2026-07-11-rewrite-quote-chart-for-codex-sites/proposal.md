# 變更提案：完整改寫報價線圖並部署至 Codex Sites

## 為什麼

現有 `alanyi1112/quote-chart-multiview` 使用 Flask、Python、yfinance、SSE 與 Supabase／Render runtime，無法直接部署至 Codex Sites。需要在保留產品功能與可見互動的前提下，改寫為 Sites／Cloudflare Workers 相容架構，並以 Codex Sites 作為新版唯一正式部署目標。

## 變更內容

- 保留 1／2／4／6／8 圖、多市場頁籤、分頁、聚焦單圖、指標選單、價格資訊與 Fixed Range Volume Profile 等前端行為。
- 將 Flask API 改寫為 TypeScript Sites Worker API。
- 將 yfinance 改寫為 Workers 可直接存取的 Yahoo Chart Web API，並保留 Hyperliquid 與 sample 資料源。
- 將 Python 技術指標改寫為 TypeScript，維持現有 API payload contract。
- 將 Supabase 個人頁籤與商品清單改寫為 Sites D1 持久化，使用 Sites 提供的使用者識別。
- 將即時更新改寫為 Workers streaming SSE。
- 完成自動建置、API smoke、實際頁面與互動驗證後部署至 Codex Sites。

## 不包含

- 不修改或關閉既有 Render 正式服務。
- 不把既有 Render 站當作新版正式後端或 fallback。
- 不把任何帳密、API key、token 或金鑰寫入 repo、OpenSpec 或前端。
