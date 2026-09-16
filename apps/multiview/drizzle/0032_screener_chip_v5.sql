ALTER TABLE `screener_universe` ADD `issued_common_shares` text;
--> statement-breakpoint
ALTER TABLE `screener_universe` ADD `issued_shares_source_date` text;
--> statement-breakpoint
ALTER TABLE `screener_universe` ADD `issued_shares_source_url` text;
--> statement-breakpoint
ALTER TABLE `screener_universe` ADD `issued_shares_payload_hash` text;
--> statement-breakpoint
ALTER TABLE `screener_universe` ADD `issued_shares_normalization_version` text;
--> statement-breakpoint
CREATE TABLE `screener_chip_runs` (
  `id` text PRIMARY KEY NOT NULL, `target_session_date` text NOT NULL, `universe_revision` text NOT NULL,
  `status` text NOT NULL, `target` integer DEFAULT 0 NOT NULL, `processed` integer DEFAULT 0 NOT NULL,
  `failed` integer DEFAULT 0 NOT NULL, `overdue` integer DEFAULT 0 NOT NULL, `checkpoint` text NOT NULL,
  `lease_owner` text, `lease_until` text, `last_error_code` text, `started_at` text NOT NULL,
  `completed_at` text, `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `screener_chip_runs_status_idx` ON `screener_chip_runs` (`status`,`target_session_date`);
--> statement-breakpoint
CREATE TABLE `screener_chip_receipts` (
  `id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL, `market` text NOT NULL CHECK (`market` IN ('TWSE','TPEx')),
  `dataset` text NOT NULL CHECK (`dataset` IN ('institutional-flow','margin-short')), `requested_date` text NOT NULL,
  `source_date` text, `source_url` text NOT NULL, `payload_hash` text NOT NULL, `normalization_version` text NOT NULL,
  `status` text NOT NULL, `row_count` integer DEFAULT 0 NOT NULL, `universe_target` integer DEFAULT 0 NOT NULL,
  `missing_count` integer DEFAULT 0 NOT NULL, `invalid_count` integer DEFAULT 0 NOT NULL, `reason_code` text,
  `fetched_at` text NOT NULL, `verified_at` text, FOREIGN KEY (`run_id`) REFERENCES `screener_chip_runs`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `screener_chip_receipts_dataset_date_idx` ON `screener_chip_receipts` (`market`,`dataset`,`requested_date`,`payload_hash`);
--> statement-breakpoint
CREATE INDEX `screener_chip_receipts_status_idx` ON `screener_chip_receipts` (`status`,`requested_date`,`market`);
--> statement-breakpoint
CREATE TABLE `screener_chip_daily` (
  `symbol` text NOT NULL, `session_date` text NOT NULL, `market` text NOT NULL CHECK (`market` IN ('TWSE','TPEx')),
  `investment_trust_buy_shares` text, `investment_trust_sell_shares` text, `investment_trust_net_shares` text,
  `margin_yesterday_balance_lots` text, `margin_today_balance_lots` text, `margin_balance_change_lots` text,
  `short_yesterday_balance_lots` text, `short_today_balance_lots` text, `short_balance_change_lots` text,
  `institutional_receipt_id` text, `margin_receipt_id` text, `updated_at` text NOT NULL,
  PRIMARY KEY (`session_date`,`symbol`),
  FOREIGN KEY (`institutional_receipt_id`) REFERENCES `screener_chip_receipts`(`id`),
  FOREIGN KEY (`margin_receipt_id`) REFERENCES `screener_chip_receipts`(`id`)
);
--> statement-breakpoint
CREATE INDEX `screener_chip_daily_market_date_idx` ON `screener_chip_daily` (`market`,`session_date`);
--> statement-breakpoint
CREATE INDEX `screener_chip_daily_symbol_date_idx` ON `screener_chip_daily` (`symbol`,`session_date`);
--> statement-breakpoint
CREATE TABLE `screener_chip_publication_head` (
  `name` text PRIMARY KEY NOT NULL, `snapshot_id` text NOT NULL, `effective_session_date` text NOT NULL,
  `universe_revision` text NOT NULL, `daily_through` text NOT NULL, `weekly_through` text,
  `receipts_hash` text NOT NULL, `status` text NOT NULL, `updated_at` text NOT NULL
);
