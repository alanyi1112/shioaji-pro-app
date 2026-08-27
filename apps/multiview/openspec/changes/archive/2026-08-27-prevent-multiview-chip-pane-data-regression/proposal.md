## Why

台股開盤期間，MultiView 籌碼副圖可能先從既有快取顯示最後有效資料，之後卻被 HTTP 成功但資料較空、較舊或 coverage 倒退的背景回應覆寫，造成大戶、散戶持股比等線圖逐商品消失。現有保護只涵蓋 request 失敗，未阻止成功回應造成逐 dataset 資料品質退化，因此必須補上可驗證且 fail-safe 的提交邊界。

## What Changes

- 為籌碼 payload 建立逐 dataset 的有效資料摘要與品質比較，涵蓋日頻 rows、TDCC `distributionRows`、實際最新資料日、筆數、coverage 與 availability。
- 在 cache、前景載入與背景更新提交前，逐 dataset 比較候選回應與最後一次已驗證資料；空資料、較舊資料或 coverage 倒退不得清除既有 series。
- 允許混合 payload 只接受有進步的 dataset，並保留其他暫時退化 dataset 的最後有效 rows、日期、coverage、來源與顯示狀態。
- 讓開盤即時 K 棒擴張日期範圍、相鄰頁預載、手動回補與 stale-while-revalidate 共用相同資料退化保護，且不得跨 symbol、interval、tab 或 dataset 洩漏舊資料。
- 保護大戶／散戶持股副圖的價格尺度：縱軸手勢不得把主要持股比 series 永久移出可視範圍，同日期的新價位更新也必須通知持股 pane 恢復 autoscale，而不重新抓取籌碼資料。
- 在 UI 明示「保留最後已驗證資料」與實際資料日期；不得把仍有歷史線圖的暫時未發布狀態誤標為整組「當日無資料」，也不得以 0、forward-fill 或插值偽造當期資料。
- 擴充單元、整合與實際瀏覽器驗收，涵蓋所有籌碼副圖資料族群；技術副圖另做開盤更新壓力檢查，只有能重現相同退化時才修改其獨立計算路徑。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `taiwan-stock-chip-data`: API 與資料層必須保留逐 dataset 最後有效 rows、實際日期與 coverage，不得讓局部或暫時空回應造成資料退化。
- `taiwan-stock-chip-subcharts`: 籌碼副圖在 cache 首繪、背景更新與開盤 K 棒範圍變更期間必須維持最後有效 series，並以正確狀態說明暫時未發布資料。
- `codex-sites-rewrite`: 多 panel、預載、single-flight 與完成 cache 的提交必須加入逐 dataset 非退化契約及實際開盤瀏覽器驗收。

## Impact

- 前端：`public/static/chip-panes.js` 的 request cache、payload 接受／合併、pane render gate 與狀態文案；必要時調整 `public/static/app.js` 的開盤 context 更新及 acceptance metrics。
- Worker：`worker/taiwan-stock-chip-service.ts` 的 D1-first／上游回應合併與逐 dataset coverage／availability 契約。
- 測試：`tests/chip-pane-status.test.mjs`、`tests/chart-pagination.test.mjs`、`tests/taiwan-stock-chip-service.test.mjs`、`tests/rendered-html.test.mjs`，以及四圖多層副圖的實際 DOM、canvas、network 與 console 驗收。
- 不變更交易 runtime、Shioaji production／下單能力、外部資料來源授權或秘密管理方式。
