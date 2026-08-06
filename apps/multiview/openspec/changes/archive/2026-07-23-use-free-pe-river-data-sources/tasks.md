## 1. 免費來源契約與 preflight

- [x] 1.1 實測 FinMind v4 `TaiwanStockPER`／`TaiwanStockPrice` 對 `2330`、一檔 `.TWO` 普通股、ETF、負 P/E／缺值與少於五年商品的日期範圍、schema、row count、更新日期及錯誤 contract，保存不含秘密的最小 fixtures。
- [x] 1.2 實測 TWSE `BWIBBU_d` 與 TPEx `tpex_mainboard_peratio_analysis` 的市場全量 schema、source date、商品代號、P/E、收盤價與財報年／季可得性，保存官方 fixtures 並確認 endpoint 沒有歷史日期參數。
- [x] 1.3 對 `2330` 與一檔 `.TWO` 的最近共同交易日交叉核對 FinMind／官方 P/E 與收盤價，建立 0.01 顯示精度容許及 mismatch fixture。
- [x] 1.4 更新資料來源研究文件，記錄政府資料開放授權顯名義務、FinMind 免費額度／非鏡像限制、private／custom 非商業邊界、查核日期與條款變更時 fail-closed 規則。

## 2. Source adapter 與正規化核心

- [x] 2.1 實作 `FinMindPeHistoryAdapter`，以匿名免費 v4 API 對單一商品各發出一個 bounded `TaiwanStockPER`／`TaiwanStockPrice` range request，限制日期、timeout、payload 大小與安全錯誤碼。
- [x] 2.2 依 `sessionDate` Map join FinMind P/E／close，實作有限正數驗證、gap、`referenceEps = close / PER`、provider／original source metadata 與 `fiscal_period_unavailable`，不得依陣列順序或猜測財報季別。
- [x] 2.3 實作 `OfficialPeDailyAdapter`，以 exchange＋source date single-flight／cache 解析 TWSE／TPEx 市場最新快照，官方資料未發布時保留實際 source date。
- [x] 2.4 實作 provider overlap verifier：最近共同交易日 P/E／close 各以 absolute difference 0.01 核對，輸出 `official_verified`、`finmind_overlap_verified`、`official_not_published` 或 `source_mismatch`。
- [x] 2.5 建立來源信任優先序與 merge 純函式，確保官方同日 row 可補強 FinMind metadata，較舊／較低信任資料不得覆蓋官方 verified row。
- [x] 2.6 為 `.TW`／`.TWO`、停牌、缺列、重複日期、亂序、schema drift、負 P/E、官方延遲與 mismatch 建立單元測試。

## 3. D1 schema、coverage 與免費額度狀態

- [x] 3.1 檢查既有四類 P/E table，使用 additive Drizzle migration 補上 provider、original source、validation status、official overlap date、lane、latest source date、budget window／used 與 ingest cursor 等必要欄位，不刪改既有估值與籌碼資料。
- [x] 3.2 擴充 D1 repository 的來源優先序冪等 upsert、按 provider／validation 查詢、actual valid coverage、missing periods 與最新 source date 計算；requested range 不得成為 coverage。
- [x] 3.3 實作 D1 全域 FinMind request budget，預設安全上限 240 requests／hour、window rollover、原子 reserve／release 與 `rate_limit_waiting`／next retry。
- [x] 3.4 擴充 month／dataset checkpoint，分別保存 PER、price、normalized ingest 的 status、row count、cursor、attempt、lease 與 next retry，retry 不重抓已成功 dataset。
- [x] 3.5 建立 migration／repository 測試，涵蓋重跑同一五年 seed、官方覆蓋 FinMind 同日 row、partial month、budget 競爭、lease 過期續跑與保留既有 coverage。

## 4. Latest／history 耐久背景控制面

- [x] 4.1 擴充 P/E target discovery，從已啟用商品目錄／清單去重合資格普通股，保留 canonical exchange／symbol，排除 ETF、ETN、TDR、指數、特別股與非日 K。
- [x] 4.2 實作 latest-first planner：每次 run 先規劃所有 active target 的官方最新快照，再以 actual coverage、樣本數、missing periods 與 retry-after 規劃 history targets。
- [x] 4.3 實作 lane-aware job claim、single-flight、owner／lease、checkpoint continuation 與同 symbol dedupe，使首次勾選、排程與重複 panel request 共用同一進度。
- [x] 4.4 實作 latest lane：每市場只抓一次官方快照，分配給所有 target，冪等補入新交易日、更新 overlap／source date；休市或未發布只更新 heartbeat／retry，不補造 row。
- [x] 4.5 實作 history lane：每 run 最多 claim 8 個 target，每商品最多兩個主要 FinMind range request，按月份與 bounded row count 分批 normalized ingest，服務中斷後從 cursor／checkpoint 續跑。
- [x] 4.6 對 402、429、retryable 5xx、timeout、schema mismatch、source mismatch 與 non-retryable eligibility 錯誤實作隔離、bounded backoff、來源 retry-after 優先與 allowlist reason code。
- [x] 4.7 為「沒有 panel 流量仍補最新日」、latest lane 優先、官方延遲後第二窗口補入、history 中斷續跑、重複觸發不重耗額度及單商品錯誤不阻塞其他商品建立整合測試。

## 5. 私有 runner、ingest 與 GitHub Actions

- [x] 5.1 擴充私有 P/E control／claim／ingest／complete endpoint，production 必須同時驗證 Sites 身分／bypass 與估值 ingest 授權，payload 限制單商品、單月份、唯一日期、合理 row count 與 body 大小。
- [x] 5.2 新增 repo 內 runner script，依序執行 latest、provider overlap、history claim、FinMind anonymous fetch、分批 ingest 與 complete／failure回報；stdout／stderr 只輸出安全摘要。
- [x] 5.3 新增私有 `pe-river-continuous-backfill` GitHub Actions workflow，設定最小 permissions、singleton concurrency、timeout、兩個台灣盤後 cron window 與 `workflow_dispatch`，不得固定商品清單或把秘密寫入 repo／log。
- [x] 5.4 沿用安全 dispatch 機制：scheduler heartbeat stale 時，首次勾選只 queue／dedupe 並可喚醒 workflow，不在 panel request 內同步下載五年或等待完整 ingest。
- [x] 5.5 建立 workflow／runner contract 測試，確認 latest 永遠先於 history、每 run 最多 8 個 history targets、匿名模式不要求 FinMind token、budget 用盡停止 claim 且既有 D1 仍可讀。

## 6. API、health、來源顯名與前端狀態

- [x] 6.1 擴充河流 API `sources`／`coverage`／`warnings`／`backfill`，區分 intermediary、original provider、license、validation、lane、checkpoint、official source date 與 next retry，不回傳通用五年 raw dump。
- [x] 6.2 擴充 health，分開揭示 history target／ready／insufficient／missing／running／blocked、latest fresh／pending／retry／stale／mismatch、scheduler heartbeat 與安全 budget used／limit／window end。
- [x] 6.3 更新 readout／說明：上市標示臺灣證券交易所、上櫃標示證券櫃檯買賣中心，另標示「歷史資料介接：FinMind」與政府資料開放授權；不得稱 FinMind 為官方代理機構。
- [x] 6.4 新增 private／custom access 與非商業 deploy preflight；若 access mode 改為 public／workspace-wide 或用途轉為商業，標示 `license_review_required` 並阻止直接沿用本次免費來源結論。
- [x] 6.5 為 available、historical seed、official pending、rate-limit waiting、source mismatch、stale D1、財報年／季 unavailable 與禁止 raw history export 建立 API／frontend contract 測試。

## 7. 真實回補、背景最新資料與瀏覽器驗收

- [x] 7.1 在本機 preview 對 `2330.TW` 與一檔 `.TWO` 執行真實 FinMind 五年 seed，確認各至少 252 筆、actual coverage、最近官方 overlap、D1 重載 cache hit 與無秘密資料。
- [x] 7.2 驗證 ETF、不足 252 筆、負 P/E、官方尚未發布、FinMind 限流與 source mismatch，確認 K 線保持可用且不啟動未授權 fallback。
- [x] 7.3 手動執行私有 workflow，確認 latest lane、history lane、checkpoint 續跑、budget、heartbeat 與個別商品 health；不得只以 workflow success 取代 D1 coverage 驗證。
- [x] 7.4 以真實無 panel 的 `event=schedule` 驗證排程與第二窗口 retry／錯誤隔離，再以官方到齊後相同 runner 的成功 private run 驗證 TWSE／TPEx 新 source date 寫入 D1；兩段證據必須分開揭示，不得把 `workflow_dispatch` 冒充 schedule。cron 剛好與新官方日期重合改列持續營運監看，不再阻塞功能歸檔。
- [x] 7.5 以 browser 驗證 1／4／8 圖的首次回補狀態、完成後五線四帶、crosshair attribution、快速換商品 latest-wins、週 K、ETF、不適用 cleanup，以及實際下載並開檔確認完整 panel PNG。

## 8. 整合原變更、品質門檻與正式交付

- [x] 8.1 更新 `add-taiwan-stock-pe-river-chart` 的來源文件、verification 與 tasks：免費 workflow 完成後勾選 4.3，真實 browser／PNG 完成後勾選 7.3，正式發布驗收後才勾選 7.5。
- [x] 8.2 執行 `npm run lint`、完整 `npm test`、`openspec validate --all --strict` 與 `git diff --check`，保存可重現驗證結果並確認沒有帳號、token、cookie、憑證或其他秘密值。
- [x] 8.3 先歸檔 `add-taiwan-stock-pe-river-chart` 使主 capability 落地，再歸檔 `use-free-pe-river-data-sources`；每次歸檔後重新 strict validate 與 `git diff --check`。
- [x] 8.4 commit 並推送 GitHub／Sites source，保存與完整 HEAD 相同的 Sites version，確認正式站仍為 private／custom 後部署。
- [x] 8.5 以 Sites control plane、正式 HTML／JS／API／health、已登入 browser 與背景排程交叉驗證河流圖、免費來源顯名、五年 coverage、最新 source date、未勾選無 request 與匿名 `401` 邊界，再同步 Obsidian 收工紀錄。
