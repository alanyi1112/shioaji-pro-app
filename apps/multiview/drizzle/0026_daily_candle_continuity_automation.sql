CREATE TABLE IF NOT EXISTS `candle_continuity_run_items` (
	`run_id` text NOT NULL,
	`symbol` text NOT NULL,
	`ordinal` integer NOT NULL,
	`priority` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_owner` text,
	`lease_expires_at` text,
	`retry_after` text,
	`coverage_end` text,
	`verified_through` text,
	`missing_session_count` integer DEFAULT 0 NOT NULL,
	`checked_at` text,
	`reason_code` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`run_id`, `symbol`),
	FOREIGN KEY (`run_id`) REFERENCES `candle_continuity_runs`(`run_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "candle_continuity_run_items_status_check" CHECK("candle_continuity_run_items"."status" in ('queued','running','retry_waiting','fresh','complete','partial','unknown','failed','overdue'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `candle_continuity_run_items_ordinal_idx` ON `candle_continuity_run_items` (`run_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `candle_continuity_run_items_queue_idx` ON `candle_continuity_run_items` (`run_id`,`status`,`priority`,`ordinal`,`retry_after`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `candle_continuity_run_items_anomaly_idx` ON `candle_continuity_run_items` (`run_id`,`status`,`priority`,`symbol`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `candle_continuity_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`deployment_target` text NOT NULL,
	`trigger` text NOT NULL,
	`commit_sha` text,
	`expected_session` text NOT NULL,
	`sla_checkpoint` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`phase` text DEFAULT 'audit' NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`target_count` integer DEFAULT 0 NOT NULL,
	`processed_count` integer DEFAULT 0 NOT NULL,
	`remaining_count` integer DEFAULT 0 NOT NULL,
	`complete_count` integer DEFAULT 0 NOT NULL,
	`partial_count` integer DEFAULT 0 NOT NULL,
	`unknown_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`overdue_count` integer DEFAULT 0 NOT NULL,
	`heartbeat_at` text NOT NULL,
	`reason_code` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "candle_continuity_runs_target_check" CHECK("candle_continuity_runs"."deployment_target" in ('sites','cloudflare','local')),
	CONSTRAINT "candle_continuity_runs_trigger_check" CHECK("candle_continuity_runs"."trigger" in ('schedule','workflow_dispatch','local')),
	CONSTRAINT "candle_continuity_runs_status_check" CHECK("candle_continuity_runs"."status" in ('running','retry_waiting','completed','failed')),
	CONSTRAINT "candle_continuity_runs_phase_check" CHECK("candle_continuity_runs"."phase" in ('audit','waiting','completed','failed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `candle_continuity_runs_target_recent_idx` ON `candle_continuity_runs` (`deployment_target`,`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `candle_continuity_runs_status_idx` ON `candle_continuity_runs` (`status`,`heartbeat_at`);
