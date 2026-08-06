CREATE TABLE `chip_backfill_orchestrator_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`phase` text NOT NULL,
	`expected_session_date` text NOT NULL,
	`latest_data_date` text,
	`processed_symbols_json` text DEFAULT '[]' NOT NULL,
	`processed_symbols` integer DEFAULT 0 NOT NULL,
	`remaining_symbols` integer DEFAULT 0 NOT NULL,
	`pending_symbols` integer DEFAULT 0 NOT NULL,
	`last_symbol` text,
	`last_reason_code` text,
	`heartbeat_at` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chip_backfill_orchestrator_runs_status_idx` ON `chip_backfill_orchestrator_runs` (`status`,`updated_at`);