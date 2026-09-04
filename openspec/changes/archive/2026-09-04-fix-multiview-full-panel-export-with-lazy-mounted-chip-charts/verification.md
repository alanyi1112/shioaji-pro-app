# 驗證紀錄

## 結論

已修正 MultiView 在多層副圖模式從 panel 頂端或底部執行「儲存圖片」時，離屏籌碼副圖只留下標題與讀值、實際 Canvas 線圖未進入 PNG 的問題。

修正後會在正式呼叫 `html2canvas` 前，對單一目標 panel 建立有界的 export lease：暫時掛載所有已選且適用的籌碼副圖、同步主圖 viewport／共用游標日期／右側軸安全寬度、等待有效 Canvas 與 series readiness，再開始擷取。成功、失敗、取消、context 變更或 panel destroy 都會釋放 lease；匯出前未掛載的副圖會恢復卸載，其他 panel 不受影響。

## 根因證據

- 籌碼副圖平時由 `IntersectionObserver` 採 viewport-near lazy mount，離屏時會執行 `chart.remove()` 並清空 chart surface。
- 舊匯出流程直接對完整長 panel 呼叫 `html2canvas`，沒有在擷取前重新掛載離屏副圖。
- 2026-09-04 實機基線（`00918.TW`、日 K、單圖、多層副圖、頁面頂端）：11 個已選籌碼副圖中，只有 `foreign-flow-holding`、`investment-trust-flow`、`dealer-flow` 各有 7 個有效 Canvas，其餘 8 個 pane 的 Canvas 數量均為 0。這與使用者提供的「標題仍在、線圖消失」PNG 一致。

## 自動化驗證

- `node --test apps/multiview/tests/chip-pane-export-lease.test.mjs apps/multiview/tests/panel-image-export.test.mjs apps/multiview/tests/subchart-interaction.test.mjs apps/multiview/tests/rendered-html.test.mjs`
  - 119 passed，0 failed。
- `npm run test:multiview`
  - build 成功；722 passed，0 failed。
- `npm test`
  - 沙箱內第一次因 Unix socket 與 loopback `listen EPERM` 產生 149 個環境性失敗。
  - 經核准在沙箱外以相同指令重跑：175 test files passed；2095 passed，0 failed。
- `npm run lint:multiview`
  - 成功，0 warnings。
- `npm run typecheck:multiview`
  - 成功。
- `openspec validate --all --strict`
  - 36 passed，0 failed。
- `git diff --check`
  - 成功，沒有 whitespace error。

## 瀏覽器與 PNG 驗收

驗收使用既有 `127.0.0.1:5174` runtime，未重啟或停止任何服務。代表商品採規格允許的等價台股 `00918.TW`，具有法人、融資券與持股資料。

### 頂端觸發

- 在 panel 頂端按右鍵執行「儲存圖片」。
- 最終程式重新載入後產出：`/Users/alanyi/Downloads/00918.TW_1d_2026-09-04T02-52-06-898Z.png`。
- PNG 尺寸：2498 × 3706。
- 解碼並逐 pane 目視核對：法人 4 個、融資券 5 個、持股比 2 個副圖均保留可見線／柱、右側軸、共用日期線與讀值；沒有只剩標題的空白 plot。
- 匯出前與匯出後 Canvas 集合相同：最上方 3 個 pane 各 7 個 Canvas，原本離屏的其餘 8 個 pane 均回到 0。

### 底部觸發

- 從 `retail-holder` 底部副圖按右鍵執行「儲存圖片」。
- 產出：`/Users/alanyi/Downloads/00918.TW_1d_2026-09-04T02-45-32-134Z.png`，2498 × 3738。
- 解碼後 11 個副圖都有線／柱；匯出前後每個 pane 的 Canvas 計數完全一致，頁面捲動位置維持 1228.5。

### 多商品隔離

- 在 2 圖、多層副圖版型匯出第一個 `00918.TW` panel。
- 產出：`/Users/alanyi/Downloads/00918.TW_1d_2026-09-04T02-46-20-802Z.png`，1258 × 3908；PNG 只含 `00918.TW`，未包含第二個 `00919.TW` panel。
- 第二個 panel 匯出前後總 Canvas 均為 35，逐 pane Canvas 計數不變；第一個 panel 匯出後也精確回復原計數。

### 錯誤與操作狀態

- 瀏覽器 console：0 application error、0 warning。
- 頂端、底部與多商品三次匯出均顯示成功檔名，沒有不完整下載。
- 驗收後已把使用者版面還原為原本的「8 圖／單一副圖」。

## 發布邊界

本次只完成本機實作與驗證；未 commit、未 push、未部署，也未變更既有 runtime 服務狀態。
