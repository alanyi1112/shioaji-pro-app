# 驗證紀錄

## 自動化驗證

- `src/lib/stock-screener-session-readiness.test.ts`：通過 14:00 台北時間邊界、週末／休市／跨年、20 分鐘 cooldown、`Retry-After`、18 次上限、雙市場 readiness 與候選日重置。
- `apps/multiview/tests/stock-screener-collector.test.mjs`、`stock-screener-operator.test.mjs`：通過 13:59 零當日日報請求、14:00 起允許探測、exact report date、schema、全市場涵蓋率、單市場完成保留 receipt 但不冒充 ready，以及另一市場完成後重用既有 receipt。
- `apps/multiview/tests/stock-screener-publisher.test.mjs`：2026-09-03 fixture 先發布 P=2026-09-01、D=2026-09-02，再於 TWSE／TPEx 9/3 receipt 均完整後原子推進為 P=2026-09-02、D=2026-09-03；快照股數由 200 股／700 股重算，未沿用 9/1。
- v2／v3／v4 route 測試：expected 晚於 immutable effective、單市場 pending 或 technical snapshot 落後時 rows 為空、cursor 不產生、逐市場 readiness 可稽核；GET 維持 DB-only。
- `src/components/stock-screener-panel.browser.test.ts`：16 項通過，涵蓋 ready／partial／pending／stale／offline、expected／effective 分開呈現、只等 TWSE、只等 TPEx、雙市場同時等待、歷史列與加入清單按鈕鎖定、鍵盤及窄高 viewport。

## 2026-09-03 本機 live evidence（Asia/Taipei）

- 16:18 的既有本機選股 pipeline 以本 change 的程式完成 publication probe：
  - `expectedSessionDate=2026-09-03`、`effectiveSessionDate=2026-09-03`、`phase=complete`、`attempts=1`。
  - TWSE：`reportDate=2026-09-03`、1,081 筆、invalid 0、SHA-256 `0f7c7f66edefd74f98d543010f6f5aacee677ca8f521bc77183507adf145babd`。
  - TPEx：`reportDate=2026-09-03`、886 筆、invalid 0、SHA-256 `9decc9f6825a535f8d65555b1078dc9e0edf97bdff95f5c574f4300981db33b4`。
  - v2 snapshot `1c5f99d9-1383-4308-9c09-0910b035c68b`：P=2026-09-02、D=2026-09-03。
- 16:22 執行選股專用本機 maintenance；未停止或重啟 simulation API、watchdog、5173、5174、盤後 pipeline 或行情連線：
  - v3 補 20 個既有缺期後發布 snapshot `7db0f2b7-d2ab-4340-a88f-937e215c813d`，P=9/2、D／technical through=9/3，processed 120/120、remaining 0、failed 0、overdue 0。
  - v4 只補新交易日的 2 個市場期別後發布 snapshot `7afc210e-f859-4075-88b5-0e94046a7b18`，P=9/2、D／technical through=9/3，processed 260/260、remaining 0、failed 0、overdue 0。
  - TDCC 六期 progress 維持 complete：processed 11,837/11,837、remaining 0、failed 0、overdue 0；本次未建立新 TDCC 長歷史工作。
  - D1 `PRAGMA integrity_check=ok`。
- 實際選股 DOM：
  - 顯示「成交量比較：2026-09-02 → 2026-09-03」與「有效資料日：2026-09-03」，沒有再以單一「有效交易日」混淆 expected／effective。
  - 成交量 3 倍條件全市場守恆：母體 1,974、符合 164、不符合 1,793、無法判定 17；上市代表 1337 與上櫃代表 1799 均顯示同一組 P／D。
  - 1337 原本不在「選股」清單，點擊結果後指定 K 線圖切換至 1337；未按「加入清單」，驗收後清單仍為 2 檔且不含 1337。
  - 1,280 × 600 CSS px viewport 下，選股面板可視高度 461 px、內部垂直捲動、`scrollWidth=clientWidth=249`；實際截圖目視正常，console error 0。
- 驗收後 runtime：simulation、business watchdog healthy、API listener up、business session available、2330 snapshot available、5173／5174 listener up、D1 integrity ok。

## 完整檢查

- `npm test`：175 個 test files、2,095 項測試通過。
- `npm run test:multiview`：718 項測試通過，含完整 MultiView build。
- `npm run lint:multiview`：通過，0 warning。
- `npm run build` 與 `npm run typecheck:multiview`：通過。
- `npx vitest run --config vitest.browser.config.ts src/components/stock-screener-panel.browser.test.ts`：16 項通過。
- `openspec validate --all --strict`：36 個 spec／change 全數通過。
- `git diff --check`：通過，沒有 whitespace error。

本 change 僅處理本機盤後選股 session rollover；未部署或改動 Sites／Cloudflare，未觸發交易寫入。
