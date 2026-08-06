CREATE TABLE IF NOT EXISTS `taiwan_stock_pe_control` (
	`control_key` text PRIMARY KEY NOT NULL,
	`scheduler_heartbeat_at` text,
	`last_latest_run_at` text,
	`last_history_run_at` text,
	`latest_twse_source_date` text,
	`latest_tpex_source_date` text,
	`budget_window_start` text,
	`budget_used` integer DEFAULT 0 NOT NULL,
	`budget_limit` integer DEFAULT 240 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
-- 既有 Sites D1 可能已由 runtime ensureDb 建立上述 table 與 additive columns。
-- 欄位升級統一交由 ensurePeRiverPipelineColumns 先檢查 PRAGMA table_info 後再新增，
-- 避免部署時因重複 table／column 中止 migration；本檔保留為安全的 migration marker。
