CREATE TABLE `candle_history_state` (
	`provider` text NOT NULL,
	`symbol` text NOT NULL,
	`interval` text NOT NULL,
	`full_window_complete` integer DEFAULT 0 NOT NULL,
	`coverage_start` integer,
	`coverage_end` integer,
	`available_rows` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`reason_code` text,
	`last_full_fetch_at` text,
	`last_tail_fetch_at` text,
	`retry_after` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`provider`, `symbol`, `interval`)
);
--> statement-breakpoint
CREATE INDEX `candle_history_state_retry_idx` ON `candle_history_state` (`status`,`retry_after`);