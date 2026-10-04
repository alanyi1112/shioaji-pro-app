# 五型態核心實作與來源唯讀預檢

日期：2026-10-04，Asia/Taipei。此紀錄屬實作第一階段，不是正式 v9 發布、API 端點、UI 或清單 live 驗收。

## 當期來源預檢

以 Node 24.19.0 `DatabaseSync(..., {readOnly:true})` 讀取既有本機資料庫，不建立連線／訂閱、不執行下載或寫入。首次受 sandbox 阻擋回 `unable to open database file`；改以獲准的唯讀診斷取得資料，沒有用此失敗推論資料不存在。

- v8 head：`72dd8c83-792e-4217-a8ab-398cf8513c51`；有效資料日 2026-10-02，母體 1,977 檔，160 個交易日／320 個市場日期。
- 最近 64 個 session 為 2026-07-02 至 2026-10-02，7/9 後接 7/13，沒有以 7/10 休市日製造空棒；9/25 後接 9/29，不能改用週一至週五猜日期。
- calendar authority hash：`e3f19254abb134e73f56a93946814c5e0911d95a9a41c0fa86dc2fc8c2afe268`。
- 已發布 mapping：`bollinger-source-selection-v1:161e096da316e7d04dc0ab9daf8c405bbca6d44598d0e75b104fe733dd044035`。
- 查核保存的最新日來源列有完整字串 open／high／low／close／volumeShares；現有 verified Shioaji review 為未還原價、`official-daily-compatible`、股數單位，mapping `shioaji-daily-quotes-shares-twd-v2`。
- 這是可重用來源的預檢，**不是逐檔 64 日完整性／全部來源 hash 的獨立稽核**。不能宣稱全部 1,977 檔都 ready。

既有 `publishBollingerDaily` 在背景來源已驗證後發布 v8；`stock-screener-bollinger-schedule.ts` 有同鍵休眠 fast path；gateway／worker 目前只接到 v8。v8 的凍結 features 缺 open／high／low，不能以 close-only 推導反轉形態。後續必須建立獨立 v9 schema／repository／publisher，並處理既有休眠輪次的新能力，不讓 v9 pending 阻擋 v8 profile 與發布。

## 已實作

- `stock-screener-v9.ts`：CriteriaV9／PreferenceV9、精確欄位 validator、安全 v8 遷移、啟用且適用參數 fingerprint、逐型態暖機上界（最大 64 日）。新增分支預設關閉、五型態初始全選；沒有寫入偏好或 profile。
- `stock-screener-candlestick.ts`：五型態、晨星十字子型、嚴格中點／開盤／跳空／影線、前期 OLS 與首末變化、中位數長實體、固定 D 或 D−1／D 確認、選用量能與位置、三態 OR／外層組合、逐棒及精確 operands evidence。
- OHLC 採既有 canonical 百萬分之一價格單位與 BigInt 交叉相乘。量能關閉時缺股數不阻擋形態；啟用時缺量／零均量保留 unknown。已知不相容價格窗保留 unknown，不擅自還原。
- 完整短窗 builder 對齊來源提供的 session grid、保留 null 缺口並深度凍結。clone 或 hash 改動須重驗；此 builder **尚未接到正式資料庫發布**。
- `stock-screener-candlestick-catalog.ts`：外部統計獨立版本與來源。晨星十字、反轉率、原研究排名、烏鴉綜合排名及刺透 11 筆／期間／成本／持有策略分列；不匯入 evaluator 當作勝率或參數。
- `stock-screener-candlestick-query.ts`：純唯讀全母體判定、母體／市場守恆、同代碼 symbol tie-break、去重、條件／snapshot／日期／rowsHash／join 游標綁定。**尚未有 v9 HTTP route，不能將此純函式當端點驗收**。

## 測試與修正

第一輪新核心 42 項，39 通過／3 失敗；原測試結果保留於本輪工具紀錄。兩項是 fixture 沒同時滿足長實體／突破最高價的其他必要條件，修正 fixture，不放寬正式條件；另一項發現 builder 接收額外物件欄位時帶入舊 evidenceHash，改為明列 provenance 欄位後通過。

初始 TypeScript 指出既有型別實際名稱為 `ScreenerPreferenceV8`，已修正 import。加上缺量隔離、OLS 方向矛盾、看空確認、完整三態表、全部分頁與零 fetch 後，新測試持續擴充；最終品質檢查結果記錄在 verification.md。

## 未完成與安全界線

正式 additive schema／repository、背景發布鍵／atomic head／同鍵 no-op、v9 HTTP／gateway、收合五按鈕／結果 evidence、瀏覽器與真實逐股／清單驗收仍未完成。不勾 3.x、4.x、5.x、6.x 任務；原有來源、head、daily profile、草稿、圖表、兩套清單及 runtime 不改動，不重啟服務、不交易、不歸檔／commit／push。
