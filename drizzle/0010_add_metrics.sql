CREATE TABLE `metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`name` text NOT NULL,
	`owner_person_id` integer NOT NULL,
	`target` real NOT NULL,
	`direction` text DEFAULT 'gte' NOT NULL,
	`unit` text,
	`active` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`owner_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "metrics_direction_check" CHECK("metrics"."direction" IN ('gte', 'lte')),
	CONSTRAINT "metrics_active_check" CHECK("metrics"."active" IN (0, 1))
);
