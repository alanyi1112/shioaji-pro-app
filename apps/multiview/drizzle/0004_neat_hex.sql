CREATE TABLE `tdcc_shareholder_backfill_job` (
	`job_id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`target_start` text NOT NULL,
	`target_end` text NOT NULL,
	`expected_dates_json` text NOT NULL,
	`expected_weeks` integer NOT NULL,
	`completed_weeks` integer DEFAULT 0 NOT NULL,
	`failed_weeks` integer DEFAULT 0 NOT NULL,
	`checkpoint_date` text,
	`status` text NOT NULL,
	`last_error_code` text,
	`last_success_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tdcc_shareholder_backfill_status_idx` ON `tdcc_shareholder_backfill_job` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `tdcc_shareholder_backfill_week` (
	`job_id` text NOT NULL,
	`data_date` text NOT NULL,
	`status` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`symbol_count` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`completed_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`job_id`, `data_date`)
);
--> statement-breakpoint
CREATE INDEX `tdcc_shareholder_backfill_week_status_idx` ON `tdcc_shareholder_backfill_week` (`job_id`,`status`);