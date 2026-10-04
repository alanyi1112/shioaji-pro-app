## 1. 現況與資料契約

- [x] 1.1 盤點設定、Stage-160 GO、盤前收據、基準 manifest、runtime 訂閱與 workspace API 的現行 schema，列出與跨日 rollover change 的共用欄位和相容限制。
- [x] 1.2 以現存 rev8 備份與 rev9 設定做唯讀差異核對，保存 149 共同、11 缺少與其他新增商品等可證實事實；不得推定操作者或改動原始備份與失敗收據。
- [x] 1.3 依實測 provider 用量與單日剩餘預算，訂出盤前差異驗證的有界查詢／時間／流量 Gate；明確記錄未知 physical headroom。

## 2. 每日名單與基準

- [x] 2.1 實作最多 200 設定商品的 eligibility、穩定優先順序與不超過 160 的 daily cohort plan，原子保存目標交易日、設定 revision/hash、候補原因和 plan hash。
- [x] 2.2 實作以交易日與 canonical symbol 鍵值查找及逐檔驗證 baseline，保留既有 minute coverage、單位、收盤對帳、來源與衝突 fail-closed 規則。
- [x] 2.3 實作缺基準逐檔隔離、完整 160 就緒判定及小於 160 檔的安全 bounded 訂閱路徑；不得新增 login／SSE 或盤中補位。
- [x] 2.4 補測相同集合不同順序、成員新增／刪除、超過 160 優先順序、錯誤日期／商品基準及部分缺口不拖累其他合法商品。

## 3. 盤前生效與稽核

- [ ] 3.1 實作收盤後新入選商品的前一適用交易日基準預建，以及 08:35 前隔夜修訂的一次有界差異驗證；逐檔封存 270 分鐘累積量、來源、完整性與收盤對帳收據，08:45 Gate 核對同一份 plan，驗證失敗保留原收據。
- [ ] 3.2 實作 08:35 後／盤中修訂待生效與盤前缺基準 fail-closed 規則；禁止開盤後補基準再追認當日盤前就緒或補發歷史通知。
- [ ] 3.3 定義刪除／停用已規劃商品時的明確確認流程；驗證失敗時 UI/API 必須顯示舊 plan、待生效設定與實際監控差異，不得靜默宣稱採用新設定。
- [ ] 3.4 實作設定 mutation 的 append-only 去敏稽核、revision CAS 與來源類型；舊資料操作者標示未知，確認失敗／衝突也可追查。
- [ ] 3.5 以測試驗證跨分頁競爭、盤前時限、資源預算耗盡、來源失敗、當日凍結、跨日 rollover、開盤後不得追認與退回 feature-off 的資料保留。

## 4. API、介面與遷移

- [ ] 4.1 更新監控 API 與 workspace，分列 configured、planned、候補、baseline-ready、subscription-requested、data-active、degraded 及生效交易日，不混用 Stage-160 歷史 GO 文案。
- [ ] 4.2 提供 rev8 備份與目前設定的唯讀比較及使用者確認後的新 revision 儲存流程；不得自動復原暫移 11 檔或覆寫既有設定。
- [ ] 4.3 完成桌面與窄版面、鍵盤、跨分頁及通知安全回歸；保護既有圖表、清單與交易功能。

## 5. 驗證與上線邊界

- [x] 5.1 執行 focused tests、相關整合測試、型別／建置、OpenSpec strict validation 與 `git diff --check`，將既有非本 change 失敗分開記錄。
- [ ] 5.2 在不重啟或增加既有行情 session 的前提下，先以 feature-off／simulation 比對 plan、逐檔基準與 API/UI；保存安全 Gate 和差異證據。
- [ ] 5.3 在經明確核准的適用交易日完成真實盤前至盤中驗收：官方交易日、同一 generation、逐檔合法 KBar、sealed minute 同分鐘比較、訂閱數及通知 Gate；不足證據保持未完成。
- [ ] 5.4 核對歷史 Stage-160 bundle、9/23–9/29 failed／partial 收據與既有 rollover change 證據均未被改寫，再整理成功、失敗、partial、unknown 與回復步驟；未取得完整跨日證據前不得歸檔。
