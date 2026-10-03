PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_plugin_kv` (
	`plugin_id` text NOT NULL,
	`key` text NOT NULL,
	`value_json` text NOT NULL,
	PRIMARY KEY(`plugin_id`, `key`)
);
--> statement-breakpoint
INSERT INTO `__new_plugin_kv`("plugin_id", "key", "value_json") SELECT "plugin_id", "key", "value_json" FROM `plugin_kv` WHERE "value_json" IS NOT NULL;--> statement-breakpoint
DROP TABLE `plugin_kv`;--> statement-breakpoint
ALTER TABLE `__new_plugin_kv` RENAME TO `plugin_kv`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `asset_merges` ADD `snapshot_json` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `missing_since` integer;--> statement-breakpoint
ALTER TABLE `sources` ADD `sync_run_id` text;--> statement-breakpoint
CREATE INDEX `assets_library_order_idx` ON `assets` (COALESCE(`captured_at`, -9007199254740991), `id`) WHERE `hidden` = 0 AND `missing_since` IS NULL;

