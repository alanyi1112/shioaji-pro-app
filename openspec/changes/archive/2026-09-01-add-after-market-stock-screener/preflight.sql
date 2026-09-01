-- 在一致性備份／staging 副本執行，不使用 immutable=1 忽略使用中資料庫的 WAL。
PRAGMA integrity_check;

-- 全部現有母體分類；這不是已驗證的全市場普通股名冊。
SELECT market, COUNT(*) AS active_catalog_count
FROM instrument_catalog WHERE active = 1 GROUP BY market;

-- 官方週資料的逐期覆蓋（不讀取個人清單或帳戶）。
SELECT data_date, COUNT(*) AS available_symbols
FROM taiwan_stock_shareholder_distribution
GROUP BY data_date ORDER BY data_date DESC LIMIT 3;

-- 工作範圍防擴張：僅核對彙總數，不修改 active 或佇列。
SELECT source, active, official_baseline, COUNT(*) AS symbol_count
FROM tdcc_continuous_symbols GROUP BY source, active, official_baseline;
SELECT status, COUNT(*) AS item_count
FROM tdcc_continuous_items GROUP BY status;
