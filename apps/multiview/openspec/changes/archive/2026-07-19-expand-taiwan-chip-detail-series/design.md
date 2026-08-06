## Context

目前 `normalizeInstitutionalRows` 在記憶體中先依法人別彙整 `buy`／`sell`，但寫入 `InstitutionalFlow` 時只保留淨額；`MarginShort` 已保存買進、賣出、償還、前後日餘額與資券互抵，卻未保存 FinMind／TWSE 的限額或 TPEx 的 quota／使用率。D1 將各資料族群存為 JSON，因此新增欄位可以向後相容，不需變更 table schema。前端法人 pane 只畫淨額，融資融券 pane 只畫餘額與日變化；成交量只有柱狀 series，價格 MA 使用的 SMA 尚未套用到 volume。

此變更跨越上游 adapter、正規化型別、D1 JSON、API、指標計算與瀏覽器圖表，且必須維持 Workers runtime、現有 response 與多圖同步相容。資料只採既有合法來源；投信持股與比例沒有可靠公開來源時不得推算。

## Goals / Non-Goals

**Goals:**

- 保存並回傳外資、投信的原始買進／賣出股數，以及融資融券限額與使用率。
- 讓使用者在既有 pane 內查看完整逐日讀值，並依數值語意顯示折線或柱狀 series。
- 在成交量柱上加入目前 K 線 interval 的 MA5／MA10，維持時間軸與 crosshair 同步。
- 保持缺值、單位、來源及原始精度；舊 D1 rows 與舊快取 response 仍可讀取。
- 以單元、API、瀏覽器互動及實際上游 schema smoke 驗證結果。

**Non-Goals:**

- 不以買賣超累積推算投信、自營商持股股數或比例。
- 不導入付費資料、網頁爬蟲或新的第三方 chart 套件。
- 不改變既有籌碼 pane A／B 模式、多圖數量政策或 TDCC 回補流程。
- 不把所有細項預設同時畫出，也不以折線呈現本質為每日流量的買進、賣出、淨額或償還。

## Decisions

### 1. 擴充既有日資料物件，不新增 D1 欄位

`InstitutionalFlow` 新增 `foreignBuyShares`、`foreignSellShares`、`investmentTrustBuyShares`、`investmentTrustSellShares`；`MarginShort` 新增 `marginLimitLots`、`marginUtilizationPercent`、`shortLimitLots`、`shortUtilizationPercent`。D1 繼續保存完整 JSON，舊 row 缺少屬性時由 API／前端視為 `null`。

採用這個方式是因為欄位屬於既有資料族群，JSON 擴充可避免新增 nullable columns 與 migration 風險。替代方案是為每個細項增加 D1 column，但會放大 schema、upsert 與局部合併的修改面，且不改善查詢需求。

### 2. 法人淨額以未四捨五入的來源股數計算

外資買進與賣出採用和既有外資淨額相同的分類組合；若來源將 `Foreign_Investor` 與 `Foreign_Dealer_Self` 分開，買進、賣出與淨額都使用相同可相加集合。投信直接使用 `Investment_Trust`。內部與 API 保存股數，前端最後才換算張數，因此不得以已格式化張數重算淨額。

來源只有淨額而沒有 gross buy／sell 時，保留淨額並讓 gross 欄位為 `null`。替代方案是由淨額拆出買進與賣出，但該分解沒有唯一答案，會製造假資料。

### 3. 使用率優先採來源發布值，否則以限額推導

TPEx 已提供融資、融券使用率時保存來源值；TWSE 或 FinMind 只提供今日餘額與限額時，使用 `todayBalance / limit * 100`。只有兩者皆為有限非負數且限額大於零時才計算；否則使用率為 `null`。若同時具有來源值與可計算值，保存來源值並以小數顯示精度容許值交叉驗證，明顯不一致時留下安全 warning，不以計算值覆蓋來源值。

替代方案是以發行股數作分母，但那不是信用交易使用率的來源定義，因此不採用。

### 4. series 依存量、比例與流量分組

- 成交量使用柱，MA5／MA10 使用折線。
- 外資持股股數、外資持股比例、融資／融券餘額及使用率使用折線。
- 法人買進、賣出、淨額，融資融券買進、賣出、償還及日變化使用柱狀 series。

各 pane 的既有主要 series 維持預設：外資為淨額＋持股比、投信為淨額、融資融券為餘額＋日變化。新增細項透過 pane 內的 series 選擇控制啟用，選擇按 `tabId + symbol + paneId` 保存於既有本機偏好範圍。張數流量、張數餘額與百分比使用獨立 price scale，避免量級互相壓縮。

替代方案是預設一次顯示全部 series，但在多圖與窄 pane 會降低可讀性。

### 5. 讀值完整，方向只比較前一筆實際資料

crosshair／最新讀值顯示每個可用細項；缺少欄位逐項顯示「無資料」。紅色上箭頭、綠色下箭頭與中性色持平，皆比較同欄位前一筆實際非 `null` 資料，不因中間缺日而補值，也不比較不同欄位。

### 6. 成交量平均由 Worker 統一計算

`computeIndicators` 對排序後 candles 的 `volume` 計算 5、10 期簡單移動平均，回傳 `volume_moving_average.ma5` 與 `ma10`。前 4／9 筆分別為 `null`；合法的 0 成交量仍納入期數與平均。由 Worker 統一計算可讓所有 panel、快取與瀏覽器使用相同結果，避免前端各自計算漂移。

### 7. series 選項整合至右鍵功能表並保留右側數值軸

副圖標題列不建立「項目」按鈕或其他新增控制鈕。具有可選 series 的 pane，直接在原本的右鍵功能表中列出具色彩提示與 checkbox 的「線圖項目」，並在同一功能表保留既有「移除副圖」。鍵盤的 Context Menu 鍵與 `Shift+F10` 使用相同功能表，Escape 關閉後將焦點還給副圖。

每個具有可見 series 資料的 pane 都以目前主要可見資料群組驅動 `right` price scale，並明確啟用右側刻度、tick 與邊界；其他不同單位的資料群組仍使用隱藏 overlay scale，避免張數、百分比與每日流量互相壓縮。當使用者只選擇次要群組時，該群組改接右軸，確保數值軸不因取消預設 series 而消失。

## Risks / Trade-offs

- [舊 D1 rows 沒有新增欄位] → API 保持 optional／`null` 相容，依既有 stale 與 coverage 規則逐步 refresh，不清空其他資料族群。
- [上游法人分類隨年代不同] → 沿用既有分類映射並讓 gross 與 net 使用同一集合；缺少必要分類時不以 0 補足。
- [來源使用率與公式值有小數差] → 來源值優先，僅以來源顯示精度容許交叉驗證；明顯差異回報 warning 並保留 provenance。
- [多條 series 造成圖面擁擠或 Y 軸誤讀] → 維持精簡預設、提供逐 pane series 選擇，並依張數流量、張數存量、百分比分離尺度。
- [右鍵選項增加後功能表高度超出 viewport] → 開啟時重新量測並限制在視窗內，必要時讓項目區塊可捲動；窄 pane 不再被標題列按鈕占寬。
- [本機偏好格式演進] → 使用具版本的 selection payload；無法解析時回到既有主要 series 預設，不影響 pane 選擇。
- [投信持股在參考畫面存在但免費來源缺少] → 明示「無資料」且不建立虛構 series；未來只有在取得授權與 schema 證據後另立 change。

## Migration Plan

1. 先擴充型別、adapter、fixture 與正規化測試，確認 TWSE／TPEx／FinMind 單位及欄位。
2. 更新 D1 JSON 讀寫與 API contract；不執行 table migration，舊資料自然相容。
3. 新增成交量平均及籌碼 series／讀值控制，保留既有預設畫面。
4. 執行單元、整合、lint、OpenSpec strict validation 與瀏覽器多圖互動驗證。
5. 部署後抽查上市、上櫃、ETF 與不可融券商品的 live API／UI；確認穩定後讓背景 refresh 逐步補齊新欄位。

回滾時可回退 Worker／前端版本；D1 JSON 中多出的鍵會被舊版忽略，不需刪除資料。

## Open Questions

- 無。投信持股股數與比例明確排除於本 change，待未來出現可合法自動介接且可驗證的來源後另案處理。
