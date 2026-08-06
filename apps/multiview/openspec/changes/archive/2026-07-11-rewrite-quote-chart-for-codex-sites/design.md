# 設計：Codex Sites 完整改寫

## 架構

- `public/static/` 保留來源產品成熟的 DOM、CSS 與圖表互動，作為功能 parity 基線。
- `worker/index.ts` 作為 Cloudflare Worker 入口；`worker/app.ts` 實作既有 `/api/*` contract。
- `worker/market-data.ts` 直接取得 Yahoo Chart 與 Hyperliquid 公開行情，並提供 sample fallback。
- `worker/indicators.ts` 計算 MA、RSI、KD、MACD、Bollinger、ATR、FVG 與 Volume Profile。
- D1 保存每位 Sites 使用者的自訂頁籤與商品清單；Fixed Range VP 等裝置偏好維持 browser storage。

## 相容策略

- 保持既有前端使用的 API 路徑與 payload 欄位，降低視覺及互動回歸風險。
- 既有 Render 站只用於比較來源行為；部署版所有同源 `/api/*` 都由 Sites Worker 回應。
- Yahoo／Hyperliquid 暫時不可用時回傳保守錯誤或 sample 資料，不暴露上游細節與秘密。
- Massive 維持免費方案，不以升級付費 entitlement 作為完成條件；免費方案未涵蓋的指數、外匯或期貨必須保守標示 `unverified`，並保留 `not_entitled`、`symbol_not_covered` 或其他安全原因碼。

## 台股第二來源核對

- `.TW` 已完成日 K 使用 TWSE 官方 `STOCK_DAY_ALL`，`.TWO` 使用可指定交易日且較適合 Workers 的 TPEx 官方每日收盤 JSON。
- 若 TPEx 官方網域拒絕 Codex Sites／Cloudflare Worker 出口，`.TWO` 才改用 TWSE 官方 MIS 的 `otc` 行情核對，並把 provider 明確標為 `twse-mis`，不得誤稱為 TPEx 回應。
- 若 Sites runtime 無法直接連到 TPEx 與 TWSE MIS，private GitHub repo 的排程 workflow 會定期抓取、驗證 TPEx 官方全市場收盤資料，再以 Sites bypass token 與獨立 ingest secret 寫入 D1；Sites 只接受通過筆數、日期、代號與收盤價驗證的 payload。
- D1 鏡像 provider 標示為 `tpex-mirror`；只有鏡像交易日與主來源相同且收盤價一致時才能 `verified`。鏡像不存在、資料不完整或日期落後時維持 `unverified`，且不得依賴 Render。
- 核對流程先解析官方民國日期並與主來源 `sessionDate` 對齊，再依官方價格精度比較收盤價；官方資料尚未發布目標交易日時保持 `unverified`。
- TWSE 與 TPEx 的全市場回應分別使用短期記憶體快取與 single-flight，讓多圖與 candles／stream 共用同一份官方資料。
- candles 與 stream 共用同一個 payload／verifier 路徑；被排除的台股零量平盤占位 K 以 `dataQuality` 回傳中性診斷資訊。
- 前端固定顯示 `已核對`、`未驗證`、`待核對` 或 `資料過期`，不只把驗證結果放在 tooltip。

## 驗證

- `npm run build` 必須成功產出 Workers 相容 bundle。
- API smoke 覆蓋 health、商品設定、台股、美股、Hyperliquid、搜尋與 D1 CRUD。
- 瀏覽器確認多圖載入、頁籤切換、圖表數量、聚焦模式與 console error。
- Sites deployment 成功後再以正式網址重跑 health 與首頁驗證。
