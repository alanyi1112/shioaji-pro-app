## 1. 固定基線與品質閘門邊界

- [x] 1.1 重跑 `npm run lint`，確認基線仍為 84 個 `no-explicit-any`、1 個 `prefer-const` 與 19 個 `no-unused-vars`，並核對沒有使用者尚未提交且會與本變更重疊的程式修改。
- [x] 1.2 盤點 `eslint.config.mjs` 與 `package.json` 的掃描範圍，確認 `worker/**/*.ts`、`public/static/**/*.js`、`tests/**/*.mjs` 仍受檢查，且不新增規則停用或廣泛 ignore。

## 2. 清理未使用程式碼與機械式錯誤

- [x] 2.1 逐一核對 `public/static/app.js` 中舊 identity／watchlist helpers、圖表狀態、destructuring 與 callback 參數的呼叫鏈，刪除已被 Sites／D1 流程取代的程式或縮小仍有效的參數與狀態。
- [x] 2.2 清理 `public/static/chip-panes.js`、`tests/taiwan-stock-chip.test.mjs` 與 `worker/tdcc-continuous-backfill.ts` 的未使用變數，同時保留 pane 與測試原有語意。
- [x] 2.3 修正 `worker/app.ts` 的 `prefer-const`，對本節涉及檔案執行針對性 ESLint 與 rendered HTML／chip pane tests，確認 warnings 清為 0 且可見行為未改變。

## 3. 收斂獨立 Worker 模組型別

- [x] 3.1 為 `worker/market-data.ts` 的市場資料 payload、candle／indicator 轉換與 provider 回應建立最小型別或驗證邊界，清除該檔 5 個 `no-explicit-any`。
- [x] 3.2 為 `worker/taiwan-stock-chip-service.ts` 的 D1 cache rows、dataset 狀態與動態資料建立具名型別，清除該檔 6 個 `no-explicit-any`，並通過台股籌碼 service tests。
- [x] 3.3 為 `worker/tdcc-history-backfill.ts` 的 job／week query projections 建立最小 row types，清除該檔 3 個 `no-explicit-any`，並通過 history backfill tests。
- [x] 3.4 為 `worker/tdcc-continuous-backfill.ts` 的 target、lease、run 與 health query projections 建立明確型別，清除該檔 12 個 `no-explicit-any`，並通過 continuous contract／behavior tests。
- [x] 3.5 為 `worker/watchlist-chip-prewarming.ts` 的 target 與 warm state rows 建立明確型別，清除該檔 4 個 `no-explicit-any`，並通過 watchlist prewarming tests。

## 4. 收斂 Worker 整合入口型別

- [x] 4.1 在 `worker/app.ts` 以最小 runtime interfaces 表達 Worker bindings、execution context、asset／image binding，移除無條件 `any`。
- [x] 4.2 為 `worker/app.ts` 的 instrument catalog、使用者清單、D1 query projections 與 health 聚合建立對應型別，保持 SQL、D1 schema 與回傳欄位不變。
- [x] 4.3 將 `worker/app.ts` 的 HTTP request body 與外部／內部動態 payload 改為 `unknown` 加 parser／type guard，保持既有錯誤碼、HTTP status 與 API schema 不變。
- [x] 4.4 清除 `worker/app.ts` 剩餘 54 個 `no-explicit-any`，執行 app、API、stream、reorder、catalog、TDCC 與 rendered HTML 相關測試，確認整合入口沒有行為回歸。

## 5. 持續閘門與完整驗收

- [x] 5.1 將 `npm run lint` 設為 `--max-warnings=0`，執行完整 lint 並確認 0 errors、0 warnings、exit code 0。
- [x] 5.2 執行 `npm test`，確認 build、Workers runtime 與所有自動測試通過，且沒有新增 D1 migration、runtime secret 或 API schema 差異。
- [x] 5.3 執行 `openspec validate --all --strict`、`git diff --check` 與專案既有秘密掃描，修正所有失敗且不提交任何機密資料。
- [x] 5.4 若前端 warnings 清理改動清單、圖表或籌碼副圖呼叫鏈，執行最小 browser smoke，確認相關可見行為、互動與 console 沒有新增錯誤；若未影響呼叫鏈，記錄可核對的 source／test 證據。
- [x] 5.5 依 Sites private deployment 流程發布已驗證版本，確認 deployment succeeded、正式 `/api/health` 正常，並抽查清單、圖表與台股籌碼副圖沒有回歸。
