CREATE TABLE `instrument_catalog` (
	`symbol` text NOT NULL,
	`exchange` text NOT NULL,
	`localized_name` text NOT NULL,
	`english_name` text DEFAULT '' NOT NULL,
	`aliases_json` text DEFAULT '[]' NOT NULL,
	`normalized_search` text NOT NULL,
	`market` text NOT NULL,
	`group_name` text NOT NULL,
	`quote_type` text DEFAULT '' NOT NULL,
	`provider` text DEFAULT 'yfinance' NOT NULL,
	`source` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`source_updated_at` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`symbol`, `exchange`)
);
--> statement-breakpoint
CREATE INDEX `instrument_catalog_symbol_idx` ON `instrument_catalog` (`symbol`);--> statement-breakpoint
CREATE INDEX `instrument_catalog_source_idx` ON `instrument_catalog` (`source`);--> statement-breakpoint
CREATE INDEX `instrument_catalog_normalized_idx` ON `instrument_catalog` (`normalized_search`);