CREATE TABLE `cache_maintenance_state` (
	`maintenance_key` text PRIMARY KEY NOT NULL,
	`last_run_at` text,
	`deleted_rows` integer DEFAULT 0 NOT NULL,
	`remaining_rows` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'not_run' NOT NULL,
	`reason_code` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `candle_cache_expires_at_idx` ON `candle_cache` (`expires_at`);