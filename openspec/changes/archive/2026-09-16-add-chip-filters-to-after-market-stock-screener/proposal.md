## Why

目前「選股篩選」只能依成交量、TDCC 千張大戶單週變化與技術型態篩選，既有籌碼副圖雖保存法人、融資融券與持股分級資料，卻只按追蹤商品暖機，不能支撐約 1,974 檔上市／上櫃普通股的同一期全市場判定。需要建立全市場盤後籌碼快照與可追溯的條件語意，才能把文件中有正式資料依據的籌碼選股加入產品，同時避免將三大法人資料誤稱為券商分點「主力」。

## What Changes

- 建立上市／上櫃普通股的盤後全市場籌碼資料管線，批次收集投信買賣超、融資融券餘額與 TDCC 週資料，保存實際來源日期、完整性、逐市場 coverage 與不可判定原因。
- 將官方公司基本資料中的已發行普通股數納入帶生效日期的選股母體，供「投信 N 日買超占股本」計算；不得使用外資持股資料的局部 coverage 或目前追蹤清單代替全市場分母。
- 在「選股篩選」新增八項可獨立啟用、可設定門檻且參與既有「全部符合／任一符合」組合的條件：
  - 千張大戶持股比例區間且連續上升。
  - 千張大戶人數下降且持股股數增加。
  - 10 張以下散戶持股比例下降。
  - 投信 5–10 個相鄰交易日累計買超占已發行普通股數達門檻。
  - 股價上漲且融資餘額下降或持平。
  - 券資比達門檻。
  - 收盤價創可設定期間的新高。
  - 收盤價向上突破可設定週期的簡單移動平均線。
- 提供「長線佈局」條件預設，精確套用千張大戶連續三週上升、10 張以下散戶持股下降與融資餘額下降；套用只修改 draft，仍須由使用者提交查詢。
- 擴充查詢 criteria、條件指紋、偏好版本、排序、分頁、缺漏統計與結果 evidence；每項籌碼判定顯示分子、分母、來源日期、比較期間、單位與公式版本。
- 將籌碼日資料、TDCC 週資料、選股日 K 與母體資料綁定同一 `effectiveSessionDate` 發布責任；任一必要市場、日期、schema 或全母體 coverage 不完整時保留最後合法快照並 fail closed，不以零值、舊資料或局部 53 檔結果補足。
- 明確排除目前沒有可信資料來源的券商分點主力連買、買賣家數差、主力未賣超及「過去零持股後開始連買」的投信實際持股初次認養；本次不得以三大法人買賣超或投信流量替代並沿用這些名稱。

## Capabilities

### New Capabilities

- `after-market-stock-screener-chip-filters`: 定義八項籌碼／價量條件、參數範圍、三態判定、條件預設、結果 evidence、排序與不可冒充的資料語意。
- `taiwan-stock-screener-chip-data`: 定義全市場投信、融資融券與 TDCC 批次收集、日期對齊、coverage、immutable snapshot、健康狀態與 fail-closed 發布契約。

### Modified Capabilities

- `after-market-stock-screener`: 擴充「選股篩選」版面的條件控制、偏好遷移、查詢指紋、結果卡與缺漏統計，並維持新分頁內的 K 線連動隔離。
- `taiwan-stock-screener-data`: 將已發行普通股數及其官方生效日期納入普通股母體，並要求籌碼條件只能使用同一期、全市場完整的母體分母。
- `taiwan-stock-screener-daily-ohlcv-history`: 提供收盤價創 N 日新高與收盤價突破 SMA5／10／20／60 所需的 canonical evidence，維持官方交易日連續性與不足歷史的明確分類。

## Impact

- 影響 `apps/multiview/worker` 的選股來源 adapter、D1 schema／migration、collector、publisher、repository、session readiness、results／status API 與健康檢查。
- 影響 `src/lib/stock-screener-*` 的 domain、criteria、公式、API decoder、偏好版本與 evidence 型別，以及 `src/components/stock-screener-panel.tsx` 的控制項、預設與結果呈現。
- 需要保存 TWSE／TPEx 官方日報與 TDCC 週資料的逐市場日期、payload hash、schema／normalization version、row coverage 與來源網址；不得把需求驅動的 `taiwan_stock_chip_daily` 追蹤商品 cache 當作全市場完成證據。
- 需要資料單元、repository／publisher integration、API contract、migration、瀏覽器互動、鍵盤／窄版面、stale／partial／mixed-session 與本機 D1 真實 coverage 驗收。
- 本 change 僅處理資料與唯讀選股，不新增行情訂閱、通知、觀察清單寫入、simulation broker write、production、CA 或真實下單能力。
