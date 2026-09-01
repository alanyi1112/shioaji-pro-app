## Why

既有收盤後選股已能用全市場日成交量與相鄰兩週 TDCC 千張大戶比例進行篩選，但尚未保存官方日成交值，也只保留兩個 TDCC 週期，因此無法提供可選的最低成交值限制及最多連續四週後的持股比例反轉判定。這次變更要在維持本機唯讀查詢與全市場守恆的前提下，補齊成交值、多週歷史與可恢復背景回補能力。

## What Changes

- 在成交量與千張大戶兩個條件中，分別加入可選的最低成交值限制；介面以「萬」為輸入單位，內部以精確新臺幣元比較，成交值不得單獨構成符合條件。
- 將千張大戶條件擴充為「單週增加」、「由減轉增」及「由增轉減」三種模式，連續週數可設定 1–4，反轉門檻維持可設定且預設為 0.2 個百分點。
- 明確定義設定 N 週為反轉前已有 N 次相鄰、同方向週變化；最多四週時須取得六個連續 TDCC 官方週期。零變化會中斷連續狀態，缺週不得跳期、補零或 forward-fill。
- 從既有 TWSE／TPEx 正式日資料保存與日期錨點一致的成交值，並將 screener 專用 TDCC 滑動資料窗由兩期擴為至少六期。
- 擴充全市場背景資料準備：首次啟用、版本升級及新商品加入時，依 checkpoint 有界回補所需週期；來源不可合法取得或尚未完成時回報 `history-pending`／`unknown`，不阻塞已有完整資料的其他商品。
- 對本次六期升級 bootstrap，允許使用者明確核准的 TDCC 1-5 公開資料鏡像；只接受固定 repository commit、逐檔 SHA-256、單一資料日期與完整 17 級驗證，並以官方最新全市場批次逐列對帳。鏡像只能補缺列，既有官方列優先，驗證失敗即回退既有官方逐商品歷史流程。
- 升級選股 criteria、snapshot、API、cursor、偏好保存及資料狀態至 v2，保留 v1 偏好安全遷移與舊快照不被錯誤重標的契約。
- 增加全市場守恆、成交值單位、兩種反轉方向、週數邊界、缺週、背景續跑及實際 UI／本機 API 驗收。

## Capabilities

### New Capabilities

- `after-market-stock-screener-advanced-filters`: 定義兩個既有選股條件的可選成交值限制、千張大戶多週反轉模式、v2 查詢／顯示／偏好與三態組合語意。
- `taiwan-stock-screener-multiweek-data`: 定義正式成交值欄位、最多六個 TDCC 週期、全市場背景補資料、資料保留、完整性、版本與驗收契約。

### Modified Capabilities

無；本 change 以新 capability 擴充尚未歸檔的 `add-after-market-stock-screener` v1 契約，待 v1 正式 specs 同步後仍維持相同 capability 邊界。

## Impact

- 前端：`src/components/stock-screener-panel.tsx`、選股偏好與結果列、窄面板與鍵盤操作。
- 共用領域與 API：`src/lib/stock-screener-domain.ts`、`src/lib/stock-screener-api.ts`、criteria fingerprint、排序、cursor 與 unknown 原因。
- MultiView worker：日資料 adapter、publisher、route、D1 snapshot payload 與 schema migration。
- 背景工作：`scripts/stock-screener-update.mjs`、盤後 pipeline gate、TDCC 六期回補 checkpoint、限速與恢復。
- 資料來源：沿用已核對的 TWSE `TradeValue`、TPEx `TransactionAmount` 與 TDCC 完整 1–15 級資料；TDCC 最新週仍取官方全市場 OpenAPI，固定版公開鏡像只作本次六期 bootstrap 的受控傳輸來源；不新增 Shioaji 全市場訂閱、交易寫入或 hosted 選股路由。
- 相依性：實作前須保留並整合 `add-after-market-stock-screener` 已完成的 v1 行為；不得藉本 change 重啟、停止或改寫既有 simulation runtime。
