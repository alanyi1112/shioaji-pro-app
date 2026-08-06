CREATE TABLE `taiwan_stock_pe_backfill_job` (
	`job_id` text PRIMARY KEY NOT NULL,
	`exchange` text NOT NULL,
	`symbol` text NOT NULL,
	`target_start` text NOT NULL,
	`target_end` text NOT NULL,
	`status` text NOT NULL,
	`reason_code` text NOT NULL,
	`total_months` integer DEFAULT 0 NOT NULL,
	`completed_months` integer DEFAULT 0 NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`lease_owner` text,
	`lease_expires_at` text,
	`retry_after` text,
	`last_success_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `taiwan_stock_pe_job_symbol_idx` ON `taiwan_stock_pe_backfill_job` (`exchange`,`symbol`);--> statement-breakpoint
CREATE INDEX `taiwan_stock_pe_job_queue_idx` ON `taiwan_stock_pe_backfill_job` (`status`,`retry_after`,`lease_expires_at`);--> statement-breakpoint
CREATE TABLE `taiwan_stock_pe_backfill_month` (
	`job_id` text NOT NULL,
	`exchange` text NOT NULL,
	`symbol` text NOT NULL,
	`target_month` text NOT NULL,
	`status` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_owner` text,
	`lease_expires_at` text,
	`retry_after` text,
	`error_code` text,
	`completed_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`exchange`, `symbol`, `target_month`)
);
--> statement-breakpoint
CREATE INDEX `taiwan_stock_pe_month_queue_idx` ON `taiwan_stock_pe_backfill_month` (`status`,`retry_after`,`lease_expires_at`);--> statement-breakpoint
CREATE TABLE `taiwan_stock_pe_fetch_state` (
	`exchange` text NOT NULL,
	`symbol` text NOT NULL,
	`requested_start` text,
	`requested_end` text,
	`coverage_start` text,
	`coverage_end` text,
	`source_date` text,
	`status` text NOT NULL,
	`reason_code` text NOT NULL,
	`last_success_at` text,
	`last_attempt_at` text,
	`retry_after` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`exchange`, `symbol`)
);
--> statement-breakpoint
CREATE INDEX `taiwan_stock_pe_fetch_retry_idx` ON `taiwan_stock_pe_fetch_state` (`status`,`retry_after`);--> statement-breakpoint
CREATE TABLE `taiwan_stock_pe_valuation_daily` (
	`exchange` text NOT NULL,
	`symbol` text NOT NULL,
	`session_date` text NOT NULL,
	`official_close` real NOT NULL,
	`official_pe_ratio` real NOT NULL,
	`reference_eps` real NOT NULL,
	`fiscal_year` text,
	`fiscal_quarter` text,
	`source` text NOT NULL,
	`source_date` text NOT NULL,
	`fetched_at` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`exchange`, `symbol`, `session_date`)
);
--> statement-breakpoint
CREATE INDEX `taiwan_stock_pe_valuation_lookup_idx` ON `taiwan_stock_pe_valuation_daily` (`symbol`,`session_date`);