ALTER TABLE `screener_snapshots` ADD `schema_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `screener_runs_scope_status_idx` ON `screener_runs` (`scope`,`status`);