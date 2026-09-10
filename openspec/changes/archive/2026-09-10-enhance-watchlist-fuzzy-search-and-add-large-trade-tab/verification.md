## 實作結果

本 change 已完成自選清單台股股名模糊搜尋與成交明細「大單」頁籤。實作未新增 broker write、交易指令、行情登入或額外的頁籤 subscription；測試與人工驗證均維持 simulation-only。

### 自選清單搜尋

- 共用 client 封裝 MultiView `/api/instrument-search`、硬 timeout、AbortController、schema 驗證與錯誤傳遞。
- 以 Unicode NFKC、臺／台、大小寫、空白與常見分隔符號正規化，並依代號、股名、bigram Dice 與 edit similarity 決定性排序。
- MultiView 與本機候選以 `securityType + exchange + code` 合併；MultiView 離線時保留本機候選及純代號加入能力。
- UI 分開呈現載入中、來源降級、全來源錯誤、無結果及 contract 驗證失敗。
- 支援滑鼠、`ArrowUp`、`ArrowDown`、`Enter`、`Escape`；多筆模糊股名不得直接提交，候選加入仍由既有 `onAdd` 路徑進行 canonical contract 驗證。
- 盤中監控原匯入介面保留 wrapper，相容既有呼叫端。

### 成交明細大單

- 「全部」與「大單 N」共用成交列 renderer；一般面板與 `?popout=tape` 均使用同一 `TickTape` 元件。
- 合格範圍為台灣上市／上櫃 `STK`、正價格、正張數、非零股、非 simtrade，且時間嚴格位於 `09:00:00` 與 `13:25:00` 之間。
- 單筆成交金額為 `price × common_lot × 1,000`；門檻為 40 萬元、5 張價值與最近 120 筆前置合格成交 P70 三者取高，動態門檻需 30 筆暖機。
- 候選成交先分類後才加入樣本；保存 `thresholdAtDetection`、`ruleVersion`、來源與穩定成交鍵，不回溯重算。
- history 先依時間回放，live 在 history 載入期間先緩衝；history/live 重疊去重，商品、交易日及 generation 隔離。
- 全部成交保留 120 筆、動態樣本保留 120 筆、大單保留 500 筆。
- UI 僅使用「大單」，不顯示使用者指定移除的句子。

## 自動驗證

- Targeted unit：`pnpm exec vitest run src/lib/tick-tape-large-trade.test.ts src/lib/taiwan-instrument-search.test.ts src/lib/intraday-monitor-instrument-search.test.ts`，3 files／22 tests 通過。
- Full unit：`pnpm test`，215 files／2348 tests 通過。
- Targeted browser：`pnpm exec vitest run --config vitest.browser.config.ts src/components/watchlist-tick-tape.browser.test.ts`，1 file／7 tests 通過。
- Full browser：`pnpm test:browser`，11 files／111 tests 通過。
- Build：`pnpm build` 通過 TypeScript 與 Vite production build；僅有既有的 chunk size warning。
- OpenSpec：`openspec validate enhance-watchlist-fuzzy-search-and-add-large-trade-tab --strict` 通過。
- Diff：`git diff --check` 通過。工作樹原先另有其他 change 的既有變更，本 change 未清理或納入其範圍。

## Simulation-only 實際 UI 驗證

- Runtime 狀態：`runtime_mode=simulation`、`production_readonly_job=stopped`、`smart_order_write_master=disabled`；API、business session、2330 snapshot、5173 與 5174 均正常。
- 在 5173 自選清單輸入「聯光」，實際候選包含 `3441 聯一光`，並可用鍵盤明確選取。
- 在主版面 `2449 京元電子` 的成交明細看到「大單 5」；切換後顯示「大單條件：單筆成交金額 ≥ 135 萬元」及三者取高摘要。
- 直接開啟 `/?popout=tape&code=2449`，獨立成交明細同樣顯示「大單 5」、相同門檻、相同摘要與 5 筆成交列。
- 主面板與 popout 驗證前後 `/api/v1/stream/status` 的 `active_connections` 均為 5；切換「全部／大單」沒有新增 listener、第二次登入或交易寫入。

## 已知限制

- 現有 tick payload 不含可用的 `SeqNo`／`TickGroup`，第一版無法把同一委託形成的多筆連續成交合併為委託群組；分類單位是來源提供的成交列。
- 大單資料只存在目前元件生命週期，不宣稱為永久保存或完整交易日統計。
- 尚未 archive、commit 或 push；須由使用者另行明確授權。
