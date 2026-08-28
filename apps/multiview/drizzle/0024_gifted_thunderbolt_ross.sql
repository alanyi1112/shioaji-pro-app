ALTER TABLE `tdcc_continuous_symbols` ADD `official_plan_through` text;--> statement-breakpoint
ALTER TABLE `tdcc_continuous_symbols` ADD `coverage_verified_at` text;--> statement-breakpoint
CREATE INDEX `tdcc_continuous_symbols_handoff_idx` ON `tdcc_continuous_symbols` (`active`,`status`,`first_seen_at`,`lease_expires_at`);