ALTER TABLE `screener_chip_daily` ADD `foreign_buy_shares` text;
--> statement-breakpoint
ALTER TABLE `screener_chip_daily` ADD `foreign_sell_shares` text;
--> statement-breakpoint
ALTER TABLE `screener_chip_daily` ADD `foreign_net_shares` text;
--> statement-breakpoint
ALTER TABLE `screener_chip_daily` ADD `institutional_mapping_version` text;
--> statement-breakpoint
ALTER TABLE `screener_chip_daily` ADD `institutional_invalid_reason` text;
--> statement-breakpoint
CREATE TABLE `screener_institutional_mapping_verifications` (
  `receipt_id` text NOT NULL,
  `mapping_version` text NOT NULL,
  `payload_hash` text NOT NULL,
  `status` text NOT NULL CHECK (`status` IN ('verified','invalid')),
  `row_count` integer DEFAULT 0 NOT NULL,
  `universe_target` integer DEFAULT 0 NOT NULL,
  `missing_count` integer DEFAULT 0 NOT NULL,
  `invalid_count` integer DEFAULT 0 NOT NULL,
  `reason_code` text,
  `verified_at` text NOT NULL,
  PRIMARY KEY (`receipt_id`,`mapping_version`),
  FOREIGN KEY (`receipt_id`) REFERENCES `screener_chip_receipts`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `screener_institutional_mapping_verifications_status_idx`
  ON `screener_institutional_mapping_verifications` (`mapping_version`,`status`,`verified_at`);
