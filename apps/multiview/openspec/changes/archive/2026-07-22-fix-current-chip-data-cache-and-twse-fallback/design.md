## Context

日籌碼 API 目前以請求 `start`／`end` 寫入 `taiwan_stock_chip_fetch_state.coverage_start`／`coverage_end`。當 FinMind 在當日排程時間只回傳前一交易日 rows 時，fetch-state 仍宣稱 coverage 已到今天；`stateCovers` 與預熱 health 因此把舊資料視為完整且新鮮。上市三大法人另缺少 TWSE T86 fallback，使官方已發布後仍只能等待 FinMind 快取過期。

## Goals / Non-Goals

**Goals:**

- fetch-state 與 API coverage 僅反映實際保存 rows 的最早與最晚資料日。
- 當 `sourceDate` 落後請求結束日時，不得把該 dataset 視為已完整覆蓋當日。
- 上市三大法人可從 TWSE T86 官方資料取得當日最新快照，並沿用既有正規化欄位與 provenance。
- health、target discovery 與圖表按需查詢共用一致的實際 coverage 判定。
- 籌碼 warnings 位於目前所有副圖之後，且可關閉而不永久壓掉未來不同內容的提示。

**Non-Goals:**

- 不改變 TDCC 每週股權分散回補流程。
- 不新增 D1 table、欄位或 migration。
- 不改變副圖資料單位、圖表序列或 API response shape。
- 不以三大法人買賣超推算任何法人持股比例。

## Decisions

1. **以成功 rows 的實際日期寫入 fetch-state。** FinMind 回傳非空 rows 時，以排序後第一筆與最後一筆 `sessionDate` 寫入本次 coverage；request range 只保留在 API coverage 的 `requestedStart`／`requestedEnd`。這可直接修正既有 D1 schema，不需要 migration。

2. **coverage 完整度與 freshness 分開判斷。** `stateCovers` 與 watchlist prewarming 只有在實際 `coverage_end >= requested end` 且成功時間仍新鮮時才可命中；來源成功回傳歷史 rows 但缺少當日時，仍保存 rows，但狀態視為 partial／pending，讓後續請求可重試。

3. **新增 TWSE T86 官方最新資料正規化。** `institutional-flow` 在 TWSE 商品、請求包含今天且 FinMind 最新日落後時，呼叫 TWSE T86 JSON endpoint，依 `fields` 名稱建立欄位索引後解析目標證券，避免以固定欄位位置承擔 schema 漂移風險。官方 row 與 FinMind 歷史 rows 以既有合併規則保存，provenance 標示 `twse`。

4. **即使 FinMind 回傳部分歷史，也要嘗試當日官方補尾。** fallback 不只在 FinMind 回傳空陣列或 throw 時執行；只要最新 `sessionDate` 早於今天，就嘗試補入官方當日 row。這是本次錯誤未被既有 fallback 捕捉的核心差異。

5. **維持 fail-safe。** TWSE 無當日資料、格式不符或暫時失敗時，仍回傳 D1／FinMind 最近成功資料並標示 partial 或 stale；不得清除舊 rows，也不得把缺值補成零。

6. **將內部狀態與使用者說明分層。** API contract 仍保留穩定的英文 dataset／reason code 供程式判斷，但 `warnings[]` 改由集中 formatter 產生繁體中文。`foreign-holding` 說明外資及陸資持有股數與持股比率，並標示 FinMind 通常交易日晚間 21:00 更新；`securities-lending` 說明借券成交股數不等於放空，並標示通常交易日 15:00 更新、無成交時可能沒有當日 row。所有時段皆加註以來源實際發布為準。

7. **不把借券無紀錄誤判成漏資料。** 借券成交資料只代表實際成交量，日期落後可能表示中間交易日沒有成交；warning 使用「最近有成交日期」而非「尚未發布至」，避免暗示系統一定會補出零值 row。

8. **提示作為副圖 stack 尾端的獨立 notice。** markup 將 notice 放在 `.chip-pane-stack` 之後，讓多層副圖自然顯示於所有群組尾端；notice 提供文字標題的關閉按鈕。關閉狀態只保存在目前 panel manager 的記憶體，並以 `symbol + interval + warning text` 作為 signature；相同內容的重載維持關閉，但切換商品、週期或 warning 內容改變時重新顯示。載入中與錯誤狀態不沿用已關閉的 warning signature。

## Risks / Trade-offs

- [Risk] TWSE T86 response 欄位名稱或包裝格式改變 → 依 `fields` 名稱解析並驗證必要欄位；失敗時保留舊資料與安全 warning。
- [Risk] 同一請求增加一次官方網路呼叫 → 僅在 TWSE、`institutional-flow`、查詢包含今天且 FinMind 最新日落後時呼叫，並沿用 single-flight／Worker timeout。
- [Risk] 現有錯誤 fetch-state 在部署後仍宣稱過度 coverage → 新版請求會用實際 D1 rows 與來源日期重新判斷；成功重抓後就地修正，不需要破壞性清理。
- [Risk] FinMind 與 TWSE 分類定義出現差異 → 正規化後仍執行三大法人合計一致性檢查，provenance 清楚標示實際 provider。
- [Risk] 上游未依文件時程準時更新 → 提示使用「通常」並明確標示以來源實際發布為準，網站於背景更新或再次開啟圖表時重查。
- [Risk] 使用者關閉提示後錯過新狀態 → 關閉只套用完全相同的 signature；資料或商品改變即重新顯示，不寫入永久偏好。
