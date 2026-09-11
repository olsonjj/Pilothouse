CREATE TABLE `issue_resolutions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`issue_id` integer NOT NULL,
	`meeting_id` integer,
	`outcome` text NOT NULL,
	`note` text NOT NULL,
	`resolved_by` integer NOT NULL,
	`resolved_at` text NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "issue_resolutions_outcome_check" CHECK("issue_resolutions"."outcome" IN ('solved', 'dropped'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_resolutions_issue_unique_idx` ON `issue_resolutions` (`issue_id`);--> statement-breakpoint
CREATE TABLE `issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`title` text NOT NULL,
	`classification` text NOT NULL,
	`quarter_id` integer,
	`origin` text DEFAULT 'manual' NOT NULL,
	`origin_source_id` integer,
	`created_by` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`quarter_id`) REFERENCES `quarters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "issues_classification_check" CHECK("issues"."classification" IN ('long_term', 'short_term')),
	CONSTRAINT "issues_origin_check" CHECK("issues"."origin" IN ('manual', 'from_rock', 'from_scorecard', 'from_todo', 'from_meeting'))
);
