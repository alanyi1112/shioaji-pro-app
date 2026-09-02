CREATE TABLE `tdcc_archive_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`manifest_version` text NOT NULL,
	`commit_sha` text NOT NULL,
	`validator_version` text NOT NULL,
	`scope` text NOT NULL DEFAULT 'full-market' CHECK (`scope` = 'full-market'),
	`status` text NOT NULL CHECK (`status` IN ('preparing','prepared','running','complete','failed','blocked')),
	`target_periods` integer NOT NULL DEFAULT 0,
	`processed_periods` integer NOT NULL DEFAULT 0,
	`failed_periods` integer NOT NULL DEFAULT 0,
	`overdue_periods` integer NOT NULL DEFAULT 0,
	`lease_owner` text,
	`lease_expires_at` text,
	`last_error_code` text,
	`heartbeat_at` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `tdcc_archive_runs_status_idx` ON `tdcc_archive_runs` (`status`,`lease_expires_at`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `tdcc_archive_symbol_universe` (
	`manifest_version` text NOT NULL,
	`symbol` text NOT NULL,
	`stock_code` text NOT NULL,
	`exchange` text NOT NULL CHECK (`exchange` IN ('TWSE','TPEx')),
	`quote_type` text NOT NULL CHECK (`quote_type` IN ('EQUITY','ETF')),
	`listing_date` text,
	`source` text NOT NULL,
	`source_date` text,
	`source_url` text NOT NULL,
	`created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY(`manifest_version`,`symbol`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tdcc_archive_symbol_universe_code_idx` ON `tdcc_archive_symbol_universe` (`manifest_version`,`stock_code`);
--> statement-breakpoint
CREATE TABLE `tdcc_archive_period_receipts` (
	`receipt_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`manifest_version` text NOT NULL,
	`commit_sha` text NOT NULL,
	`validator_version` text NOT NULL,
	`normalization_version` text NOT NULL,
	`data_date` text NOT NULL,
	`source_url` text NOT NULL,
	`byte_length` integer NOT NULL CHECK (`byte_length` > 0),
	`payload_sha256` text NOT NULL,
	`row_count` integer NOT NULL CHECK (`row_count` >= 0),
	`symbol_count` integer NOT NULL CHECK (`symbol_count` >= 0),
	`staged_symbol_count` integer NOT NULL DEFAULT 0 CHECK (`staged_symbol_count` >= 0),
	`material_hash` text NOT NULL DEFAULT '',
	`official_anchor_hash` text,
	`status` text NOT NULL CHECK (`status` IN ('prepared','staging','verified','matched-existing','source-mismatch','failed','rolled-back')),
	`inserted_rows` integer NOT NULL DEFAULT 0,
	`matched_rows` integer NOT NULL DEFAULT 0,
	`last_error_code` text,
	`verified_at` text,
	`created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`run_id`) REFERENCES `tdcc_archive_runs`(`run_id`) ON DELETE CASCADE,
	UNIQUE(`manifest_version`,`data_date`)
);
--> statement-breakpoint
CREATE INDEX `tdcc_archive_receipts_status_idx` ON `tdcc_archive_period_receipts` (`status`,`data_date`);
--> statement-breakpoint
CREATE TABLE `tdcc_archive_staging` (
	`receipt_id` text NOT NULL,
	`data_date` text NOT NULL,
	`symbol` text NOT NULL,
	`levels_json` text NOT NULL,
	`adjustment_json` text NOT NULL,
	`total_json` text NOT NULL,
	`material_hash` text NOT NULL,
	`source_fetched_at` text NOT NULL,
	`created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY(`receipt_id`,`symbol`),
	FOREIGN KEY (`receipt_id`) REFERENCES `tdcc_archive_period_receipts`(`receipt_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `tdcc_archive_staging_date_idx` ON `tdcc_archive_staging` (`receipt_id`,`data_date`,`symbol`);
--> statement-breakpoint
CREATE TABLE `tdcc_distribution_row_provenance` (
	`symbol` text NOT NULL,
	`data_date` text NOT NULL,
	`transport` text NOT NULL CHECK (`transport` IN ('official-openapi','official-history','verified-archive','legacy-verified')),
	`validation_status` text NOT NULL CHECK (`validation_status` IN ('verified','official-confirmed','source-mismatch','legacy-compatible')),
	`receipt_id` text,
	`source_url` text,
	`payload_sha256` text,
	`commit_sha` text,
	`normalization_version` text NOT NULL,
	`material_hash` text NOT NULL DEFAULT '',
	`official_confirmed_at` text,
	`created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY(`symbol`,`data_date`),
	FOREIGN KEY (`receipt_id`) REFERENCES `tdcc_archive_period_receipts`(`receipt_id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `tdcc_distribution_provenance_receipt_idx` ON `tdcc_distribution_row_provenance` (`receipt_id`,`validation_status`);
--> statement-breakpoint
CREATE INDEX `tdcc_distribution_provenance_date_idx` ON `tdcc_distribution_row_provenance` (`data_date`,`transport`,`validation_status`);
--> statement-breakpoint
CREATE INDEX `taiwan_stock_shareholder_date_symbol_idx` ON `taiwan_stock_shareholder_distribution` (`data_date`,`symbol`);
--> statement-breakpoint
INSERT INTO `tdcc_distribution_row_provenance` (`symbol`,`data_date`,`transport`,`validation_status`,`normalization_version`,`material_hash`,`created_at`,`updated_at`)
SELECT `symbol`,`data_date`,'legacy-verified','legacy-compatible','legacy-v1','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM `taiwan_stock_shareholder_distribution`
WHERE 1
ON CONFLICT(`symbol`,`data_date`) DO NOTHING;
