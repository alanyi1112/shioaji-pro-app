## 1. 回補狀態與 API 測試

- [x] 1.1 新增前端純函式測試，涵蓋日資料缺口、TDCC 單一期／未完成、完整資料、blocked 與 retry-waiting 對右鍵 menuitem 的顯示及 disabled 狀態。
- [x] 1.2 新增 Worker API 測試，涵蓋登入、eligibility、dataset／日期 allowlist、完整 coverage no-op、retry-after、`waitUntil` 日資料背景工作及安全 response。
- [x] 1.3 新增 TDCC 單一 symbol queue helper 測試，確認 completed 歷史不足可排入、queued／running 冪等、blocked 不解鎖、其他 symbols 與 lease 不被改寫。

## 2. 安全回補實作

- [x] 2.1 在 `worker/tdcc-continuous-backfill.ts` 實作單一 active symbol 的 user-request queue helper，保留 blocked／running、清除允許重試狀態並回傳逐 symbol 結果。
- [x] 2.2 在 Worker 新增 `POST /api/taiwan-stock-chip/backfill`，驗證 authenticated user、本機測試、symbol、eligibility、datasets、日期範圍、coverage、cooldown 與 retry-after。
- [x] 2.3 將缺少日 datasets 交由 `context.waitUntil` 的既有 prewarm／single-flight，將 shareholder-distribution 只交由 TDCC durable queue，保持 response 快速且無 secrets。

## 3. 副圖換行與右鍵互動

- [x] 3.1 更新籌碼 header／inline readout CSS，使所有 segments 依原順序完整換行、pane 自然增高、chart 至少 64px，且不產生裁切、ellipsis 或水平捲動。
- [x] 3.2 在既有 context menu 加入依 payload 顯示的「立即回補缺少資料」menuitem，操作中鎖定並顯示 accepted／queued／cooldown／blocked 等結果，不新增任何常駐按鈕。
- [x] 3.3 實作單一 symbol request cache invalidation、有限延遲 reload、generation 隔離與 pane destroy 清理，保留 series 選擇、移除副圖、右側數值軸與鍵盤操作。
- [x] 3.4 更新靜態資產版本與前端 contract／layout tests，確認三欄長 readout 可見、功能表 lifecycle 及完整資料不出現回補項目。

## 4. 驗證與發布

- [x] 4.1 執行 focused tests、完整 `npm test`、lint、build、JavaScript 適用檢查、`git diff --check` 與 `npx openspec validate --all --strict`。
- [x] 4.2 使用瀏覽器在本機三欄版面驗證黃色框類型的完整 readout 換行，並驗證缺資料 pane 的右鍵回補、完整 pane 無回補及操作後狀態。
- [x] 4.3 提交並推送 exact validated source，發布 owner-only Sites version，正式站重做換行、右鍵回補、API／TDCC queue／日資料 background 與無回歸驗收，記錄證據。

## 5. 正式站短歷史誤判修正

- [x] 5.1 新增 TDCC `2/2 completed` 仍未達一年歷史的前端與 Worker 回歸測試。
- [x] 5.2 將 TDCC 完整門檻統一為至少 51 週，並讓 holder 右鍵功能表顯示「回補歷史資料」。
- [x] 5.3 執行完整驗證、發布新版，並在正式站確認 `2324.TW` 可從右鍵功能表排入一年歷史回補。

## 6. 讀值名稱與數值分離套色

- [x] 6.1 新增 series 色票對應與名稱／數值分離 DOM、CSS 的回歸測試。
- [x] 6.2 將可設定線圖的 readout segment 綁定 `seriesId`，名稱沿用右鍵色票，數值與箭頭獨立依方向套色。
- [x] 6.3 執行完整驗證、發布新版，並在正式站比對融資／融券名稱色與右鍵線圖項目色一致。
