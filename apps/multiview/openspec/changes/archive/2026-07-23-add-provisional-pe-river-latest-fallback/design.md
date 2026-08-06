## Context

現行 `use-free-pe-river-data-sources` 已以 FinMind 建立五年歷史 seed，並由 TWSE `BWIBBU_d`／TPEx 官方 OpenAPI 提供最新快照及最近共同交易日核對。現有安全邊界在官方快照落後時保存 `official_not_published`，較新的 FinMind row 維持 `finmind_pending_verification`，不進入正式河流 response；因此 2026-07-22 FinMind 已有資料、但 TWSE OpenAPI 仍停在 2026-07-21 時，使用者只能看到截至 2026-07-21 的 verified 河流。

TWSE 指定日期查詢網頁雖可能比免費 OpenAPI 更新，但未取得允許自動化存取的書面依據，本變更不得呼叫該介面。解法必須沿用目前免費、private／custom、非商業與不提供原始資料 dump 的邊界，並把「資料可顯示」與「資料已由交易所確認」拆成不同狀態。

## Goals / Non-Goals

**Goals:**

- 官方 OpenAPI 落後時，以 FinMind 同日 P/E 與收盤價產生最多三個 completed session 的 provisional tail。
- 保留兩組可觀測日期：最後官方／provider verified 日期，以及包含暫代尾端的顯示日期。
- 以既有 verified 五年 P/E 樣本計算固定 percentile；暫代 P/E 不改變 multiplier 或 252 筆門檻。
- 官方資料到齊後自動、冪等且原子地追認或取代 provisional row。
- 讓 UI、API、PNG 與 health 一眼可區分官方值、FinMind 暫代值、待追認與來源錯配。
- 維持 latest-first、single-flight、全域免費額度、bounded retry、D1 checkpoint 與安全錯誤邊界。

**Non-Goals:**

- 不呼叫或爬取 TWSE／TPEx 一般日期查詢網頁，也不申請或導入付費 Data E-Shop。
- 不把 FinMind 暫代值命名為官方本益比、交易所已驗證 EPS 或 official coverage。
- 不以 MOPS 財報 EPS、盤中成交價、其他網站或推測值替代同日 P/E／收盤價配對。
- 不重算或重新下載已完成的五年歷史 seed，不新增同業／產業 P/E、forward P/E、合理價或目標價。
- 不讓 provisional tail 成為永久歷史來源；其終態必須是官方取代、官方 gap 或來源錯配後停用暫代。

## Decisions

### 1. 只有官方快照落後時才啟動 bounded provisional latest lane

latest lane 仍先取得每個 exchange 的官方市場快照。只有同一商品的 FinMind `TaiwanStockPER` 與 `TaiwanStockPrice` 存在比 `officialSourceDate` 新的共同日期時，才建立 provisional candidate；官方日期相同或較新時不得額外建立 provisional row。

FinMind latest request 只查 `officialSourceDate` 至 Asia/Taipei 當日的 bounded 區間，最長 14 個日曆日，並沿用每個商品兩個 dataset request、全域 budget 與 retry-after。系統只接受最多三個連續可得的較新 completed sessions；當日 row 必須在 Asia/Taipei 18:30 後的 latest run 才能成為 candidate，手動在盤中執行不得把未完成日當成 completed session。

選擇最多三個 session 是為了容許短暫發布延遲，又避免交易所長期中斷時累積未確認歷史。替代方案是無上限接受 FinMind 新日期，會讓 provisional 逐漸取代官方來源，因此不採用。

### 2. 新增專用狀態並拆分 verified coverage 與 display coverage

新增 `finmind_provisional_latest` validation status，與歷史 seed 使用的 `finmind_pending_verification` 分開。provisional row 保留 `provider=finmind`、original source、實際 `sessionDate`／`sourceDate`、`fetchedAt`、建立時間與等待核對日期；既有實體欄位 `official_close`／`official_pe_ratio` 為相容性欄名，API 與 UI 必須依 provider／validation status 決定語意，不能僅因欄名而稱為官方值。

coverage 回傳至少包含：

- `verifiedEnd`：只計入 `official_verified` 與既有 `finmind_overlap_verified` 的最後有效日期。
- `displayEnd`：在 provisional tail 可安全顯示時，包含最後一個 `finmind_provisional_latest` 日期。
- `provisionalDates`：目前等待官方核對的實際日期清單，最多三筆。
- `officialSourceDate`：本次官方快照實際揭示的日期，不得改寫成 requested date。

provisional row 不增加 verified sample count、不完成 official checkpoint，也不把 health 的 `freshOfficial` 設為 true。替代方案是沿用單一 coverage end，會使前端與排程無法判斷資料是否真正追認，因此不採用。

### 3. 暫代資料只延伸價格座標，不參與 percentile

每個 candidate 必須先確認 exchange、canonical symbol 與 `sessionDate` 完全一致，且 FinMind P/E 與 close 均為有限正數，再計算：

```text
provisionalReferenceEps = finmindClose / finmindPeRatio
provisionalRiverPrice[p] = provisionalReferenceEps × verifiedMultiplier[p]
```

`verifiedMultiplier[p]` 必須由截至 `verifiedEnd` 往前五年的 verified 正 P/E 樣本計算。provisional P/E 不得納入 P10／P30／P50／P70／P90、不改變 252 筆門檻，也不得回填缺少的歷史日期。任一欄位空白、零、負數、非有限值、不同日或不同商品時保留 gap，不建立 provisional point。

這讓最新價格帶可以延伸，但河流估值基準仍來自已確認的歷史分布。替代方案是把 provisional P/E 納入 percentile，會讓尚未追認的單日資料改變整張圖，因此不採用。

### 4. 官方到齊後以 P/E 與 close 逐項核對，官方 row 永遠優先

後續 latest run 取得相同 `exchange`、canonical symbol、`sessionDate` 的官方 row 時，分三種終態：

1. **相符**：`abs(finmindPe - officialPe) <= 0.01` 且 `abs(finmindClose - officialClose) <= 0.01`。以官方數值重新計算 reference EPS，將同日 row 原子取代為 `official_verified`，清除 provisional pending，推進 `verifiedEnd`，並記錄兩項 difference 與 `officialOverlapDate`。
2. **不相符**：若官方 P/E 與 close 都有效但任一 difference 超過 `0.01`，仍以權威的官方 row 取代 provisional row並推進 official coverage；另在 fetch／provider state 保存安全的 `source_mismatch`、差異數值與日期，停用該商品後續 provisional fallback，直到後續明確的恢復規則或人工診斷。既有 verified 歷史不刪除。
3. **官方明確沒有有效 P/E**：若官方同日商品存在但 P/E 為空、`-`、零、負數或不可計算，移除該日可見 provisional point並保存官方 gap／reason；不得繼續用 FinMind P/E 假裝交易所仍有有效值。

官方仍未發布相同日期時維持 provisional pending，不執行追認。`0.01` 是兩項各自的 absolute difference，不比較衍生 reference EPS，也不以比例誤差放寬。

### 5. D1 以原子批次完成 row、狀態與 coverage 轉換

provisional ingest、官方追認與 mismatch 都使用同一個 canonical key：`exchange + symbol + sessionDate`。同一次 promotion 必須以 D1 atomic batch 或等價 transaction 同時完成：

- 寫入或取代 valuation row。
- 更新 validation／provider 狀態與 official overlap metadata。
- 更新 fetch state 的 verified／display／official source dates。
- 在所有必要寫入成功後才將 job／checkpoint 標為 completed。

重跑相同 payload 必須冪等；較舊 FinMind row 或晚到的 provisional request 永遠不能覆蓋 `official_verified`。若 batch 任一步驟失敗，completed 狀態不得先行提交，下一次排程可安全重試。

### 6. API 與 UI 使用雙層視覺語意

河流 API 在既有 `sources`、`coverage`、`warnings`、`backfill` 外新增安全的 `provisional` metadata，至少包含 status、dates、provider、verified end、official source date 與核對狀態；不回傳完整 FinMind 原始歷史 payload。

前端對 provisional tail：

- 五條 boundary 與四個 band 使用既有 multiplier，但以降低透明度、虛線尾端或等價可辨識樣式呈現。
- status 固定顯示「FinMind 暫代，等待交易所確認」及最後官方驗證日期。
- pointed-date readout 使用「暫代本益比」「暫定參考 EPS」，不得使用「官方本益比」或「交易所已驗證」。
- PNG 必須保留畫面上相同 provisional 樣式、來源與警示。

當官方追認完成，下一次 response 移除 provisional 標示並改用官方值；取消勾選、切換商品或晚到 response 仍沿用 latest-wins 與完整清理規則。

### 7. 排程、health 與恢復規則維持 fail-safe

既有 19:30／23:30 Asia/Taipei schedule 與手動 `workflow_dispatch` 都先執行 official latest，再執行 provisional candidate／reconciliation，最後才執行 history lane。休市、資料日期未前進時只更新 heartbeat。

health 分開彙總 official fresh、provisional pending、provisional capped、source mismatch、retry waiting 與各自 source date。來源 timeout、429、retryable 5xx 或 schema drift 時保留已驗證 D1 與現有 provisional 狀態，採 bounded retry；不得因 panel request 同步抓取上游，也不得 fallback 到交易所網頁。

### 8. 以單元、D1、workflow 與正式 UI 四層驗證

純函式測試涵蓋同日 join、`0.01` 邊界、`0.011` mismatch、零負與空值、三個 session 上限、盤中拒絕與 percentile 不變。D1 測試涵蓋原子 promotion、重跑冪等、官方優先、失敗不先完成與 verified／display coverage 分離。

private workflow 必須驗證一次「官方落後→provisional 可見」與下一次「官方到齊→追認或 mismatch」的真實狀態遷移。登入後 browser 驗收必須確認單圖與多圖 readout、來源警示、快速切換、重新載入及完整 panel PNG；只看 source 或單元測試不算完成。

## Risks / Trade-offs

- [FinMind 最新值後來與官方不一致] → 官方 row 仍優先寫入；記錄 `source_mismatch` 並停用該商品後續 provisional fallback，避免重複顯示未可信尾端。
- [官方 OpenAPI 延遲超過三個交易日] → 停止擴張 provisional tail，顯示 `provisional_capped`，保留 verified 河流與最多三個明確標示的暫代點。
- [盤中手動 workflow 把當日資料誤認為收盤] → current-date candidate 必須同時通過 Asia/Taipei 18:30 時間閘與同日 PER／close 配對。
- [單一 valuation key 無法同時保留官方與 FinMind row] → 核對前先在記憶體比較；官方 row 取代主表，差異與 provider quarantine 保存在 fetch／audit state。
- [UI 把 provisional 值誤讀成官方值] → API 提供明確 validation status，readout 與 PNG 使用不同標籤及視覺樣式，並以 browser test 固定文字。
- [FinMind 額度或條款改變] → 沿用全域 budget、private／custom deploy gate 與 license review；fail closed，不改抓未授權來源。

## Migration Plan

1. 新增 validation／coverage／provider quarantine 所需的 additive D1 欄位與 migration，先部署但不啟用 provisional 顯示。
2. 實作 bounded latest adapter、candidate 正規化、三 session 閘門、reconciliation 與原子 D1 promotion，完成 fixtures 及 repository 測試。
3. 擴充 private workflow／health，在測試商品以 feature flag 執行「官方落後→暫代→官方追認」完整遷移。
4. 擴充 API 與前端 provisional tail、readout、warning、latest-wins 清理及 PNG，完成 1／4／8 圖實際 UI 驗收。
5. 重新執行完整測試、OpenSpec strict validation、private workflow 與登入後正式站 smoke；確認 Sites 仍為 private／custom 才啟用。
6. rollback 時關閉 provisional feature flag 與 candidate claim，API 回到只顯示 verified coverage；保留 additive D1 row／audit state供後續追認，不 destructive delete。

## Open Questions

- 三個 provisional completed sessions 為初始安全上限；實作後應依真實 TWSE／TPEx 發布延遲觀察，再以獨立規格變更調整，不在 runtime 自動放寬。
- `source_mismatch` 後恢復 provisional fallback 的自動條件暫不納入本變更；先要求人工診斷或後續明確規格，避免一次偶然相符就解除隔離。
