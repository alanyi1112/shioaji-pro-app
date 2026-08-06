CREATE TABLE `tdcc_continuous_items` (
	`symbol` text NOT NULL,
	`data_date` text NOT NULL,
	`status` text NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_owner` text,
	`lease_expires_at` text,
	`next_retry_at` text,
	`error_code` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`symbol`, `data_date`)
);
--> statement-breakpoint
CREATE INDEX `tdcc_continuous_items_queue_idx` ON `tdcc_continuous_items` (`status`,`next_retry_at`,`priority`,`created_at`);--> statement-breakpoint
CREATE INDEX `tdcc_continuous_items_lease_idx` ON `tdcc_continuous_items` (`lease_expires_at`);--> statement-breakpoint
CREATE TABLE `tdcc_continuous_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`latest_data_date` text,
	`target_count` integer DEFAULT 0 NOT NULL,
	`queued_count` integer DEFAULT 0 NOT NULL,
	`claimed_count` integer DEFAULT 0 NOT NULL,
	`completed_count` integer DEFAULT 0 NOT NULL,
	`blocked_count` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`heartbeat_at` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tdcc_continuous_runs_status_idx` ON `tdcc_continuous_runs` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `tdcc_continuous_symbols` (
	`symbol` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`catalog_revision` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`target_start` text,
	`target_end` text,
	`expected_weeks` integer DEFAULT 0 NOT NULL,
	`completed_weeks` integer DEFAULT 0 NOT NULL,
	`failed_weeks` integer DEFAULT 0 NOT NULL,
	`missing_dates_json` text DEFAULT '[]' NOT NULL,
	`checkpoint_date` text,
	`latest_snapshot_date` text,
	`history_success_at` text,
	`next_retry_at` text,
	`last_error_code` text,
	`lease_owner` text,
	`lease_expires_at` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tdcc_continuous_symbols_queue_idx` ON `tdcc_continuous_symbols` (`active`,`status`,`next_retry_at`,`first_seen_at`);--> statement-breakpoint
CREATE INDEX `tdcc_continuous_symbols_lease_idx` ON `tdcc_continuous_symbols` (`lease_expires_at`);