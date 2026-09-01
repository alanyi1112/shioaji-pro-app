## Context

既有 v1 收盤後選股以 1,975 檔上市／上櫃普通股母體建立本機 D1 immutable snapshot，日資料只正規化成交股數，TDCC 選股表及快照只保留本期與前期。使用者查詢是本機 GET，只讀已發布快照；盤後背景 operator 才能存取正式來源。新需求同時跨越 UI criteria、精確計算、日資料 adapter、TDCC 歷史保留、背景回補與 snapshot／cursor 版本，因此須以 v2 契約整體升級。

TWSE `STOCK_DAY_ALL` 的 `TradeValue` 與 TPEx `tpex_mainboard_daily_close_quotes` 的 `TransactionAmount` 已確認為同一正式日列中的成交金額欄位，但仍須在實作驗收確認兩市場日期、幣別、交易範圍與歷史報表 mapping 一致。TDCC 反轉只解讀第 15 級占集保庫存數比例的方向，不宣稱代表特定投資人實際買賣。

## Goals / Non-Goals

**Goals:**

- 讓成交量與大戶條件各自可選擇最低成交值門檻，且成交值只限制所屬條件，不會單獨使商品通過。
- 支援單週增加、由減轉增、由增轉減三種大戶模式，以及反轉前 1–4 週同方向設定。
- 用六個相鄰官方 TDCC 週期正確判斷最多四週後的反轉，缺週與零變化皆採 fail-closed 三態語意。
- 在 repo 外本機 D1 維持全市場所需資料，以有界、可續跑、可稽核的背景工作補足升級與新商品歷史。
- 以 v2 snapshot／criteria／cursor 隔離新舊結果，保留 v1 使用者偏好的安全遷移。

**Non-Goals:**

- 不提供盤中即時選股、歷史任意日期查詢、圖形化策略編輯器或超過四週的連續設定。
- 不把成交值當作第三個可獨立通過的條件，不用成交值取代成交量倍數。
- 不把全市場加入自選清單、個人 TDCC 一年回補佇列、Shioaji 訂閱或 K 線預載。
- 不將持股比例上升／下降描述成確定買進／賣出，不推論投資人身分。
- 不規避 TDCC CAPTCHA、登入、封鎖或速率限制；無合法自動取得方式時保持 `history-pending`。
- 不啟停 simulation API、watchdog、5173、5174、盤後 pipeline 或行情連線。

## Decisions

### 1. 成交值是每個既有條件內的選填限制

criteria v2 在 `volume` 與 `holder` 各自加入 `turnover.enabled` 與 `turnover.minimumWan`。成交量分支為「成交量倍數判定 AND 該分支成交值判定」，大戶分支亦同；外層仍以既有 `all`／`any` 組合兩個分支。這符合「分別加上」的語意，也避免高成交值本身在 `any` 模式造成誤入選。

未啟用成交值時，該分支不因日成交值缺漏變成 unknown；啟用後則以 snapshot 的共同最新完整交易日 D 判定，即使只開大戶條件也需要 D 的成交值。替代方案是全域單一成交值門檻，但無法讓兩個條件分別設定，也會模糊 OR 分支的缺漏原因，因此不採用。

### 2. 「萬」只做輸入顯示，canonical 值使用精確新臺幣元

介面接受 0.01–10,000,000 萬、最多兩位小數；解析後乘以 10,000，存成十進位整數字串 `minimumTurnoverNtd`。來源成交值亦正規化為非負十進位整數字串，領域層以 `BigInt` 比較，不先換算浮點萬元或顯示值。結果同時呈現原始元值、格式化萬元與資料日。

### 3. 大戶模式互斥，反轉週數指反轉前同方向次數

`holder.mode` 為 `weekly-increase`、`decrease-to-increase` 或 `increase-to-decrease`。`weekly-increase` 保留 W−Wprev ≥ X 的 v1 行為。反轉模式設定 `streakWeeks=N`，N 為 1–4：

- 由減轉增：反轉前最近 N 次相鄰週變化均 `< 0`，最新一次變化 `>= +X`。
- 由增轉減：反轉前最近 N 次相鄰週變化均 `> 0`，最新一次變化 `<= -X`。

因此 N=4 使用 W-5、W-4、W-3、W-2、W-1、W 六個週期。任何前段變化等於 0、方向不符時為 fail；所需週期缺漏、非相鄰或未通過完整 17 級驗證時為 unknown。X 只限制最新反轉幅度；若限制前段每週幅度會形成不同且過度嚴格的策略，因此不採用。

### 4. 日資料 payload 擴充成交值，週資料保留最新六個官方錨點

日 adapter 從 TWSE `TradeValue`、TPEx `TransactionAmount` 及各自歷史日報等價欄位正規化 `turnoverNtd`，保留 provider、欄位名稱、來源單位、交易範圍與 mapping version。日量的 D／P 錨點不變；成交值只需 D，但仍與同一列日量一起保存。

選股專用 `screener_tdcc_weekly` 改保留最新六個由官方期間證據確認的週期，publisher 對每檔嵌入按日期排序的最多六期 validated series。不得以資料表最近六筆代替官方相鄰週期，也不得從個人歷史表無驗證複製稀疏資料。

### 5. 回補採獨立有界工作，不阻塞查詢或既有 TDCC 佇列

升級時先重用本機已通過同等完整 17 級與來源版本驗證的列，再為每個 universe 商品建立最多缺五期的 screener 專用 checkpoint。每次 operator invocation 只處理固定 request／時間 budget，沿用 single-flight、timeout、冷卻及有界 retry；到達 budget 後保存 cursor，下次從未完成項目繼續。新商品加入時只建立該商品所缺六期，不擴張個人 active targets。

查詢及 UI 永不觸發回補。回補期間 snapshot 仍涵蓋全母體，資料不足的反轉分支回 `history-pending`／unknown；已完整商品可正常篩選。較新但稀疏或驗證失敗的回應不得覆蓋既有合法列。替代方案是等待六週自然累積，雖請求最少但無法及時支援既有商品，因此只作來源暫時不可用時的安全退路。

### 6. v2 快照與偏好採明確遷移，不重解釋 v1 結果

`SCREENER_VERSION`、公式、criteria fingerprint、snapshot payload、API response、cursor 及 localStorage key 升為 v2。首次讀到合法 v1 偏好時，轉換為成交值關閉、holder mode=`weekly-increase`、門檻沿用，再以 v2 key 保存；非法或未知版本不猜測。v1 已發布快照仍以 v1 schema 顯示，v2 route 不用新條件重算 v1 snapshot；發布失敗時繼續提供最後合法快照並標示版本與日期。

### 7. 本次六期 bootstrap 可使用固定版本的 TDCC 公開資料鏡像

TDCC 官方 `1-5` 全市場端點仍是最新週與未來每週更新的正式入口。該端點只保留最新一期，歷史官網則為逐商品表單；為完成本次已核准的六期升級，operator 可在明確的 `--bootstrap-history` 操作下讀取固定到 exact Git commit 的公開 TDCC `1-5` CSV 鏡像。

這條路徑不是一般排程來源，也不得接受環境變數、query、redirect 或任意 URL。manifest 必須固定每一期日期、URL、原始位元組數與 SHA-256；整批寫入前必須驗證 UTF-8、精確欄名、單一預期日期、每檔唯一 1–17 級、整數精度、調整與合計。最新鏡像期還必須與同一次 operator 已取得的 TDCC 官方全市場列逐商品完全一致。任何一項失敗都拒絕整批鏡像並回退既有官方逐商品流程。

鏡像 payload 的 provider 仍記為 `TDCC`，但 `sourceUrl`、payload hash、固定 commit 與 bootstrap receipt 必須揭露實際傳輸來源。寫入採 `ON CONFLICT DO NOTHING`，因此鏡像只能補缺列，不能用較新的抓取時間覆蓋官方 OpenAPI、官方歷史表單或既有合法本機列。這保留跨週公式的來源相容性，同時讓 provenance 可稽核。

## Risks / Trade-offs

- [全市場六期歷史可能產生數千個 TDCC request] → 嚴格 request／時間 budget、checkpoint、冷卻、來源限制與自然累積退路；驗收不得以無限制提高併發縮短時間。
- [兩市場成交值交易範圍或歷史欄位不一致] → 保存 mapping version，對 fixture 與實際日期逐市場交叉驗證；不相容列回 `incomparable_source`。
- [只開大戶條件但啟用成交值時新增日資料依賴] → UI 明示成交值日期與缺漏原因；停用成交值後不再要求日資料。
- [六期快照增加 D1 與回應大小] → 只保存聚合後第 15 級比例與必要 provenance，不複製完整原始表格；列表分頁不重送不需要的明細。
- [反轉被誤解為大戶買賣] → 文案固定使用「持股比例由減轉增／由增轉減」，說明 TDCC 指標限制。
- [v1 與 v2 cursor／偏好混用] → 版本納入 fingerprint，未知版本有界拒絕，並以 migration test 證明預設行為相容。
- [公開鏡像遭改寫、截斷或內容與官方漂移] → URL 固定 exact commit、逐檔固定原始位元組 SHA-256，先完整驗證六檔再寫入；最新期須與官方全市場資料逐列一致，任何失敗整批拒收並回退官方逐商品流程。

## Migration Plan

1. 先加入 v2 領域型別、純函式與 fixture tests，不改現有發布路徑。
2. 加入 additive D1 migration、成交值 adapter 與六期資料保存；保留 v1 表與快照可讀。
3. 先以明確操作執行固定版本六期鏡像 bootstrap；驗證失敗或仍有缺口時才啟動既有有界官方逐商品流程，觀察各週期 target／processed／remaining／failed／overdue 與來源冷卻。
4. 在六期資料與成交值守恆驗證通過後發布第一份 v2 snapshot，再切換本機 route／UI。
5. 驗證 v1 偏好遷移、全市場 API 分頁、實際 UI 與圖表連動後，才移除 v1 寫入；v1 讀取保留一個 release window。
6. 回滾時停止 v2 發布 gate、讓 UI 回到 v1 route／偏好，保留 additive 資料與 checkpoint 供後續診斷，不刪除已驗證資料或停機。

## Open Questions

無。使用者已確認設定四週代表反轉前連續四週同方向，因此最多需要六個 TDCC 官方週期。
