CREATE TABLE `meeting_segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`meeting_id` integer NOT NULL,
	`segment_key` text NOT NULL,
	`elapsed_seconds` integer DEFAULT 0 NOT NULL,
	`entered_at` text,
	`done_at` text,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_segments_key_check" CHECK("meeting_segments"."segment_key" IN ('segue', 'scorecard', 'rocks', 'headlines', 'todos', 'ids', 'conclude'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_segments_meeting_key_idx` ON `meeting_segments` (`meeting_id`,`segment_key`);--> statement-breakpoint
CREATE TABLE `meetings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`date` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`facilitator_person_id` integer,
	`started_at` text NOT NULL,
	`concluded_at` text,
	`created_by` integer NOT NULL,
	FOREIGN KEY (`facilitator_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meetings_status_check" CHECK("meetings"."status" IN ('open', 'concluded'))
);
