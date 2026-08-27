## 1. 建立可重現的非退化契約

- [x] 1.1 在 `src/web/multiview/chip-panes.browser.test.js`（或相鄰測試檔）加入固定情境：先載入完整籌碼快取，再收到 HTTP 200 但空白、較舊或覆蓋較差的回應，驗證既有有效 series 不會被清除。
- [x] 1.2 為 `institutional-flow`、`foreign-holding`、`margin-short`、`securities-lending`、`shareholder-distribution` 五類 dataset 加入品質摘要與合併契約測試，涵蓋同日合法修正、混合強弱 payload、日期範圍裁切，以及不同股票與週期不得互相污染。
- [x] 1.3 在 Worker 測試加入 D1-first 情境，驗證上游空回應、錯誤或部分 dataset 更新時，既有資料列、覆蓋資訊及其他 dataset 欄位仍會保留。

## 2. 實作前端逐 dataset 非退化保護

- [x] 2.1 在 `src/web/multiview/chip-panes.js` 抽出 dataset slice、品質摘要、日期範圍投影與逐日期合併 helper，保留來源、實際資料日期及可用性資訊。
- [x] 2.2 建立以 `symbol + interval + dataset` 隔離的有界 verified-slice store，加入 LRU／TTL、清除介面與可觀測計數，避免長時間使用造成無界成長。
- [x] 2.3 將 raw response 的處理順序改為先驗證、投影及 reconcile，再寫入 request cache；前景載入、背景 revalidation、相鄰頁預載及共用 in-flight 都必須取得同一份已 reconcile 結果。
- [x] 2.4 將 pane manager 的一般載入、強制刷新與手動回補接到非退化提交流程，以單次原子提交更新 payload、series 與 readout，避免中途狀態清空既有副圖。
- [x] 2.5 在保留舊資料時顯示 stale／retained 狀態及實際資料日期；游標落在尚未發布資料的日期時仍須顯示「當日無資料」，不得以前值補齊或製造零值。

## 3. 強化 Worker 的 D1-first 資料保護

- [x] 3.1 在 `src/worker/taiwan-stock-chip-service.ts` 逐 dataset 合併 D1 與上游結果；上游空白、失敗或覆蓋退化時不得刪除 D1 既有資料列與 coverage。
- [x] 3.2 保留實際 availability、provenance、warning 與資料日期，同時允許通過品質驗證的同日合法修正覆寫舊值，不得合成或 forward-fill 不存在的資料。

## 4. 檢查其他副圖與生命週期邊界

- [x] 4.1 以五類籌碼 dataset 的混合 payload、開盤期間 candle range 延伸及背景 revalidation，逐一驗證所有已選取籌碼副圖不會先出現後消失。
- [x] 4.2 以相同刷新、切頁與 range 變動壓力測試 KD、RSI、MACD、ATR 等技術副圖；只有重現獨立缺陷時才新增對應修正與回歸測試。
- [x] 4.3 驗證股票、週期、分頁、模式切換及手動回補不會沿用其他 identity 的 verified slice，且 queue、in-flight 與 controller 在成功、逾時及取消後都能釋放。

## 5. 驗證與交付

- [x] 5.1 更新 MultiView 靜態資產 cache-buster，並補上輸出 HTML 引用新版本資產的測試斷言。
- [x] 5.2 執行聚焦測試、完整 `npm test`、lint、build、migration 檢查、`git diff --check` 與 OpenSpec strict validation，記錄實際結果。
- [x] 5.3 在可用的本機環境進行四圖多層副圖瀏覽器驗收，至少涵蓋一檔股票與一檔 ETF，等待超過背景 revalidation 週期，核對各 pane DOM／canvas、資料日期、network 與 console；不得為驗收自動啟動或重啟交易 runtime。
- [x] 5.4 將可重現測試、實作與瀏覽器驗收證據同步到 change；只有 deterministic 測試與當時可執行的 live acceptance 都通過後，才將對應任務標示完成。

## 6. 精準差異 review 修正

- [x] 6.1 在 reconcile 前驗證 top-level payload、日資料 row 與 TDCC row 的 symbol／interval identity；不一致資料不得寫入 request cache 或 verified-slice store。
- [x] 6.2 同日候選必須比較逐 dataset 欄位完整度；稀疏候選不得整包覆寫較完整舊值，完整且合法的同日修正仍可更新。
- [x] 6.3 TDCC 候選必須驗證 1 至 15 級、調整列、合計及彼此對帳；測試 fixture 不得再以部分級距冒充完整資料。
- [x] 6.4 對外 rows、coverage 與 sources 必須投影到目前 request range，retained 資料須保留原來源並另列本次來源狀態，不得把範圍外日期或候選 provider 冒充顯示資料 metadata。
- [x] 6.5 Worker 不得只用 D1 row count 與本次 upstream row count 判定 stale；必須依本次來源結果、實際最新日期及 D1 保留情境產生 truthful availability／warning。
- [x] 6.6 補齊上述五項 deterministic 回歸測試，重跑 lint、build、完整測試、migration、`git diff --check` 與 OpenSpec strict validation。
- [x] 6.7 重新執行所有受支援的 1／2／3／4 圖多層副圖、股票與 ETF 長時間瀏覽器驗收，逐 pane 核對籌碼與技術副圖的 DOM／canvas／日期／背景更新／network／console；另驗證 6／8 圖仍安全限制為單一副圖，並更新 `verification.md`。

## 7. 持股副圖縱軸與新價位穩定性

- [x] 7.1 建立可重現證據與回歸契約：大戶／散戶右側價格軸手動縮放可把主要持股比 series 移出畫面；Shioaji 台北午夜 timestamp 會被 UTC 截日錯映；同日期新價位仍須通知 controller，但不得 fetch 或重建籌碼 series。
- [x] 7.2 對持股 pane 停用 price-axis pressed-move、保留時間軸手勢，並在 render、mount 與每次 candle 通知時恢復持股相關 price scale autoscale；相同日期範圍只做輕量修復，Yahoo／Shioaji candle 均以 `Asia/Taipei` 日期對齊 TDCC。
- [x] 7.3 執行聚焦與完整測試、lint、build、migration、strict validation；在所有支援的 1／2／3／4 圖版型實際拖曳大戶／散戶縱軸並等待行情／等價更新，確認線圖、讀值、canvas 與 console 均穩定，更新 `verification.md`。
