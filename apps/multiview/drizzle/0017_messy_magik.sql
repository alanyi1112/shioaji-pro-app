CREATE TABLE `access_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`target_user_id` text,
	`action` text NOT NULL,
	`result` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `access_audit_log_created_idx` ON `access_audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `access_audit_log_actor_idx` ON `access_audit_log` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `access_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_users_email_idx` ON `access_users` (`email`);--> statement-breakpoint
CREATE INDEX `access_users_role_status_idx` ON `access_users` (`role`,`status`);