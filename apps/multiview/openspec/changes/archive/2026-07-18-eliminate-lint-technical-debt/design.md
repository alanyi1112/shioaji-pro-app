## Context

專案目前使用 `eslint-config-next/core-web-vitals` 與 `eslint-config-next/typescript`，並由 `npm run lint` 掃描前端、Worker、測試與建置輔助程式。2026-07-18 的基線為 104 個問題：84 個 `@typescript-eslint/no-explicit-any` errors、1 個 `prefer-const` error，以及 19 個 `@typescript-eslint/no-unused-vars` warnings。

型別錯誤集中在 Workers 邊界：`worker/app.ts` 有 55 個 errors，其餘分布於市場資料 adapter、台股籌碼服務、TDCC continuous/history backfill 與清單預熱。這些位置同時接收 D1 查詢列、外部 JSON、HTTP request body、Cloudflare binding 與動態資料，因此不能只以機械式替換 `any` 處理。warnings 則主要位於 `public/static/app.js` 的舊登入／清單 helper、圖表狀態變數與未使用參數。

本變更不改變產品功能、API schema、資料來源、D1 schema、排程或部署架構；實作者必須把型別收斂與失效程式碼清理視為行為保持型重構。

## Goals / Non-Goals

**Goals:**

- 讓全專案在現行 ESLint 規則下達到 0 errors、0 warnings。
- 讓 `npm run lint` 在日後出現任何 warning 時也回傳失敗，成為可依賴的品質閘門。
- 為 D1 rows、外部 provider payload、request body、Worker bindings 與回補狀態建立可核對的型別邊界。
- 移除確定失效的程式碼，或把仍有用途但未接線的邏輯正確整合，避免單純隱藏 warnings。
- 維持既有測試、Workers runtime、正式 API 與可見 UI 行為。

**Non-Goals:**

- 不新增功能、不重做 UI，也不改變行情、籌碼或清單的產品規則。
- 不修改 D1 migration、正式資料、runtime secrets、GitHub Actions 排程或 Sites access policy。
- 不藉此全面重寫 `public/static/app.js`、導入新的狀態管理框架或更換 lint 工具鏈。
- 不處理 `npm audit`、套件升級或與 ESLint 無關的效能最佳化。

## Decisions

### 1. 保留現行規則並將 warning 納入失敗條件

維持目前 Next.js／TypeScript 規則組與掃描範圍，將 lint script 加上 `--max-warnings=0`。這能確保本次清零後不會重新累積 warning。

替代方案是關閉 `no-explicit-any`、降低規則嚴重度或排除問題檔案；這只會隱藏風險，無法形成品質閘門，因此不採用。

### 2. 依資料邊界選擇型別策略

- D1 `.first()`／`.all()` 結果使用對應資料表或查詢 projection 的 row interface，不建立一個涵蓋所有欄位的萬用型別。
- 外部 JSON 與 request body 先以 `unknown` 接收，再透過小型 type guard、正規化函式或既有 parser 驗證後轉為 domain type。
- Cloudflare binding、ExecutionContext、Fetcher 與圖片 binding 使用 runtime 可表達的最小介面；沒有被程式讀取的 binding 不以 `any` 保留。
- 只有在既有驗證已證明結構時才允許局部型別斷言，並把斷言限制在邊界函式內；禁止散布 `as any`、雙重斷言或非空斷言來規避檢查。
- 共用程度高且語意穩定的型別放在對應 domain module；只服務單一查詢的 projection type 留在使用檔案附近，避免新增龐大的共用型別檔。

替代方案是把所有 `any` 改成 `unknown` 後在使用點反覆斷言；這會把風險往下游移動並增加噪音，因此不採用。

### 3. 未使用程式碼依用途分類處理

- 確認已被新版 Sites identity、D1 清單或新版 pane lifecycle 取代的 helper 與狀態直接刪除。
- 僅因 destructuring 或 callback signature 產生的未使用值，改為省略欄位、縮小參數或調整 callback，而非以無效讀取製造「已使用」。
- 若某段邏輯仍是產品需求但漏接，必須先以既有測試與呼叫鏈證明，再恢復正確接線；不得只為消除 warning 擴張功能。
- 測試 fixture 的未使用解構欄位改為保留必要欄位，不降低測試覆蓋意圖。

替代方案是統一加 `_` 前綴或 `void variable`；這仍保留不明確技術債，因此僅在外部介面強制 callback 參數位置時才可局部使用。

### 4. 以模組批次完成並持續驗證

實作順序採低風險到高風險：先修正 `prefer-const` 與 warnings，再處理獨立 Worker modules，最後處理 `worker/app.ts` 的跨模組邊界。每批完成後先跑針對性 lint／tests，全部完成後再跑完整 `npm run lint`、`npm test` 與 OpenSpec strict validation。

由於變更會觸及行情、籌碼、回補與 UI 靜態程式，最終還需要執行既有 API／rendered HTML 測試；若修改到瀏覽器呼叫鏈，補做本機或已登入正式站的最小 smoke，確認清單、圖表與籌碼副圖沒有可見回歸。

## Risks / Trade-offs

- [D1 projection 型別與實際欄位不一致] → 以每個 SQL projection 建立最小 row type，並由既有 D1 fake／contract tests 驗證欄位使用。
- [外部 provider payload 被過度假設] → 在解析邊界使用 `unknown`、欄位檢查與安全預設，不把未驗證 JSON 直接視為 domain type。
- [刪除未使用 helper 造成隱性 UI 回歸] → 先以 `rg` 核對呼叫鏈、對照現行 identity／state flow，再執行 rendered HTML 與必要 browser smoke。
- [一次修改過多導致回歸難定位] → 依模組分批，要求每批 lint 與相關 tests 通過後才進下一批。
- [只達成當下清零，warning 日後再累積] → 由 `--max-warnings=0` 將 warning 轉為持續失敗條件。

## Migration Plan

1. 記錄當次 lint 基線與各檔案問題數，確認沒有新的無關變更。
2. 清理 warnings 與 `prefer-const`，執行前端／rendered HTML 相關測試。
3. 依 domain module 收斂 Worker 型別，最後處理 `worker/app.ts` 的整合邊界。
4. 將 lint script 設為 warning 零容忍，執行完整驗證梯子。
5. 若驗證失敗，回復造成回歸的單一模組批次；本變更沒有資料 migration 或正式資料回滾需求。

## Open Questions

- 無。若實作期間發現某個未使用 helper 仍代表未完成產品需求，應停止該項刪除並另建產品 change，不在本次 lint 清理中擴張範圍。
