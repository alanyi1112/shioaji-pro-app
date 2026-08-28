ALTER TABLE `candle_history_state` ADD `continuity_status` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `candle_history_state` ADD `continuity_from` text;--> statement-breakpoint
ALTER TABLE `candle_history_state` ADD `continuity_through` text;--> statement-breakpoint
ALTER TABLE `candle_history_state` ADD `continuity_checked_at` text;--> statement-breakpoint
ALTER TABLE `candle_history_state` ADD `missing_session_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `candle_history_state` ADD `missing_session_dates_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `candle_history_state` ADD `excluded_session_dates_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `candle_history_state` ADD `continuity_reason_code` text;--> statement-breakpoint
UPDATE `candle_history_state` SET `full_window_complete`=0, `status`='unknown', `reason_code`='continuity_unverified', `continuity_status`='unknown', `continuity_reason_code`='continuity_not_audited';
