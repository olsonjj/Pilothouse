CREATE TABLE `meeting_issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`meeting_id` integer NOT NULL,
	`issue_id` integer NOT NULL,
	`state` text DEFAULT 'in_ids' NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_issues_state_check" CHECK("meeting_issues"."state" IN ('in_ids', 'solved_today', 'carried'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_issues_meeting_issue_idx` ON `meeting_issues` (`meeting_id`,`issue_id`);