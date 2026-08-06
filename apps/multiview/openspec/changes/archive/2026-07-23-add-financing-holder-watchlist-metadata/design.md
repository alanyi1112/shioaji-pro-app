## Context

現有台股籌碼資料已提供日頻融資融券、週頻 TDCC levels、三群組十個副圖、方式 A／B、右鍵詳細資料與 D1 使用者清單。本 change 跨越 Worker 資料契約、D1 migration、主圖／副圖 controllers 與清單 metadata UI，但不再包含任何投資報酬或績效追蹤能力。

使用者已確認名稱使用「估算融資成本／估算融資維持率」，並明確取消投資報酬、報酬率及可能最大／最小報酬功能。暫緩中的 `add-mainforce-chip-subcharts` 仍保留在 active changes，與本 change 不共用資料來源或實作範圍。

## Goals / Non-Goals

**Goals:**

- 建立可重現、可追溯版本的估算融資成本與估算融資維持率。
- 在既有副圖架構加入集保戶數、股東人數變化與 400 張以上級距，完整沿用群組、右鍵、排序與 lifecycle。
- 為新加入清單項目保存可信日期與可編輯推薦人，並維持使用者隔離及舊資料相容。
- 對融資成數、TDCC 缺值與既有清單未知日期採 fail-closed。

**Non-Goals:**

- 不實作券商分點、買賣家數差異、Top 15 籌碼集中度、`5 日－20 日` 差值或 FinMind Sponsor。
- 不把估算融資指標宣稱為市場真實平均成本或券商追繳值。
- 不計算或顯示投資報酬、報酬率、理論最大／最小報酬、交易日窗口或加入後價格表現。
- 不建立「績效追蹤」按鈕、performance API、績效快取、公司行動調整流程或相關排程。
- 不推測既有清單項目的歷史加入日期。

## Decisions

### 1. 估算融資成本採有版本的移動平均成本法

以逐日融資買進張數及當日收盤價加入成本池，融資賣出與現金償還以當日平均成本移除；第一筆或歸零後重建部位以當日收盤價 seed。每個結果包含 `formulaVersion`、`seeded`、`partial`、來源與日期。

選擇理由是現有免費官方日資料能提供融資流量、餘額與日 K，公式可重播並能處理同日買進與償還。替代方案「只用餘額淨增加」會忽略同日週轉；以典型價或猜測成交均價則加入無法驗證的假設，因此不採用。

若流量與餘額無法在單位與允許調整差異內核對，當日結果中斷為 partial，不以餘額差或零值偷偷修補。

### 2. 估算融資維持率需要可追溯融資成數

公式固定為：

`estimatedMaintenancePercent = close / (estimatedCost × marginLoanRatio) × 100`

融資成數只能來自經核可來源與有效日期；無法確認時回傳 `null`。不使用常見的 60% 當隱藏預設，因個別商品、處置或規則可能不同。前端只格式化 Worker 回傳的結果，不自行重算或猜成數。

### 3. 擴充相容的 chip response，而不新增重複上游請求

`margin-short` response additive 加入估算輸入、結果與 provenance；融資、融券、券資比、估算融資維持率依 `symbol + range` 共用一次請求。TDCC response additive 加入分級 17 總戶數、級距聚合人數與前期差值；大戶、散戶、集保戶數共用一次請求。

新欄位一律 nullable，舊 cache 或尚未回補資料仍可被現有 pane 讀取。D1 cache key 加入 schema／formula version，避免新舊公式混用。

### 4. 副圖 registry 擴成十二項並保留 stable IDs

三個群組調整為法人 4、融資券 5、持股比 3。第三群只改顯示名稱，沿用既有 group ID，避免群組排序、置底與偏好失效。新 pane 追加 canonical child order；既有 `modeBSelectedPaneIds` 原樣保留，不自動打開新 pane。只有從未保存偏好的使用者首次進入方式 B 時預設全選十二項。

大戶／散戶的人數線預設可見，但作為 pane 內 series 偏好獨立保存；400 張以上由 TDCC levels 12～15 前端重聚合，不重新呼叫上游。分級 12 的官方範圍為 `400,001-600,000 股`，因此必須納入，否則實際下界會錯成 600,001 股。

### 5. 清單加入日期由伺服器建立，舊資料不造假

新 watchlist item 使用獨立 `itemId`，Worker 以 `Asia/Taipei` 的接收日期寫入 `addedAt`；推薦人為可選文字，做長度、控制字元與輸出 escaping 驗證。刪除後重加建立新 `itemId` 與日期。

D1 migration 對既有項目增加 nullable 欄位，設定 `addedAt=null`、`dateStatus=legacy_unknown`。不以 migration 日期或最後修改日當作歷史事實。

### 6. 加入日期只作為清單 metadata

`addedAt` 與 `recommender` 只供清單顯示、編輯與資料管理，不連動 candles、交易日曆、公司行動或價格計算。前端不建立「績效追蹤」入口；Worker 不建立 performance route；D1 不建立績效結果或快取欄位。

這個邊界可避免未來開發者看到加入日期後，自動恢復已取消的績效需求。若未來重新提出投資報酬功能，必須另開 OpenSpec change 重新定義公式、資料來源與驗收。

## Risks / Trade-offs

- [估算成本受 seed 日期影響] → 回傳 `seeded` 與起算日；資料不足時不宣稱完整歷史成本。
- [官方融資流量與餘額可能有調整差異] → 設核對容許規則與 partial 狀態，保留 raw/provenance 供診斷。
- [融資成數資料不一定可免費自動取得] → 成數缺漏時維持率為 null；成本線仍可獨立使用，不內建 60%。
- [既有清單沒有可信加入日期] → 顯示「日期未知」，不以 migration 日期造假。
- [十二個 pane 增加頁面高度與 controller 數量] → 沿用 lazy controller、共享 response、可見 pane 才渲染與既有清理機制。
- [active 主力 change 未來可能也修改群組規格] → 本 change 先以現行三群組完成；恢復 `add-mainforce-chip-subcharts` 前重新比對已歸檔主規格並 rebase delta，不直接覆蓋。

## Migration Plan

1. 先部署 additive D1 schema 與 Worker response，舊前端可忽略新欄位。
2. 對既有 watchlist items 建立 `itemId` 與 nullable metadata；缺少日期統一標記 `legacy_unknown`。
3. 回補或按需產生 TDCC 人數衍生欄位與估算融資資料，使用版本化 cache key，不覆寫 raw source。
4. 部署前端 registry、主圖線、副圖及清單 metadata UI；既有 pane／series 偏好保持不變。
5. 確認程式、D1 與 routes 不存在本 change 新增的績效追蹤、報酬計算或價格追蹤能力。
6. 以 fixtures、D1 migration、使用者隔離、實際 browser 互動及正式站 API／UI smoke 驗收。
7. 若需 rollback，先回退前端與 Worker；additive D1 metadata 欄位保留但不讀取，避免破壞既有清單。

## Open Questions

- 估算融資維持率上線前，仍須在實作階段確認可自動化且授權合適的融資成數來源與實際 schema；確認以前功能必須呈現缺值，不阻擋其他已具資料來源的項目。
