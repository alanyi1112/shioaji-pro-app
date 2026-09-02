## Why

MultiView 新加入台股商品時，目前通常只能先顯示 TDCC 最新一期，必須等待逐商品官方歷史流程才能形成大戶／散戶持股線與週變化；來源限速、冷卻或封鎖會讓可見歷史長時間維持單點。`wirelessr/tdcc-opendata-archive` 已保存同一 TDCC `1-5` 全市場資料的多期 CSV，專案也已有固定 commit、逐檔 hash 與官方最新期對帳的驗證基礎，適合在不降低資料可信度的前提下作為快速補缺傳輸層。

## What Changes

- 建立 MultiView TDCC 歷史快速 bootstrap：將核准且完整驗證的全市場週次一次匯入本機、Sites 保留站與 Cloudflare 正式站的既有 shareholder-distribution 資料層，使之後新增商品能先從資料庫立即取得可用歷史。
- 將鏡像定位為 TDCC 資料的傳輸鏡像，而非新 provider；固定 immutable repository commit、逐檔 URL、原始位元組數、SHA-256 與 normalization version，並以同次 TDCC 官方最新全市場資料作重疊對帳。
- 鏡像只補入缺列，不覆蓋既有官方 OpenAPI、官方歷史表單或其他已驗證列；內容衝突須隔離並保留最後已驗證資料。
- 將快速 bootstrap 與既有 TDCC continuous ledger 整合：已匯入週次精準標記完成，官方背景回補只處理仍缺少的合法週次，直到既有 51 週完整目標成立。
- 新增週次驗證收據、來源／授權標示、target／processed／remaining／failed／overdue、快速補入期數與官方補缺期數等可觀測狀態。
- 更新大戶／散戶持股副圖狀態，使部分但已驗證的歷史可立即畫線並計算相鄰週變化，同時清楚區分快速補入完成與 51 週完整回補完成。
- 第一版只使用與目前 51 週窗口有實際連續價值、且由目前 TDCC 開放資料流程產生的 2026 快照；不將來源鏈不同且與近一年中斷的 2021 快照混入連續線圖。

## Capabilities

### New Capabilities

- `multiview-tdcc-verified-archive-bootstrap`: 定義 TDCC 全市場歷史鏡像的核准、固定版本、完整驗證、一次性／增量匯入、官方重疊對帳、來源優先序、週次收據、補缺與三環境驗收契約。

### Modified Capabilities

- `multiview-after-hours-data`: 盤後 TDCC 排程新增快速全市場 bootstrap lane，並將已驗證鏡像週次納入 continuous ledger、coverage、健康狀態與官方剩餘工作規劃。
- `multiview-chip-data-stability`: 大戶／散戶持股副圖須立即使用資料庫中已驗證的部分歷史、呈現快速補入與官方補缺進度，且任何鏡像或背景失敗都不得清除最後已驗證線圖。

## Impact

- 影響 `apps/multiview/worker/` 的 TDCC snapshot parser、shareholder-distribution 寫入、continuous backfill ledger、health／API 契約與資料庫 migrations。
- 影響 `apps/multiview/public/static/` 的大戶／散戶持股副圖狀態文案、coverage 與背景回補提示。
- 影響 `scripts/stock-screener-tdcc-bootstrap.mjs`：抽出或重用既有 pinned archive 驗證能力，但不得改變盤後選股專用資料與 MultiView 個人長歷史 target 的隔離邊界。
- 影響本機 operator、Sites／Cloudflare TDCC workflow 與部署後資料 seed；不得由一般 GET、圖表載入或未識別請求直接下載鏡像或執行全市場寫入。
- 新增政府資料開放授權條款第 1 版所需的原資料提供機關顯名，以及鏡像 repository、commit、hash 與驗證版本等非敏感 provenance。
- 不涉及 Shioaji production、真實下單、帳戶、委託或 CA；既有 simulation API、watchdog、5173、5174、盤後 pipeline 與行情連線的生命週期邊界維持不變。
