CREATE TABLE `people` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`full_name` text NOT NULL,
	`email` text,
	`start_date` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `people_email_unique_idx` ON `people` (`email`) WHERE "people"."email" IS NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `person_id` integer REFERENCES people(id);