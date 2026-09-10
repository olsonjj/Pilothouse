CREATE TABLE `quarters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`label` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	CONSTRAINT "quarters_label_check" CHECK("quarters"."label" GLOB '[0-9][0-9][0-9][0-9] Q[1-4]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quarters_label_unique` ON `quarters` (`label`);