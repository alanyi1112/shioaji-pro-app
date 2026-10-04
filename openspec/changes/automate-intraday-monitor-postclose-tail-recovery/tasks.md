## 1. 來源與既有證據契約

- [x] 1.1 唯讀盤點 2026-09-16 與 2026-10-02 原始 capture、失敗收據及 13:35 基準 manifest，記錄 hash、來源交易日、cohort、雙抓、逐筆對帳、零量與收盤編碼可證明的欄位；保存原檔 SHA-256，不足欄位明列為 `source_unverified`。
- [x] 1.2 對照既有 Stage 160 最多 4 檔／每檔最多 5 個連續尾端分鐘的審閱契約，確認新工作只重用政策，不修改正式 live acceptance 或通知 Gate。

## 2. 尾端分類與自動工作

- [x] 2.1 在原始 capture 結束且 13:34:30 已過後，實作以交易日、cohort、simulation session 與 capture hash 識別的 append-only、冪等復原 claim；重複觸發只讀取既有結果。
- [x] 2.2 實作 `complete_live`、`bounded_tail_candidate`、`correlated_tail_failure`、`non_tail_or_ineligible` 與 `source_pending` 分類；開盤／中段缺口、身分或安全 Gate 不足時 fail closed，並保存逐檔原因。
- [x] 2.3 將工作接在正式收尾與既有 verified 基準 receipt 後，等待原有有界重試；不得新增 broker login、訂閱、整批歷史輪詢或共用服務重啟。

## 3. 盤後來源驗證與衍生結果

- [x] 3.1 實作對已發布同日基準的逐檔重驗：官方交易日、合約／市場、cohort、來源版本、雙抓一致性、270 個 canonical 分鐘、可信收盤總量與必要零量證據；缺欄、staging 或來源未發布時維持 pending／unknown。
- [x] 3.2 逐分鐘比對原始已接受 live 前綴累積量，只把確定缺失的連續尾端分鐘寫入獨立衍生 artifact，保存原始／來源 hash、驗證時間、來源狀態與 `liveDelivered=false`；合法 13:33 僅併入 canonical 13:30。
- [x] 3.3 讓少量合格缺口沿用既有雙抓、replay、資源與安全 Gate 產生受限 derived acceptance；整批相關尾端缺口僅產生 `postclose_data_recovered`，不升格原始 live NO-GO 或跨日驗收。
- [x] 3.4 對少量缺口必要的額外來源讀取設共享流量預算、期限與嘗試上限；衝突、預算耗盡或來源失敗時留下 append-only 原因，不覆寫原收據。

## 4. 查詢與畫面誠實性

- [x] 4.1 擴充盤中監控查詢，將原始 live 覆蓋、受限衍生驗收、盤後資料復原及下一日基準可用性投影為獨立欄位，舊資料缺欄時一律視為未驗證。
- [x] 4.2 在面板分別顯示盤中最後連續分鐘、盤後已核實尾端範圍與來源、原始收尾與正式 live 驗收狀態；盤後補值不得增加即時結果、追溯觸發或補發通知。

## 5. 回歸與真實驗收

- [x] 5.1 用 2026-09-16 單檔兩分鐘缺口、2026-10-02 全 160 檔缺 13:30、中段缺口與 complete-live 樣本驗證分類及資格分流；核對原始檔 SHA-256 不變。
- [x] 5.2 測試來源待發布、雙抓漂移、live 前綴衝突、零量證據不足、13:33 合併、重複觸發、共享預算耗盡及舊 client 缺欄，逐項確認 fail closed 與無追溯通知。
- [ ] 5.3 在下一適用交易日以既有 simulation session 的真實收尾與 verified 基準 receipt 驗證自動時序、API／UI provenance 及資源預算；離線測試與盤後復原不得冒充當日 live 或跨日實盤驗收。
- [x] 5.4 執行相關 focused tests、build、`openspec validate automate-intraday-monitor-postclose-tail-recovery --strict` 與 `git diff --check`，分列已通過、失敗、partial、unknown 及未完成的實盤項目。
