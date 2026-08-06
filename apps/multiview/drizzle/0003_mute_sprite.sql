CREATE TABLE `taiwan_stock_chip_daily` (
	`symbol` text NOT NULL,
	`session_date` text NOT NULL,
	`exchange` text NOT NULL,
	`institutional_flow_json` text,
	`foreign_holding_json` text,
	`margin_short_json` text,
	`securities_lending_json` text,
	`provenance_json` text DEFAULT '{}' NOT NULL,
	`completeness_json` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`symbol`, `session_date`)
);
--> statement-breakpoint
CREATE INDEX `taiwan_stock_chip_daily_symbol_date_idx` ON `taiwan_stock_chip_daily` (`symbol`,`session_date`);--> statement-breakpoint
CREATE TABLE `taiwan_stock_chip_fetch_state` (
	`symbol` text NOT NULL,
	`dataset` text NOT NULL,
	`coverage_start` text,
	`coverage_end` text,
	`source_date` text,
	`status` text NOT NULL,
	`reason_code` text NOT NULL,
	`last_success_at` text,
	`last_attempt_at` text,
	`retry_after` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`symbol`, `dataset`)
);
--> statement-breakpoint
CREATE INDEX `taiwan_stock_chip_fetch_retry_idx` ON `taiwan_stock_chip_fetch_state` (`retry_after`);--> statement-breakpoint
CREATE TABLE `taiwan_stock_shareholder_distribution` (
	`symbol` text NOT NULL,
	`data_date` text NOT NULL,
	`levels_json` text NOT NULL,
	`adjustment_json` text NOT NULL,
	`total_json` text NOT NULL,
	`provider` text NOT NULL,
	`frequency` text DEFAULT 'weekly' NOT NULL,
	`source_fetched_at` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`symbol`, `data_date`)
);
--> statement-breakpoint
CREATE INDEX `taiwan_stock_shareholder_symbol_date_idx` ON `taiwan_stock_shareholder_distribution` (`symbol`,`data_date`);