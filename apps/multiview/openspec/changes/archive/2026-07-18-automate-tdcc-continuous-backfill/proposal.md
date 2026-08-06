## Why

目前 TDCC 歷史資料只在人工執行本機 runner 時回補，最新週快照也只有在使用者開啟籌碼副圖且快取過期時才會抓取；網站若沒有流量，或新增台股後未人工操作，就可能漏掉週資料。需要建立真正的背景排程，持續保存每一期官方週快照，並讓任何新加入網站的合格台股普通股或 ETF 自動進入歷史回補佇列。

## What Changes

- 新增受保護的背景排程工作：不依賴使用者開圖，每日檢查 TDCC 最新週快照；同一 `dataDate` 冪等 no-op，新一期則保存所有目前合格目標證券。
- 動態從商品目錄與使用者已加入的商品集合重建目標清單；任何新加入且確認為 TWSE／TPEx 普通股或 ETF 的 symbol，都要建立獨立歷史 coverage 與回補工作，不得只使用部署時的固定清單。
- 對新 symbol 自動回補 TDCC 免費歷史查詢頁目前提供的週資料：背景 operator workflow 使用官方公開 GET／POST 表單 session、單一併發、低速、有限批次、checkpoint 與受保護 ingest；不得部署到 Worker、規避 CAPTCHA／封鎖或擴張成未加入網站的全市場歷史掃描。
- 新增 D1 持續同步狀態、symbol queue、lease、重試時間、catalog revision、coverage gap 與最後排程心跳；重複排程、部署中斷及併發執行都必須安全續跑。
- 新增 GitHub Actions `schedule` 與 `workflow_dispatch` 執行器，秘密只由 GitHub／Sites secrets 提供；workflow 每次重新向受保護 API 取得目前待處理 symbol／週次，不在 repository 固定寫死目標。
- 每週最新快照優先保存；若偵測到漏週，背景歷史 runner 自動補洞。遇 CAPTCHA、來源封鎖、格式漂移或來源限制時停止該批次、保留既有資料並在 health／UI 顯示可操作的安全狀態。
- 新增逐 symbol 的 queued、running、partial、completed、blocked 狀態；大戶／散戶副圖對新台股顯示實際進度，不以全市場單一完成狀態誤導。
- TDCC 仍明確為週資料／當週最後營業日；背景每天檢查不代表資料變成日頻，非發布日仍保持 gap。

## Capabilities

### New Capabilities

- `tdcc-continuous-backfill`: 定義背景排程、動態 symbol 發現、逐 symbol 歷史回補佇列、最新週快照持續保存、缺週補洞、租約續跑與安全告警契約。

### Modified Capabilities

- `taiwan-stock-chip-data`: 將 TDCC 更新由使用者請求時的 opportunistic refresh 擴充為背景持續更新，並要求新加入的合格台股自動建立 coverage 與回補狀態。
- `taiwan-stock-chip-subcharts`: 讓大戶／散戶副圖依目前 symbol 顯示背景排程、歷史回補、缺週或 blocked 狀態，而非只顯示全域工作狀態。

## Impact

- 影響 `worker/app.ts`、`worker/taiwan-stock-chip-service.ts`、`worker/tdcc-history-backfill.ts`、`scripts/tdcc-history-backfill.mjs`、D1 migrations、商品目錄／個人清單事件與相關測試。
- 新增受保護的 queue／claim／heartbeat／ingest API 與 `.github/workflows/` 背景排程；需要在 GitHub Actions secrets 設定 Sites 存取權杖與獨立回補 secret，實際值不得進入 repo、OpenSpec、log 或 response。
- 依賴 TDCC 最新 OpenAPI 及公開歷史查詢頁；後者若出現 CAPTCHA、封鎖或格式改變，系統必須 fail closed 並告警，不能以規避方式保證完成。
- 不改變既有圖表頻率、持股級距計算、D1 唯一鍵或非發布日缺值語意。
