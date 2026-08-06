CREATE TABLE `tdcc_backfill_dispatches` (
	`symbol` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`requested_at` text NOT NULL,
	`cooldown_until` text,
	`last_error_code` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tdcc_backfill_dispatches_status_idx` ON `tdcc_backfill_dispatches` (`status`,`cooldown_until`);