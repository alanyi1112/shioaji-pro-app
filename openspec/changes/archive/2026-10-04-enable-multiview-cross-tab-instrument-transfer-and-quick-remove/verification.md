# 實作與驗證紀錄

## 已完成

- 唯讀檢查既有 `user_instruments` 的 `(user_id, symbol, tab_id)`、系統頁籤 `tab_id=''`、`user_tabs` 的 `source_tab_id`、有效頁籤合併及卡片 canonical／顯示商品分離規則；在隔離 SQLite D1 fixture 重現四類來源／目的頁籤。
- 新增 per-system-tab 成員覆寫及相容遷移。遷移只複製可依預設標籤或唯一系統頁籤覆寫判定歸屬的舊列，保留原列；無法判定者保留並由 API `tabDiagnostics` 回報。
- transfer、quick-remove 與既有清單新增、排序、刪除共用有效頁籤成員解析。跨頁籤移動／複製以單一 D1 batch 寫入；每位使用者的 revision guard 使競爭寫入回滾並回報衝突。
- 卡片標題手把可拖到其他啟用頁籤，放開時按 Option 複製；右鍵與 `⋯` 提供相同操作，移除須確認。顯示商品不是 canonical 清單成員時不發送異動。成功後不自動換頁籤，空頁籤顯示空狀態。
- 完整應用隔離瀏覽器測試發現 `⋯` 按鈕的點擊區原本被報價數字覆蓋，實際滑鼠事件落在 `.price-value`。已提高按鈕點擊層級，並加入真實滑鼠命中及點擊回歸檢查。

## 隔離測試結果

- `apps/multiview`：`npm run build`、`npx tsc --noEmit`、針對本 change 修改檔的 ESLint 均通過。
- `node --test tests/watchlist-direct-manipulation.test.mjs tests/watchlist-direct-interaction.test.mjs tests/watchlist-direct-browser.test.mjs tests/watchlist-direct-app-browser.test.mjs tests/personal-tab-management.test.mjs tests/rendered-html.test.mjs`：90 項通過；涵蓋四類頁籤組合、複製目的重複、備註保存、不同使用者、停用／過期頁籤、失敗注入、並行競爭、舊列遷移、單圖拖曳候選、放開時 Option、無效落點及 canonical 不一致無網路寫入。
- 新增完整應用的隔離 headless Chrome 測試，所有網路請求限制在 `fixture.invalid`，使用獨立 SQLite D1；實際以滑鼠 Option 拖放複製、刷新後確認目的第一檔、點 `⋯` 並確認移除、刷新後確認空狀態，再由來源拖放移動並確認下一檔卡片遞補及刷新後目的第一檔。複製時來源線圖 DOM 未重建；沒有連到既有 5173／5174 或交易服務。
- `npx openspec validate enable-multiview-cross-tab-instrument-transfer-and-quick-remove --strict` 通過；本 change 的 `git diff --check` 通過。
- 全專案 `npm run lint` 尚未通過：兩個與本 change 無關的既有警告，分別在 `tests/stock-screener-v4-publisher-route.test.mjs:133` 與 `worker/stock-screener-v6-route.ts:148`。沒有改動這兩處。

## 尚未驗收

- 完整應用測試已核對卡片遞補與空狀態；但行情 API 在隔離瀏覽器內回傳 503，尚未量測真實 K 線 viewport 與行情訂閱數，故 4.3 保留未完成。沒有對使用者現有清單、RealTimeStock 清單、行情連線或交易狀態做寫入測試。
- 未部署或執行正式 D1 遷移；未 archive、commit 或 push。


## 2026-10-04 隔離功能重驗

由 `72a8a0b` 的新 git archive 副本以標準 `npm run build`（含圖表 vendor prebuild）建置；7 個清單／viewport／hub 測試檔 49／49 通過、0 skipped。初次漏 prebuild 出現 LightweightCharts 未定義，修正執行方式後重跑通過，未改產品程式。實際 D1 已有系統頁籤成員與 revision 表，不能以 health 的 0033 欄位推論 migration 未安裝。

4.3 保持未完成：隔離行情 API 仍為 fixture／503，未取得有真實行情的隔離清單操作及其他線圖 viewport、訂閱與交易狀態前後證據；未修改使用者既有清單或套用正式 migration。當時本機跨 change 報告為 `docs/acceptance/2026-10-04-wip-functional-acceptance.md`；該混合範圍報告不納入本次提交。

## 2026-10-04 休市修正與已載入圖表驗證

完整應用 fixture 現已提供明示測試 K 線，單圖／雙圖回歸確認複製後卡片／canvas／viewport 不變、移動遞補、刷新及空狀態。測試找到卡片數減少時舊 fallback 會刪尾端未受影響卡片、再重載第一張的問題；已依 canonical identity 保留既有卡片，只銷毀離開目前可見清單者。移動保留未受影響 canvas 與縮放。

標準隔離 build、七檔 37 項回歸（0 skipped）、型別與修改檔 ESLint 通過。37 項含 API 原子／CAS、單圖與雙圖完整 browser；沒有外部行情請求。真實服務 PID／設定 revision 未改，watchdog restart count 0。

4.3 的休市可驗部分已補齊，真實行情 viewport／訂閱／交易狀態前後驗收仍未知，故保持 17／18，不勾選、不歸檔。當時本機跨 change 報告為 `docs/acceptance/2026-10-04-offday-active-change-implementation.md`；該混合範圍報告不納入本次提交。

## 2026-10-04 17:38 真實盤後行情隔離清單完成驗收

上述歷史未知保留，本輪以既有 2449／2330 真實日 K 快取（160 根、來源日 10/2）補足 loaded chart 證據；清單 mutation 只在獨立 SQLite，真實服務清單與行情／委託狀態唯讀核對前後不變。單圖／雙圖 2／2、八檔完整回歸 108／108、額外 coordinator／rendered HTML 90／90、標準 build、型別、修改檔 ESLint、strict validation、diff check 通過。行情來源既有 volume mismatch 與隔離批次 503 原狀保留，不冒稱盤中 SSE 通過。

task 4.3 已完成，**18／18，具備本 change 結案條件**；沒有歸檔、commit 或 push。完整界線、逐筆請求、清單 hash、63→63 既有連線、35→35 訂閱與 Orders [0/0] 前後證據見 [本輪驗收](acceptance/isolated-real-market-data-2026-10-04.md)。

## 2026-10-04 主規格同步與歸檔

依使用者明確授權，先新增[正式主規格](../../../specs/multiview-watchlist-direct-manipulation/spec.md)，保留全部 5 項 requirements 與 19 個 scenarios，再歸檔至 `2026-10-04-enable-multiview-cross-tab-instrument-transfer-and-quick-remove`。上列未歸檔／未提交敘述為當時驗收狀態，原始失敗與限制保留。此次提交範圍限本 change 的主規格、歸檔、圖表保留修正、相關測試及驗收證據；其他 dirty work、原始行情資料與本機資料庫不納入，不 push、不部署、不啟停服務。
