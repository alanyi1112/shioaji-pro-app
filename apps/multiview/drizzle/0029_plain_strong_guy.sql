CREATE TABLE `screener_daily_ohlcv` (
	`symbol` text NOT NULL,
	`data_date` text NOT NULL,
	`market` text NOT NULL,
	`open` text NOT NULL,
	`high` text NOT NULL,
	`low` text NOT NULL,
	`close` text NOT NULL,
	`currency` text NOT NULL,
	`price_basis` text NOT NULL,
	`mapping_version` text NOT NULL,
	`source_url` text NOT NULL,
	`payload_hash` text NOT NULL,
	`fetched_at` text NOT NULL,
	`validation` text NOT NULL,
	PRIMARY KEY(`data_date`, `symbol`)
);
--> statement-breakpoint
CREATE INDEX `screener_daily_ohlcv_market_date_idx` ON `screener_daily_ohlcv` (`market`,`data_date`);--> statement-breakpoint
CREATE INDEX `screener_daily_ohlcv_symbol_date_idx` ON `screener_daily_ohlcv` (`symbol`,`data_date`);--> statement-breakpoint
CREATE INDEX `screener_snapshots_schema_status_idx` ON `screener_snapshots` (`schema_version`,`status`,`created_at`);