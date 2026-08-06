CREATE TABLE `user_instruments` (
	`user_id` text NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`tab_id` text DEFAULT '' NOT NULL,
	`tab_label` text NOT NULL,
	`group_name` text NOT NULL,
	`market` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`sort_order` integer,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `symbol`, `tab_id`)
);
--> statement-breakpoint
CREATE TABLE `user_tabs` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`is_default` integer DEFAULT 0 NOT NULL,
	`source_tab_id` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
