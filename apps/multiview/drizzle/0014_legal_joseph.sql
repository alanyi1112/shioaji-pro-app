ALTER TABLE `user_instruments` ADD `item_id` text;--> statement-breakpoint
ALTER TABLE `user_instruments` ADD `added_at` text;--> statement-breakpoint
ALTER TABLE `user_instruments` ADD `date_status` text DEFAULT 'legacy_unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_instruments` ADD `date_source` text;--> statement-breakpoint
ALTER TABLE `user_instruments` ADD `recommender` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `user_instruments` SET `item_id` = lower(hex(randomblob(16))) WHERE `item_id` IS NULL OR `item_id` = '';--> statement-breakpoint
CREATE UNIQUE INDEX `user_instruments_user_item_idx` ON `user_instruments` (`user_id`,`item_id`);
