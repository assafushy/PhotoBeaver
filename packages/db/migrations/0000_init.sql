CREATE TABLE `asset_identity` (
	`asset_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`key` text NOT NULL,
	PRIMARY KEY(`asset_id`, `plugin_id`, `key`),
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `asset_identity_key_idx` ON `asset_identity` (`key`);--> statement-breakpoint
CREATE TABLE `asset_merges` (
	`id` text PRIMARY KEY NOT NULL,
	`surviving_asset_id` text NOT NULL,
	`merged_asset_id` text NOT NULL,
	`moved_instance_ids_json` text NOT NULL,
	`merged_by` text NOT NULL,
	`created_at` integer,
	`undone_at` integer
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`media_type` text NOT NULL,
	`mime` text,
	`width` integer,
	`height` integer,
	`duration_ms` integer,
	`captured_at` integer,
	`captured_at_source` text,
	`lat` real,
	`lon` real,
	`favorite` integer DEFAULT 0,
	`hidden` integer DEFAULT 0,
	`thumb_state` text DEFAULT 'pending',
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `assets_captured_at_idx` ON `assets` (`captured_at`,`id`);--> statement-breakpoint
CREATE INDEX `assets_lat_lon_idx` ON `assets` (`lat`,`lon`);--> statement-breakpoint
CREATE INDEX `assets_media_type_idx` ON `assets` (`media_type`);--> statement-breakpoint
CREATE TABLE `duplicate_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_id` text NOT NULL,
	`asset_ids_json` text NOT NULL,
	`kind` text NOT NULL,
	`confidence` real,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE `enrichments` (
	`asset_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`plugin_version` text NOT NULL,
	`key` text NOT NULL,
	`value_json` text NOT NULL,
	`created_at` integer,
	PRIMARY KEY(`asset_id`, `plugin_id`, `key`),
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`plugin_id` text,
	`source_id` text,
	`asset_id` text,
	`payload_json` text,
	`priority` integer DEFAULT 100 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`run_after` integer NOT NULL,
	`lease_owner` text,
	`lease_expires_at` integer,
	`last_error` text,
	`dedupe_key` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_dedupe_key_unique` ON `jobs` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `jobs_status_priority_run_after_idx` ON `jobs` (`status`,`priority`,`run_after`);--> statement-breakpoint
CREATE TABLE `album_assets` (
	`album_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`position` integer,
	PRIMARY KEY(`album_id`, `asset_id`),
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `albums` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source_id` text,
	`external_id` text,
	`created_at` integer,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `asset_tags` (
	`asset_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`plugin_id` text,
	`confidence` real,
	PRIMARY KEY(`asset_id`, `tag_id`),
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `faces` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text,
	`plugin_id` text,
	`bbox_json` text,
	`confidence` real,
	`person_id` text,
	`assigned_by` text,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`cover_face_id` text,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_kind_unique` ON `tags` (`name`,`kind`);--> statement-breakpoint
CREATE TABLE `plugin_kv` (
	`plugin_id` text NOT NULL,
	`key` text NOT NULL,
	`value_json` text,
	PRIMARY KEY(`plugin_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`type` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`manifest_json` text NOT NULL,
	`granted_permissions_json` text NOT NULL,
	`install_source` text NOT NULL,
	`health` text DEFAULT 'ok' NOT NULL,
	`installed_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text
);
--> statement-breakpoint
CREATE TABLE `instances` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`source_id` text NOT NULL,
	`external_id` text NOT NULL,
	`external_url` text,
	`path` text,
	`size_bytes` integer,
	`source_modified_at` integer,
	`source_metadata_json` text,
	`etag` text,
	`seen_run_id` text,
	`deleted_at` integer,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `instances_asset_idx` ON `instances` (`asset_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `instances_source_external_unique` ON `instances` (`source_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_id` text NOT NULL,
	`display_name` text NOT NULL,
	`config_json` text NOT NULL,
	`secret_ref` text,
	`sync_cursor` text,
	`sync_state` text DEFAULT 'idle' NOT NULL,
	`schedule_json` text NOT NULL,
	`last_sync_started_at` integer,
	`last_sync_finished_at` integer,
	`last_error` text,
	`consecutive_failures` integer DEFAULT 0,
	`next_run_at` integer,
	`created_at` integer,
	FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`details_json` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_created_at_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `user_scopes` (
	`user_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `scope_type`, `scope_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`avatar_path` text,
	`role` text NOT NULL,
	`secret_hash` text,
	`secret_kind` text,
	`biometric_enabled` integer DEFAULT 0,
	`disabled` integer DEFAULT 0,
	`created_at` integer,
	`last_login_at` integer
);
