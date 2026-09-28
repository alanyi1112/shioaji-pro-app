## Context

本機資料與程式有大量既有未提交變更。本輪只處理日 K 背景入口、籌碼失敗隔離及 PE 佇列，不執行 live 回補。

## Goals / Non-Goals

Goals：讓正式維護入口有界巡訪待處理商品、保留逐商品驗證與真實失敗資訊。
Non-Goals：不補造行情、不改既有交易與部署、不宣稱離線測試等同資料完整。

## Decisions

- 2026-09-17：heartbeat 在 compaction 後遺失當次指令，回到歷史收工。以 `maintenance-run-receipt.mjs` 將三組狀態寫入 git 忽略目錄，AGENTS 與 runbook 要求壓縮後先恢復。pending 拒絕 finish；progress／blocked／deferred 為 incomplete，不能等同驗收成功。此為專案端防護，不聲稱修復 Codex App 內部問題。

- 日 K 透過已有 loopback 與 secret 保護的 local-maintenance 新 action，沿用連續性 run/item lease、正式來源稽核；每次處理少量商品，本機 daily runner 有界接續，完成後可略過。
- 籌碼在查詢或下載前持久化每 dataset 嘗試時間；失敗也進入既有冷卻，防止同一商品反覆卡住。排程 eligibility 優先讀持久化商品，避免不必要的靜態 asset 依賴。
- PE 同一範圍重新入列保留原排序與 blocked/retry 邊界；成功但資料不足使用每日冷卻。領取只接受當次合法 universe，ETF 英文字尾同樣排除。
- 保留完整性判定與最後 verified 資料，使用隔離 SQLite 與 stub provider 驗證。

## Risks / Trade-offs

- 來源仍可能失敗 → 回傳 partial／retry，不能改成成功；實際回補另行驗收。
- 單次工作耗時 → 分批呼叫、最大批次數與既有 lease 限制。
- 已安裝 runtime 與 repo 不同 → 文件標註須同步 runtime 才啟用新增排程入口，不自動重啟。

## 2026-09-28 官方缺口回補設計

### 借券成交

- 使用 TWSE 借券中心 `/rwd/zh/lending/t13sa710` 的單日全市場回應；同一次回應同時涵蓋上市與上櫃商品，依「證券代號名稱」解析代號並彙總「成交數量(交易單位)」。
- 只有 `stat=OK`、欄位完全符合、全市場存在有效成交列且所有列日期等於請求交易日，才可把目標商品未出現分類為 `official_no_activity`。
- `official_no_activity` 只更新 fetch state 的官方核對日、成功時間與 reason code；`coverage_end` 仍代表最後一筆真實成交日，`taiwan_stock_chip_daily` 不寫入零值。
- 同交易日全市場下載以 single-flight 合併；成功核對後在 freshness 期間直接使用 D1 state，不因沒有資料列反覆請求。HTTP 429、5xx、欄位漂移、空市場回應或日期不符都 fail closed，保留舊資料與重試退避。

### 本益比歷史

- 對 TWSE 普通股逐月請求 `BWIBBU` 與 `STOCK_DAY`，沿用既有欄位名稱 parser，以同商品、同市場、同交易日配對官方本益比與收盤價。
- 每一 target 每輪最多處理固定少量尚未完成月份，請求間保留間隔；429 遵守 `Retry-After`，403、schema mismatch 或日期不符不標記完成。
- 官方月報有正本益比時，沿用受保護 ingest API 寫入 `official_verified` rows；月報有效但本益比皆為空白、`-`、零或負值時，以空 rows 完成該月 checkpoint，保存 `official_gap` 狀態，不產生樣本。
- 3055、3149 套用最近五年、至少 220 筆正值且涵蓋至少 300 個日曆日的雙重門檻。220 筆可讓 P5／P95 尾端各保留約 11 個觀測值；300 日跨度避免短期密集樣本誤通過。逐月官方核對完成後，條件不足可標示 `insufficient_history` 並停止無效重抓；3149 仍是普通股，不轉成永久 `not_eligible`。
- 已因舊歷史來源失敗而 blocked／partial 的 TWSE 普通股，只能透過受保護的 `multiview-pe-official <symbols>` 明確重新認領；不清 attempt、不重設完成月份，也不順帶認領未列出的工作。
- 月報先讀 `BWIBBU`；若整月 P/E 皆空白，直接保存 `official_gap` 而不再請求收盤月報。有正值才讀 `STOCK_DAY`。月份之間保留兩秒間隔，307／403 視為來源暫時不可用並停止該 target，不繞過來源保護。


## 2026-09-18 歷史 PE 來源驗證接續

依使用者已授權的實際補檔，使用官方歷史月份與同日官方收盤價核對既有FinMind歷史；最新PE空白的普通股仍保留歷史驗證機會。沿用0.01差異門檻、不把空白補成零；2026-09-28 起足量判定改為 220 筆正值且涵蓋至少 300 個日曆日。

真實TPEx月報使用「日 期」與114Q4，TWSE使用114年11月12日；解析器明確支援這些實際格式。歷史官方匯入成功後同步閒置job的complete／insufficient狀態與實際完成月份，保留attempt及正在執行的lease；latest_source_date與official_source_date不可因較舊歷史匯入而倒退。本機Vite直接使用repo，無需重啟；Cloudflare程式不在本次修正部署範圍。

## 2026-09-21 盤後 Shioaji 日線接續

Shioaji snapshot 與 365 日 Kbars 都能在數百毫秒內回應；空圖是前端先交付 Kbars、後交付 snapshot，而日線繪製又要求 snapshot 的順序競態。盤後沒有下一筆即時事件時，canonical 核對未通過的面板便永久停在空圖。coordinator 改為先交付 snapshot，再交付歷史；日線也可單憑有效 Kbars 建立收盤 quote，canonical 未核實只影響狀態，不再清空 Shioaji 圖。

365 日日線不再先建立約六萬筆分鐘 rich object 再聚合。coordinator 直接由 Shioaji 欄式陣列彙整每日 OHLCV／成交值，日線訂閱共用 frozen daily rows；分鐘／分時訂閱仍保留分鐘表示，指定日期查詢也使用獨立分鐘 cache identity。這可降低多圖初始化時間與 renderer 記憶體，且避免日線 cache 被單日分鐘驗證誤用。
