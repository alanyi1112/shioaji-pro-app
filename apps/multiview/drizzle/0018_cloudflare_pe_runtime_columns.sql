-- 既有 Sites D1 曾由 runtime PRAGMA 升級下列欄位；Cloudflare production
-- 改採純 deploy-time migration，因此必須把該 schema 漂移正式補入 migration。
ALTER TABLE `taiwan_stock_pe_valuation_daily` ADD `provider` text DEFAULT 'official' NOT NULL;--> statement-breakpoint
ALTER TABLE `taiwan_stock_pe_valuation_daily` ADD `original_source` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `taiwan_stock_pe_valuation_daily` ADD `validation_status` text DEFAULT 'official_verified' NOT NULL;--> statement-breakpoint
ALTER TABLE `taiwan_stock_pe_valuation_daily` ADD `official_overlap_date` text;--> statement-breakpoint
ALTER TABLE `taiwan_stock_pe_fetch_state` ADD `latest_source_date` text;--> statement-breakpoint
ALTER TABLE `taiwan_stock_pe_fetch_state` ADD `provider_verified_at` text;--> statement-breakpoint
ALTER TABLE `taiwan_stock_pe_fetch_state` ADD `lane` text DEFAULT 'history' NOT NULL;--> statement-breakpoint
ALTER TABLE `taiwan_stock_pe_backfill_job` ADD `lane` text DEFAULT 'history' NOT NULL;--> statement-breakpoint
ALTER TABLE `taiwan_stock_pe_backfill_job` ADD `latest_source_date` text;--> statement-breakpoint
ALTER TABLE `taiwan_stock_pe_backfill_job` ADD `provider_verified_at` text;--> statement-breakpoint
ALTER TABLE `taiwan_stock_pe_backfill_month` ADD `dataset_status_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `taiwan_stock_pe_backfill_month` ADD `ingest_cursor` integer DEFAULT 0 NOT NULL;
