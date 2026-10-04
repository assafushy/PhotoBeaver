CREATE TABLE `enrichment_runs` (
	`asset_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`plugin_version` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`completed_at` integer NOT NULL,
	PRIMARY KEY(`asset_id`, `plugin_id`),
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `enrichment_runs_plugin_idx` ON `enrichment_runs` (`plugin_id`);--> statement-breakpoint
ALTER TABLE `assets` ADD `location_source` text;--> statement-breakpoint
CREATE INDEX `asset_merges_created_at_idx` ON `asset_merges` (`created_at`);--> statement-breakpoint
CREATE INDEX `duplicate_suggestions_status_idx` ON `duplicate_suggestions` (`status`);--> statement-breakpoint
CREATE INDEX `asset_tags_tag_idx` ON `asset_tags` (`tag_id`);