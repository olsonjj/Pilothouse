CREATE TABLE `rock_statuses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`rock_id` integer NOT NULL,
	`week` text NOT NULL,
	`status` text NOT NULL,
	`actual` real,
	`comment` text,
	`entry_by` integer NOT NULL,
	FOREIGN KEY (`rock_id`) REFERENCES `rocks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rock_statuses_status_check" CHECK("rock_statuses"."status" IN ('on_track', 'off_track', 'measuring'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rock_statuses_rock_week_idx` ON `rock_statuses` (`rock_id`,`week`);