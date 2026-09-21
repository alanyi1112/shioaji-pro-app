# 驗證紀錄

## 正式資料與發布狀態

- 驗證時間：2026-09-14（Asia/Taipei）。
- 股票母體：1,975 檔，其中 TWSE 1,084 檔、TPEx 891 檔；1,975 檔皆有同一 universe revision 的已發行普通股數與 provenance。
- 日 OHLCV v3：120/120 個市場日 target 完成；TWSE 60/60、TPEx 60/60。
- 日 OHLCV v4：260/260 個市場日 target 完成；TWSE 130/130、TPEx 130/130。最新母快照有效交易日為 2026-09-14。
- 籌碼日資料：2026-08-06 至 2026-09-11 的必要窗口已驗證。2026-09-14 的 TWSE T86 與 MI_MARGN 正式端點仍回覆無資料，因此當日 4 份 receipt 未成立，正式 v5 publication head 維持空值。
- 目前 v5 狀態為 `pending / v5_preparation_pending`。這是預期的 fail-closed 行為；系統沒有把 2026-09-11 冒充 2026-09-14，也沒有以零值或逐檔非正式來源補資料。
- TDCC `full-17`：2026-09-11 為 1,975/1,975；2026-09-04 只有 90 檔，不具全市場資格。發布器會選用對當期 universe 逐檔成立的週錨點，不會使用 53 檔需求式快取充當完整證據。
- D1 `PRAGMA integrity_check`：`ok`。正式資料庫沒有 v5 published snapshot，也沒有 v5 publication head。
- 代表股票逐列核對：`2330.TW` 與 `6488.TWO` 的 2026-09-11 投信、融資及融券列，其 institutional／margin receipt 日期皆為 2026-09-11；兩檔同日 TDCC 皆為 `full-17`，已發行普通股數分別為 25,932,370,067 股及 478,113,725 股，來源日期皆為 2026-09-13。

## 傳輸與排程

- TPEx 大型日行情回應偶爾在 TLS 1.3 傳送途中重設連線。collector 已固定使用 HTTP/1.1／TLS 1.2、保留憑證鏈驗證，並只對 `ECONNRESET`、`ETIMEDOUT`、`EPIPE` 做最多 5 次有界重試。
- TPEx 缺少的公開中繼憑證由 `scripts/certs/twca-ssl-certification-authority.pem` 提供；沒有使用 `NODE_TLS_REJECT_UNAUTHORIZED=0` 或其他略過 TLS 驗證方式。
- 每日正常排程只補 1 個缺少的 session；首次暖機最多補 21 個 session。已驗證 receipt 會跳過，GET/status/results 不會執行擷取。

## 完整 universe 資源量測

正式 2026-09-14 籌碼報表尚未發布，因此資源量測在一致性 D1 備份上執行。量測資料把 2026-09-11 的正式列數複製成 2026-09-14 等量資料，只用於負載與容量測試；它沒有寫回正式 D1，也不作為資料正確性或 current snapshot 驗收證據。

| 項目 | 實測結果 | 設定門檻 |
| --- | ---: | ---: |
| universe | 1,975 檔 | 最多 2,500 檔 |
| v5 建置時間 | 6.78 秒 | 操作目標 30 秒內 |
| 建置程序最大 RSS | 432,062,464 bytes（約 412 MiB） | 操作目標 512 MiB 內 |
| 單次查詢延遲（cold） | 570 ms | 操作目標 1 秒內 |
| 5 次查詢（含 cold） | 545、312、323、316、297 ms | 操作目標 1 秒內 |
| 查詢 GC 後 RSS | 約 376–407 MiB | 操作目標 512 MiB 內 |
| v5 逐檔 payload 總量 | 58,726,653 bytes | 單一快照最多 160 MiB |
| 最大單列 payload | 40,345 bytes | 每列最多 65,536 bytes |
| v5 回應（88 列） | 416,919 bytes | 查詢最多 100 列 |
| D1 檔案增量 | 24,571,904 bytes（使用既有 free pages 後） | 保留 2 份 v5 快照，建議預留至少 160 MiB |

repository 會在 staging 前檢查 universe、單列及整份序列化大小，超限時回傳 `v5_resource_limit_exceeded`，並固定只保留最新 2 份 v5 快照。健康 API 會回傳同一組 `resourceLimits`。

## 介面與副作用

- 實際 `?layout=stock-screener` 分頁已驗證八項新控制、長線佈局草稿、鍵盤 Enter 送出與來源延遲提示。
- 320 px 窄視窗會把選股面板與 K 線圖上下排列；選股面板不再被壓成不可操作的窄欄。
- 套用「長線佈局」只勾選草稿，不送出 results request；按「開始篩選」才查詢。
- 瀏覽器送出 v5 查詢前後，`screener_chip_runs=70`、`screener_chip_receipts=108`、`screener_chip_daily=51,982` 均未改變。
- 停用全部 v5 新條件時，v5 URL 與既有路由投影結果逐 byte 相同；測試樣本回傳相同 snapshot、state 與列資料。

## 未解風險

- 2026-09-14 的 TWSE 三大法人及信用交易正式資料尚未發布；在來源成立前不能宣稱 current v5 完成。
- 正式 D1 仍保留先前來源中斷與 empty report 的 failed run，供稽核使用。
- 連續快速查詢在沒有 GC 的短生命週期 Node 壓測中，程序最大 RSS 曾達約 1.05 GiB；強制 GC 後穩定在約 386 MiB。正式查詢已有 2,500 檔、100 列回應與 payload 大小硬上限，仍應觀察長時間執行環境的 GC 與 RSS。

## 驗證命令

完成前執行並記錄：

```text
node --test apps/multiview/tests/stock-screener-chip-sources.test.mjs apps/multiview/tests/stock-screener-v5-publisher-route.test.mjs
pnpm exec vitest run src/lib/stock-screener-v5.test.ts src/lib/stock-screener-api.test.ts src/lib/stock-screener-gateway.test.ts
pnpm exec vitest run --config vitest.browser.config.ts src/components/stock-screener-panel.browser.test.ts
pnpm exec tsc --noEmit
pnpm --dir apps/multiview exec tsc --noEmit
pnpm build
pnpm build:multiview
git diff --check
openspec validate add-chip-filters-to-after-market-stock-screener --strict
```

結果：後端整合 38 項、前端單元 35 項、瀏覽器 18 項均通過；兩套 TypeScript、兩套 build、MultiView ESLint、shell syntax、`git diff --check` 與 OpenSpec strict validation 均通過。主程式 build 只有既有的大型 chunk 提示；MultiView build 只有 vinext 未來 native config 相容性提示。
