CREATE TABLE `face_rejections` (
	`face_id` text NOT NULL,
	`person_id` text NOT NULL,
	PRIMARY KEY(`face_id`, `person_id`),
	FOREIGN KEY (`face_id`) REFERENCES `faces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `faces_asset_idx` ON `faces` (`asset_id`);--> statement-breakpoint
CREATE INDEX `faces_person_idx` ON `faces` (`person_id`);--> statement-breakpoint
CREATE INDEX `faces_plugin_idx` ON `faces` (`plugin_id`);