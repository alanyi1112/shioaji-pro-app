## Context

「選股篩選」目前以 immutable snapshot 對約 1,974 檔上市／上櫃普通股執行成交量、TDCC 與技術條件。籌碼副圖另有 `taiwan_stock_chip_daily`、`taiwan_stock_shareholder_distribution` 與 provider adapter，但其生命週期是依自選／圖表需求逐商品暖機；2026-09-14 的本機證據只有 56 檔日籌碼歷史、2026-09-11 只有 53 檔，不能作為全市場選股底稿。現有全市場選股 snapshot 也必須先恢復到最近完整交易日，不能讓新條件建立在 stale base 上。

本 change 橫跨官方來源、D1 schema、盤後 collector／publisher、純計算 domain、results API、偏好遷移與 React UI。資料頻率同時包含每日交易資料與 TDCC 官方週資料；所有判定都必須保存 source date、coverage 與公式證據，並沿用既有 `pass`／`fail`／`unknown` 三態及 `effectiveSessionDate` fail-closed 發布責任。

## Goals / Non-Goals

**Goals:**

- 以官方全市場批次資料支援投信、融資融券及 TDCC 籌碼條件，不依賴需求驅動的 53 檔 cache。
- 實作 proposal 所列八項條件、全域 AND／OR、穩定排序、偏好遷移、可追溯 evidence 與「長線佈局」draft 預設。
- 將每日籌碼、官方普通股母體、日 K 與 TDCC 週期對齊至可重現的 immutable snapshot。
- 對來源未發布、日期不相鄰、schema drift、分母無效、全市場 coverage 不足及歷史不足保持 `unknown` 或保留最後合法 snapshot。
- 讓查詢只讀既有 snapshot；使用者開啟、查詢、重整或翻頁不得直接觸發 provider request。

**Non-Goals:**

- 不實作券商分點主力連買、買賣家數差、主力未賣超或投信實際持股初次認養。
- 不把外資、投信、自營商或三大法人買賣超重新命名為「主力」。
- 不新增盤中即時選股、行情訂閱、通知、觀察清單自動寫入或交易能力。
- 不改變 160 檔盤中量比驗證、Shioaji runtime、smart-order、simulation／production 或 broker write 邊界。
- 不用缺日補零、forward-fill、requested date 或不同市場的成功結果補造完整資料。

## Decisions

### 1. 建立選股專用的全市場籌碼資料層

新增 additive D1 tables 保存 daily chip run、逐市場 receipt、canonical symbol row、coverage 與發布 head；具體名稱由 migration 決定，但必須與需求驅動的 `taiwan_stock_chip_daily` 分離。TDCC 週資料重用已驗證的 `screener_tdcc_weekly`／`taiwan_stock_shareholder_distribution` material rows，不複製或降低既有 provenance。

理由是選股發布需要「同一交易日、完整母體、兩市場同時通過」的原子責任，而籌碼副圖允許單一商品 partial cache。共用 normalizer 與欄位定義可以避免公式漂移，但不能共用 completion claim。

替代方案是直接擴充 `taiwan_stock_chip_daily` 並逐檔補齊；這會把 1,974 檔乘上 provider calls、混合圖表 target 與全市場 coverage，也會讓局部 cache 看似全市場完成，因此不採用。

### 2. 每市場、每交易日各抓一次官方批次報表

TWSE 投信使用 T86、融資融券使用 MI_MARGN；TPEx 使用已驗證可指定日期的三大法人與融資融券官方報表。collector 以 official trading-session plan 逐日期取得完整市場 payload，先驗 schema、report date、duplicate、ordinary-stock universe coverage、row material hash，再 staging。每一 market／dataset／date 最多一個 current receipt，重跑只接受 material 相同或具來源較新且仍通過驗證的修正版。

不以 per-symbol FinMind request 作為全市場主路徑。FinMind 或既有副圖 cache 可供診斷，但沒有全市場、同一期 receipt 時不得參與選股發布。

### 3. 已發行普通股數屬於帶日期的母體證據

擴充 `UniverseStock`／screener universe payload，保存 canonical non-negative integer `issuedCommonShares`、官方報表日期、來源與 normalization version。投信比率只可使用不晚於 `effectiveSessionDate`、對應同一商品且大於零的普通股數；公司增資、減資或市場轉換後，新的 universe revision 必須建立新 snapshot，舊 snapshot 不得被新分母重算。

不使用 `foreignHolding.issuedShares` 作主分母，因現有 coverage 僅限被暖機商品且 TWSE／TPEx provider 語意不一致。

### 4. 每日與每週資料使用不同 anchor，但共同綁定 snapshot

每日投信、融資融券及 OHLCV 必須以相同 `effectiveSessionDate` 結束，所需 lookback 必須是官方交易日序列中的相鄰 sessions。TDCC 使用不晚於該日且已完成全市場 coverage 的最新官方週期，連續週條件只接受 official period plan 中相鄰 4–10 日的週資料。

publisher 先建立 candidate snapshot，逐一驗證 TWSE、TPEx、universe revision、daily chip dates、OHLCV dates、TDCC periods、row counts、hash 與逐條件暖機需求，再以單一 publication head 原子切換。任一必要 gate 不成立時保留前一 snapshot 並回報 pending／stale；不得發布 mixed-session rows。

### 5. 八項條件使用固定 canonical 公式

- 千張大戶固定為 TDCC 第 15 級「1,000,001 股以上」。比例區間以最新週 ratio 判斷，連續上升要求每一個相鄰週差都大於可設定的最小百分點。
- 大戶籌碼集中要求同一組相鄰週轉換中 holders 減少且 shares 增加；任一欄缺漏都為 `unknown`。
- 散戶固定為 TDCC 第 1–3 級合計「10 張以下」，要求 ratio 在每個相鄰週轉換下降。
- 投信比率為 N 個相鄰交易日 `investmentTrustNetShares` 的 signed sum 除以 snapshot 綁定的 `issuedCommonShares`，再乘 100；N 限 5–10，門檻比較要求累計值為正。
- 股價／融資條件比較同一 N-session lookback 的端點：目前收盤價大於起點收盤價，且目前融資餘額小於或等於起點餘額。
- 券資比為同一交易日 `shortTodayBalanceLots / marginTodayBalanceLots * 100`；融資餘額為零或任一欄無效時為 `unknown`，不回傳 Infinity 或零。
- 近期新高使用目前收盤價嚴格大於前 N-1 個相鄰交易日收盤價；N 限 2–120。
- 均線突破要求前一交易日收盤價小於或等於該日 SMA，且目前收盤價大於目前 SMA；period 只允許 5、10、20、60。它與既有「均線糾結／黃金交叉」是不同條件與 evidence。

所有十進位門檻以 canonical scaled integer 或 decimal string 比較，不用 IEEE-754 邊界四捨五入決定 pass／fail。

### 6. criteria 與偏好升級為 v5，沿用全域三態組合

新增條件預設關閉，合法 v4 偏好單向遷移為 v5，保留既有條件、組合、排序與 result state。新 criteria 參與 fingerprint；隱藏、停用或不適用欄位不得帶入指紋。未知版本、額外 query key、非法枚舉與超界數值一律拒絕。

沿用既有全域 `all`／`any`：`all` 中任一 fail 即 fail，沒有 fail 但有 unknown 則 unknown；`any` 中任一 pass 即 pass，沒有 pass 但有 unknown 則 unknown。這讓新條件和既有成交量／技術條件可重現組合，不引入本次未要求的巢狀規則編輯器。

### 7. 查詢前預先計算 bounded feature，結果只讀 snapshot

publisher 為每個 snapshot row 保存或可由同 snapshot bounded rows重建的 canonical chip／price feature；results route 不在每次分頁查詢掃描原始 provider history，也不觸發 I/O side effect。結果 response 包含 criteria fingerprint、formula／mapping version、daily／weekly anchors、逐條件 counts、每列 evidence hash 與可讀 evidence。

排序 key 與 cursor 綁定 snapshot ID、criteria fingerprint、sort、direction、result state 及 limit。snapshot 被取代時，既有 cursor 只能完成同 snapshot 分頁或明確回報 expired，不混入新資料。

### 8. 「長線佈局」只是一組可檢查的 draft

預設將千張大戶比例連續三週上升、10 張以下散戶比例下降與股價上漲／融資下降或持平設為 enabled，組合設為 `all`；不設定文件沒有明示的報酬或勝率。套用後 UI 標示尚未提交，使用者仍可修改參數並按「開始篩選」。系統不得把預設名稱或文件敘述當作投資建議或驗收證據。

## Risks / Trade-offs

- [TPEx 歷史報表 schema 或下載流程改變] → 保存實際 fixture、欄位 allowlist、report date 與 payload hash；未知 envelope fail closed，scheduler 依 cooldown 有界重試。
- [兩市場發布時間不同造成 mixed session] → 分市場 receipts 與單一 atomic publication head；較快市場完成時只顯示 readiness，不發布半套結果。
- [TDCC 最新週只有追蹤清單資料] → 以 screener universe exact coverage 驗證完整週；53 檔 current rows 不得取代較舊的完整全市場週期。
- [公司股本在區間內變更] → 分母綁定 snapshot universe revision 與 as-of date；不以目前股本回算舊日投信比率。
- [條件數增加使 snapshot 或查詢變慢] → ingestion 批次化、feature 預先計算、bounded lookback、索引與 immutable pagination；驗收記錄 build time、row count、DB growth 與 API latency。
- [partial history 讓新上市／停牌商品大量 unknown] → 逐商品分類 `insufficient_history`、`suspended`、`missing_source_row` 等原因，不補造交易日或數值。
- [既有 dirty worktree 與其他 changes 交錯] → 實作時精準限制在本 change 檔案與對應程式，驗證、stage、archive、commit 均維持分開授權。

## Migration Plan

1. 新增 additive D1 migration、receipt／run／row／publication tables 與索引；先在 staging DB 驗 schema、integrity 與現有個人資料 hash。
2. 擴充 universe parser 與 snapshot payload保存 `issuedCommonShares`，但維持目前 v4 API 為 active。
3. 以官方來源回補至少 10 個相鄰交易日的全市場投信與融資融券資料，重用 verified TDCC periods，產出逐市場 coverage report。
4. 建立 v5 domain、feature、publisher、repository、results／status contract；只有完整 staging snapshot 通過才切換 v5 publication head。
5. 加入 v5 UI 與偏好遷移；新條件預設關閉，既有使用者首次載入行為不變。
6. 完成 unit、integration、migration、API、browser、窄版面／鍵盤、stale／partial、效能與本機 D1 真實資料驗收後，才將 v5 視為可用。
7. rollback 時 UI 回到 v4 route 與 preference，publication head 回到最後合法 v4 snapshot；additive tables 保留供診斷，不刪除或回寫既有資料。

## Open Questions

- 無。公式、參數範圍與資料邊界由本 design 與 specs 固定；若未來取得券商分點或投信實際持股資料，必須另開 change 定義來源、授權、coverage 與不同名稱的條件。
