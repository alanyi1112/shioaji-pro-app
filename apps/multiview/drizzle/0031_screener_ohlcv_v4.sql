ALTER TABLE `screener_daily_ohlcv` ADD `volume_shares` text;
--> statement-breakpoint
ALTER TABLE `screener_daily_ohlcv` ADD `volume_unit` text CHECK (`volume_unit` IS NULL OR `volume_unit` = 'shares');
--> statement-breakpoint
ALTER TABLE `screener_daily_ohlcv` ADD `volume_field` text;
--> statement-breakpoint
ALTER TABLE `screener_daily_ohlcv` ADD `volume_mapping_version` text;
--> statement-breakpoint
CREATE INDEX `screener_daily_ohlcv_v4_coverage_idx` ON `screener_daily_ohlcv` (`validation`,`market`,`data_date`);
