CREATE TABLE `metric_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`metric_id` integer NOT NULL,
	`week` text NOT NULL,
	`actual` real NOT NULL,
	`target_at_entry` real NOT NULL,
	`entry_by` integer NOT NULL,
	FOREIGN KEY (`metric_id`) REFERENCES `metrics`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metric_entries_metric_week_unique_idx` ON `metric_entries` (`metric_id`,`week`);