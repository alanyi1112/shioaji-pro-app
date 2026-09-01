CREATE TABLE `screener_daily_volume` (
	`symbol` text NOT NULL,
	`data_date` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`data_date`, `symbol`)
);
--> statement-breakpoint
CREATE TABLE `screener_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`status` text NOT NULL,
	`checkpoint` text NOT NULL,
	`lease_until` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `screener_snapshot_rows` (
	`snapshot_id` text NOT NULL,
	`symbol` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`snapshot_id`, `symbol`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `screener_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `screener_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`status` text NOT NULL,
	`metadata` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `screener_snapshots_published_idx` ON `screener_snapshots` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `screener_tdcc_weekly` (
	`symbol` text NOT NULL,
	`data_date` text NOT NULL,
	`payload` text NOT NULL,
	`validation` text NOT NULL,
	PRIMARY KEY(`data_date`, `symbol`)
);
--> statement-breakpoint
CREATE TABLE `screener_universe` (
	`revision` text NOT NULL,
	`symbol` text NOT NULL,
	`market` text NOT NULL,
	`data_date` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`revision`, `symbol`)
);
