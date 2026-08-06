## Context

`add-taiwan-stock-pe-river-chart` 已完成 D1 估值 row／fetch state／durable job／month checkpoint、河流計算、私有 normalized ingest、API 與前端 overlay，但 production 歷史來源仍為 `history_source_unverified`。TWSE 與 TPEx 免費 OpenAPI 的 P/E endpoint 沒有日期參數，適合取得市場最新快照，不能直接要求逐檔五年歷史；一般歷史查詢頁面則不能在未經同意下自動下載。

FinMind 免費 API 提供 `TaiwanStockPER` 與 `TaiwanStockPrice` 的日期範圍查詢。2026-07-22 的 preflight 實測結果如下：

- `2330` 自 2021-07-22 至 2026-07-22 有 1,216 筆 `TaiwanStockPER`；2026-07-21 P/E 32.40 與 TWSE `BWIBBU_d` 相同。
- `8069` 同期間有 1,214 筆；2026-07-22 P/E 20.20 與 TPEx `tpex_mainboard_peratio_analysis` 相同。
- FinMind 可匿名呼叫，但免費額度有限，且使用條款不允許原始資料再散布或鏡像服務；本專案目前是 private／custom、owner-only 的非商業網站，只顯示衍生河流點與單日 readout。
- 政府資料開放授權條款第 1 版允許免授權金製作衍生產品，但必須顯名原資料提供機關。

現有 TDCC continuous backfill 已有私有 GitHub Actions、Sites 身分／bypass、durable queue、checkpoint、bounded retry、health 與逐商品狀態模式，可沿用控制面與安全邊界，但 P/E 資料必須使用獨立 workflow、rate budget 與 D1 狀態。

## Goals / Non-Goals

**Goals:**

- 零資料訂閱費完成上市／上櫃普通股最近五年本益比歷史 seed。
- 不依賴 panel 流量，在背景持續補足缺口與最新官方交易日。
- 以官方 OpenAPI 核對 FinMind 最近重疊日，並讓官方同日 row 優先。
- 沿用 D1 actual coverage、job dedupe、lease、checkpoint、retry-after 與安全 ingest，確保中斷可續跑。
- 嚴格控制匿名免費 API 額度，不因 1／4／8 圖或多使用者重複下載五年資料。
- 保留既有參考 EPS、五年 percentile、252 筆門檻、普通股日 K 與禁止同業比較的產品契約。
- 在 private／custom 存取模式下揭示來源與授權，且不提供原始五年資料 dump。

**Non-Goals:**

- 不購買 TWSE／TPEx Data E-Shop、TEJ 或其他付費資料。
- 不爬取 TWSE／TPEx 一般歷史網頁，不繞過驗證、限流或使用條款。
- 不把 FinMind 當成官方授權代理機構，不承諾公開／商業再利用權。
- 不提供 FinMind 原始資料轉售、下載、代理 API 或鏡像服務。
- 不以 MOPS 財報自行重建另一套 TTM EPS，也不改變現有交易所參考 EPS 定義。
- 不新增同業平均、產業 P/E、forward P/E、合理價、目標價或投資建議。

## Decisions

### 1. 使用「FinMind 歷史 seed＋官方每日快照」雙層來源

新增兩個 adapter：

- `FinMindPeHistoryAdapter`：對單一 `data_id` 各呼叫一次 `TaiwanStockPER` 與 `TaiwanStockPrice` 的 bounded 五年範圍，依 `date` join 後輸出 normalized rows。
- `OfficialPeDailyAdapter`：TWSE 使用 `BWIBBU_d`，TPEx 使用 `tpex_mainboard_peratio_analysis`。市場全量 response 以 exchange＋source date 做 single-flight／短期 cache，一次取得後服務多個 target。

歷史 adapter 解決五年 seed；官方 adapter 解決最新資料、財報年／季與來源核對。來源信任順序為：

1. `official_verified`：同日官方 OpenAPI row。
2. `finmind_overlap_verified`：FinMind provider 已在最近共同日期與官方數值核對，歷史 row 保留 FinMind provider 及原資料提供機關。
3. `finmind_pending_verification`：資料可暫存但未推進 verified coverage，也不提供正式河流圖。

替代方案是只用 FinMind；雖最簡單，卻失去最新官方核對與財報年／季補強。只用政府 OpenAPI則沒有免費五年 backfill，因此均不採用。

### 2. 歷史 row 只依日期 join，不假設兩個 FinMind dataset 同序

`TaiwanStockPER` 與 `TaiwanStockPrice` 先各自正規化為 `Map<sessionDate, row>`，再取日期交集。P/E 或 close 空白、零、負數、非有限值時保留 gap，不產生 `referenceEps`。FinMind 未提供 `fiscalYearQuarter` 時保存 `null` 與 `fiscal_period_unavailable`，未來同日官方 row 可冪等補上；不得依日期或 P/E 變動猜測財報季別。

替代方案是使用陣列 index zip，遇到停牌、缺列或來源補登時會錯配日期，因此不採用。

### 3. 最近共同交易日是 provider promotion gate

每個 exchange 的背景 lane 先取得官方最新快照，再在 FinMind 查詢該官方 `sourceDate`。相同 symbol 的正規化 P/E 與 close 必須在顯示精度容許範圍內一致：P/E absolute difference 不超過 0.01，收盤價 absolute difference 不超過 0.01；若官方欄位精度日後變更，必須以 fixture 與明確版本調整，不能放寬成比例誤差掩蓋來源差異。

核對通過後，該 symbol 當批歷史 seed 可標示 `finmind_overlap_verified`。核對失敗時保存 `source_mismatch`、隔離該 symbol、保留先前 verified rows，且不輸出上游 body。

官方落後 FinMind 時保存 `official_not_published`，等待下一次排程；不得把較新的 FinMind 日期冒充官方 verified。

### 4. 背景工作分成 latest lane 與 history lane，latest 永遠優先

新增私有 `pe-river-continuous-backfill` workflow，支援 `schedule` 與 `workflow_dispatch`，每次執行分為：

1. `latest` lane：先取得 TWSE／TPEx 市場最新快照，對所有 active PE target 寫入新官方 row、更新 provider overlap 與 actual source date。
2. `history` lane：從 D1 claim 少量 missing／insufficient target，以 FinMind 兩個 range request seed 五年資料，再按月份與固定 row 上限呼叫 private ingest。

排程在台灣交易日官方盤後資料通常發布後執行兩次，例如 Asia/Taipei 19:30 與 23:30；第二次作為延遲發布與暫時失敗的 retry window。週末、休市或來源日期未前進時只更新 heartbeat，不建立假 row。

API 首次勾選只 queue／dedupe target 並回傳目前狀態；若 scheduler heartbeat 過期，可沿用既有安全 dispatch 機制喚醒 workflow，但不得在 panel request 內同步下載完整五年。

替代方案是在 Worker `waitUntil` 內完成兩個五年 request 與約 2,400 列 D1 寫入；這可能跨越 execution／D1 batch 邊界，也較難在中斷後精確續跑，因此採私有 workflow＋分批 ingest。

### 5. 免費額度採全域 budget，不只做單 request sleep

匿名 FinMind 公開額度目前為每小時 300 requests。設計保守使用最多 240 requests／hour，保留 20% 餘裕；每個新 target 固定最多兩個五年 dataset request，因此每小時最多 claim 120 個全新 target，實際 workflow 再以 `MAX_HISTORY_TARGETS_PER_RUN = 8` 限制為每次最多 16 個主要來源 request。

budget、window start、used count 與 next retry 保存於 D1 fetch state／control state，不只存在 GitHub runner 記憶體。402、429 或上游 retry-after 會停止 claim 新 target；已成功 dataset／month checkpoint 不重抓。官方 daily snapshot 是每市場單一 request，不計入 FinMind budget。

若 FinMind 公開額度日後降低，以實際 response 與設定值的較嚴者為準。免費 token 不是必要條件；本變更不要求新增帳號秘密。

### 6. D1 row 與 job 使用明確來源優先序與續跑狀態

現有四類 table 保留；若缺少欄位，使用 additive migration 補上：

- valuation row：`provider`、`originalSource`、`validationStatus`、`officialOverlapDate`。
- fetch state／job：`lane`、`latestSourceDate`、`providerVerifiedAt`、`budgetWindowStart`、`budgetUsed`。
- month checkpoint：dataset／月份／ingest cursor／row count／status／attempt／next retry。

upsert 比較來源優先序、session date 與 fetched timestamp；官方 row 可補強同日 FinMind metadata，FinMind retry 不得覆蓋官方 row。actual coverage 只由有限正數 P/E／close／reference EPS row 計算，requested range 與 provider 最新日期不直接成為 coverage。

### 7. 私有 ingest 維持雙重授權與 bounded payload

GitHub workflow 只把 normalized、按月份分批的 rows 送到既有估值 private ingest。Production request 必須同時通過 Sites 身分／bypass 與估值 ingest secret；payload 驗證 canonical symbol、market、單一月份、唯一日期、row count、有限值與最大 body。帳號、token、cookie、bypass、secret 與上游 body 不得進 repo、OpenSpec、response 或 log。

FinMind 匿名模式不需要新 token。若未來改用免費註冊 token，必須另行做授權與秘密管理變更，不在本次偷偷加入。

### 8. 顯名與非鏡像限制由 response metadata 與 UI 共同落實

`sources` 新增 intermediary／original provider／license／source date／validation status，但河流公開 API 只回傳衍生 multipliers、river points、coverage 與 pointed-date 所需欄位，不提供可重建完整 FinMind dataset 的通用 raw export。

上市 readout 標示「原資料提供機關：臺灣證券交易所」「歷史資料介接：FinMind」；上櫃對應為「證券櫃檯買賣中心」。說明區連結政府資料開放授權，且不得暗示 FinMind 是官方代理機構。

部署 preflight 必須確認 Sites 仍為 private／custom。若改成 public、workspace-wide 或商業用途，FinMind free pipeline 進入 `license_review_required`，不得沿用目前結論直接發布。

### 9. 健康狀態同時呈現歷史完整度與最新資料新鮮度

health 分開計算：

- history：target／ready／insufficient／missing／running／blocked。
- latest：fresh／pending publication／retry waiting／stale／source mismatch。
- scheduler：heartbeat、last latest run、last history run、claimed／completed count。
- budget：安全的 used／limit／window end 數字，不包含憑證。

單一商品 API 的 `backfill` 同時回傳 lane、checkpoint、next retry 與 actual dates。歷史樣本足夠但 latest 暫待發布時仍可用舊 verified river，並顯示 stale／pending warning；來源 mismatch 不清除舊資料。

## Risks / Trade-offs

- [FinMind 免費服務或條款日後變更] → 將 provider 與 licensing 狀態放入 health；條款、額度或 dataset 改變時 fail closed，保留 D1，不回退 scraping。
- [FinMind 歷史值與官方重疊日不一致] → 每個 symbol 以最近共同日作 promotion gate；mismatch 隔離商品，不影響其他 target。
- [免費匿名 IP 額度由多個 runner 共用] → D1 全域 budget、workflow concurrency singleton、每批 8 targets、402／429 retry-after，避免只靠 runner sleep。
- [GitHub cron 可能延遲] → 每日兩個盤後窗口、scheduler stale health、首次互動可安全 dispatch；coverage 永遠依 source date，不依 cron 時間宣稱最新。
- [FinMind 沒有歷史財報年／季] → 保存 `null` 與明確 unavailable，官方新 row 往後補足；不推測、不阻擋河流核心計算。
- [約 2,400 列 seed 超出單次 ingest／D1 batch] → 按月份與固定 row 數分批、checkpoint cursor、冪等 upsert，中斷後續跑。
- [私人站未來改公開] → deploy gate 要求重新做 FinMind 授權審查；在此之前維持 custom access。
- [原始資料再散布風險] → 無 raw history endpoint，API 只提供衍生河流與必要單日 readout，來源與授權固定顯名。

## Migration Plan

1. 新增 FinMind 與官方 daily adapter、fixtures、source normalization／overlap verification 純函式及 additive D1 migration。
2. 擴充 private ingest、job claim、latest／history runner 與 health，但維持 frontend production source fail-closed。
3. 新增私有 workflow，以測試 target 手動執行：先 latest、後 history，確認 D1 checkpoint／actual coverage／budget／retry。
4. 對 `2330.TW` 與一檔 `.TWO` 完成真實五年 seed，核對最近共同日，驗證至少 252 筆、河流倍率與來源顯名。
5. 啟用排程，確認沒有 panel 流量時仍能補入新的官方交易日；再完成 1／4／8 圖、快速切換與實際 PNG 下載驗收。
6. 完成原 change 剩餘 tasks，先歸檔 `add-taiwan-stock-pe-river-chart` 使主 capability 落地，再歸檔本 change；重新 strict validate、commit、push、部署 private Sites 並做正式驗收。
7. rollback 時停用 PE workflow／dispatch 與 frontend source enable flag，保留 additive D1 rows／checkpoint 供診斷；不得 destructive delete 已保存資料。

## Open Questions

- FinMind 免費方案目前適合 private／custom 非商業衍生圖表，但條款可能更新；每次正式發布前仍須重新確認服務條款與 access mode。
- GitHub cron 的最適執行時間可依一週實際 TWSE／TPEx `sourceDate` 觀察調整；不論時間如何調整，latest lane 優先與每日兩個 retry window 的契約不變。
