CREATE TABLE `meeting_ratings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`meeting_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	`score` integer NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_ratings_score_check" CHECK("meeting_ratings"."score" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_ratings_meeting_person_idx` ON `meeting_ratings` (`meeting_id`,`person_id`);