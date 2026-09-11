CREATE TABLE `todos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`title` text NOT NULL,
	`assignee_person_id` integer NOT NULL,
	`created_by` integer NOT NULL,
	`due_date` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`completed_at` text,
	`drop_reason` text,
	`source_meeting_id` integer,
	`issue_source_id` integer,
	FOREIGN KEY (`assignee_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "todos_status_check" CHECK("todos"."status" IN ('open', 'done', 'dropped'))
);
