ALTER TABLE `taiwan_stock_pe_fetch_state` ADD `verified_end` text;--> statement-breakpoint
ALTER TABLE `taiwan_stock_pe_fetch_state` ADD `display_end` text;--> statement-breakpoint
ALTER TABLE `taiwan_stock_pe_fetch_state` ADD `official_source_date` text;--> statement-breakpoint
ALTER TABLE `taiwan_stock_pe_fetch_state` ADD `provisional_dates_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `taiwan_stock_pe_fetch_state` ADD `provisional_status` text;--> statement-breakpoint
ALTER TABLE `taiwan_stock_pe_fetch_state` ADD `provisional_quarantined` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `taiwan_stock_pe_fetch_state` ADD `mismatch_date` text;--> statement-breakpoint
ALTER TABLE `taiwan_stock_pe_fetch_state` ADD `mismatch_pe_difference` real;--> statement-breakpoint
ALTER TABLE `taiwan_stock_pe_fetch_state` ADD `mismatch_close_difference` real;--> statement-breakpoint
ALTER TABLE `taiwan_stock_pe_valuation_daily` ADD `provisional_created_at` text;