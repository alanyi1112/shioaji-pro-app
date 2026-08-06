CREATE TABLE IF NOT EXISTS `candle_history` (
	`provider` text NOT NULL,
	`symbol` text NOT NULL,
	`interval` text NOT NULL,
	`time` integer NOT NULL,
	`open` real NOT NULL,
	`high` real NOT NULL,
	`low` real NOT NULL,
	`close` real NOT NULL,
	`volume` real DEFAULT 0 NOT NULL,
	`quote_time` integer,
	`source` text NOT NULL,
	`source_updated_at` text,
	`market_session` text,
	`source_time_zone` text,
	`fetched_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`provider`, `symbol`, `interval`, `time`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `candle_history_lookup_idx` ON `candle_history` (`provider`,`symbol`,`interval`,`time`);
