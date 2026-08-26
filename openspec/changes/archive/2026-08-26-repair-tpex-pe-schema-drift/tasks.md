## 1. 基線證據與缺口分類

- [x] 1.1 以 2026-08-26 simulation runtime 重現 `pnpm local-runtime multiview-daily` 的 TPEx PE latest `schema_mismatch`，並記錄最後 verified source date 仍為 2026-08-25 的差異
- [x] 1.2 在不保存 token、cookie、header 或完整 payload 的前提下，擷取最小化 TPEx 合法／未發布／schema mismatch 回應 fixture
- [x] 1.3 產出 12 個 latest pending、15 個 history missing 與 3 個 insufficient 商品的逐商品 gap report，標示市場、上市歷史、provider coverage、checkpoint 與 reason code
- [x] 1.4 依 gap report 將 parser、排程、回補缺陷列入修正，將 `official_not_published`、provider 不涵蓋與合法歷史不足保留為 partial／pending

## 2. TPEx PE parser 修正

- [x] 2.1 為已知合法 schema、合法空集合、官方未發布、缺少必要欄位、錯誤型別與不可驗證日期建立 parser regression tests
- [x] 2.2 在 TPEx provider adapter 以必要欄位 allowlist 正規化合法 envelope／欄名變體，保持既有 canonical PE row 與實際 source date 語意
- [x] 2.3 對未知 schema fail closed 並回傳 `schema_mismatch`，禁止猜測欄位、補零、forward-fill 或 requested end date 寫入
- [x] 2.4 將非機密診斷限制為 provider、欄位名稱／型別摘要、attempt 時間與 reason code，不保存完整來源回應

## 3. Pipeline、D1 與 health 狀態

- [x] 3.1 讓 daily pipeline 分流 `official_not_published`、合法空資料、`schema_mismatch`、暫時 provider failure 與成功資料的 retry／checkpoint 行為
- [x] 3.2 保存並呈現 TPEx 最近一次 attempt 時間／結果／reason code，同時保留最後 verified source date、coverage end 與 display date
- [x] 3.3 確保失敗 attempt 不覆蓋最後 verified row，成功重跑只以 material row changed-only transaction 寫入 D1
- [x] 3.4 更新 aggregate health，避免舊 `tpexSourceDate` 單獨掩蓋本次 parser failure，且不影響其他已通過的資料族群

## 4. 回歸與實際驗收

- [x] 4.1 執行 TPEx PE parser／pipeline targeted tests，證明已知合法 schema 成功、未知 schema 不寫入、未發布不誤報
- [x] 4.2 在 simulation runtime 執行 bounded `pnpm local-runtime multiview-daily`，核對至少一檔 `.TW` 與一檔 `.TWO` 的 attempt、source date、coverage、checkpoint 與 reason code
- [x] 4.3 核對 D1 `PRAGMA integrity_check`、代表商品 material hash 與 changed-only 寫入，確認修正未清空或重建既有 verified PE 資料
- [x] 4.4 以實際瀏覽器驗收 `.TW`／`.TWO` PE 線圖、資料日期與 partial／pending 提示，並確認暫時刷新失敗時保留最後 verified 線圖
- [x] 4.5 回歸 TDCC 50/50、聯一光 51/51 週資料與大戶／散戶 4 層 canvas，確認 PE 修正未破壞既有籌碼副圖
- [x] 4.6 驗收後確認 simulation API、5173、5174、watchdog、daily pipeline 與 TDCC pipeline 均恢復 loaded／healthy，production 與真實下單維持停用
