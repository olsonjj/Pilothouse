CREATE TABLE `people_analyzer_scores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`person_id` integer NOT NULL,
	`quarter_id` integer NOT NULL,
	`core_value_id` integer NOT NULL,
	`score` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quarter_id`) REFERENCES `quarters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`core_value_id`) REFERENCES `core_values`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "people_analyzer_score_check" CHECK("people_analyzer_scores"."score" IN ('+', '-', '--'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `people_analyzer_unique_idx` ON `people_analyzer_scores` (`person_id`,`quarter_id`,`core_value_id`);